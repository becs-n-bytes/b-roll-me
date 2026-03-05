use std::collections::HashMap;
use std::sync::Mutex;
use tauri::Emitter;
use tauri_plugin_shell::ShellExt;
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_sql::{Builder as SqlBuilder, Migration, MigrationKind};

struct AppState {
    active_downloads: Mutex<HashMap<String, CommandChild>>,
}

#[derive(serde::Serialize, Clone)]
struct DownloadProgress {
    clip_id: String,
    line: String,
}

#[tauri::command]
async fn download_clip(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    clip_id: String,
    video_url: String,
    start_time: f64,
    end_time: f64,
    output_path: String,
) -> Result<String, String> {
    let mut args: Vec<String> = vec![
        "--no-playlist".into(),
        "--newline".into(),
        "-f".into(),
        "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best".into(),
        "--merge-output-format".into(),
        "mp4".into(),
    ];

    if end_time > start_time {
        args.push("--download-sections".into());
        args.push(format!("*{:.1}-{:.1}", start_time, end_time));
    }

    args.push("-o".into());
    args.push(output_path.clone());
    args.push(video_url);

    let (mut rx, child) = app
        .shell()
        .sidecar("binaries/yt-dlp")
        .map_err(|e| e.to_string())?
        .args(args)
        .spawn()
        .map_err(|e| format!("Failed to spawn yt-dlp: {e}"))?;

    {
        state.active_downloads.lock().unwrap().insert(clip_id.clone(), child);
    }

    while let Some(event) = rx.recv().await {
        match event {
            CommandEvent::Stdout(bytes) => {
                let line = String::from_utf8_lossy(&bytes).to_string();
                let _ = app.emit("download-progress", DownloadProgress {
                    clip_id: clip_id.clone(),
                    line,
                });
            }
            CommandEvent::Stderr(bytes) => {
                let line = String::from_utf8_lossy(&bytes).to_string();
                let _ = app.emit("download-progress", DownloadProgress {
                    clip_id: clip_id.clone(),
                    line,
                });
            }
            CommandEvent::Terminated(payload) => {
                state.active_downloads.lock().unwrap().remove(&clip_id);
                if payload.signal.is_some() {
                    return Err("cancelled".into());
                }
                if payload.code != Some(0) {
                    return Err(format!("yt-dlp exited with code {:?}", payload.code));
                }
                break;
            }
            CommandEvent::Error(err) => {
                state.active_downloads.lock().unwrap().remove(&clip_id);
                return Err(format!("yt-dlp error: {err}"));
            }
            _ => {}
        }
    }

    state.active_downloads.lock().unwrap().remove(&clip_id);
    Ok(output_path)
}

#[tauri::command]
async fn cancel_download(state: tauri::State<'_, AppState>, clip_id: String) -> Result<(), String> {
    if let Some(child) = state.active_downloads.lock().unwrap().remove(&clip_id) {
        child.kill().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn ensure_output_dir(path: String) -> Result<String, String> {
    std::fs::create_dir_all(&path).map_err(|e| e.to_string())?;
    Ok(path)
}

fn migrations() -> Vec<Migration> {
    vec![Migration {
        version: 1,
        description: "create_initial_schema",
        sql: "CREATE TABLE IF NOT EXISTS projects (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                script_text TEXT,
                output_directory TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS moments (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                script_excerpt TEXT NOT NULL,
                timestamp_hint TEXT,
                editorial_note TEXT,
                suggestions_json TEXT,
                sort_order INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS search_results (
                id TEXT PRIMARY KEY,
                moment_id TEXT NOT NULL REFERENCES moments(id) ON DELETE CASCADE,
                video_id TEXT NOT NULL,
                video_title TEXT,
                channel_name TEXT,
                thumbnail_url TEXT,
                duration INTEGER,
                publish_date TEXT,
                captions_available INTEGER DEFAULT 0,
                relevance_score REAL,
                source_query TEXT,
                transcript_matches_json TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS evaluated_clips (
                id TEXT PRIMARY KEY,
                search_result_id TEXT NOT NULL REFERENCES search_results(id) ON DELETE CASCADE,
                moment_id TEXT NOT NULL REFERENCES moments(id) ON DELETE CASCADE,
                relevance_score REAL,
                relevance_reason TEXT,
                suggested_start_time REAL,
                suggested_end_time REAL,
                clip_description TEXT,
                usable INTEGER DEFAULT 1,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS downloaded_clips (
                id TEXT PRIMARY KEY,
                moment_id TEXT NOT NULL REFERENCES moments(id) ON DELETE CASCADE,
                video_id TEXT NOT NULL,
                file_path TEXT NOT NULL,
                start_time REAL NOT NULL,
                end_time REAL NOT NULL,
                file_size INTEGER,
                downloaded_at TEXT NOT NULL DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS transcript_cache (
                video_id TEXT PRIMARY KEY,
                transcript_json TEXT NOT NULL,
                language TEXT DEFAULT 'en',
                cached_at TEXT NOT NULL DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT
            );",
        kind: MigrationKind::Up,
    }]
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(
            SqlBuilder::default()
                .add_migrations("sqlite:ai-broll.db", migrations())
                .build(),
        )
        .manage(AppState {
            active_downloads: Mutex::new(HashMap::new()),
        })
        .invoke_handler(tauri::generate_handler![download_clip, cancel_download, ensure_output_dir])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn ensure_output_dir_creates_new_directory() {
        let dir = std::env::temp_dir().join("broll-test-create");
        let _ = std::fs::remove_dir_all(&dir);

        let result = ensure_output_dir(dir.to_string_lossy().to_string());
        assert!(result.is_ok());
        assert!(Path::new(&result.unwrap()).exists());

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn ensure_output_dir_succeeds_when_exists() {
        let dir = std::env::temp_dir().join("broll-test-existing");
        std::fs::create_dir_all(&dir).unwrap();

        let result = ensure_output_dir(dir.to_string_lossy().to_string());
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), dir.to_string_lossy().to_string());

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn ensure_output_dir_creates_nested_directories() {
        let dir = std::env::temp_dir().join("broll-test-nested/level1/level2");
        let _ = std::fs::remove_dir_all(std::env::temp_dir().join("broll-test-nested"));

        let result = ensure_output_dir(dir.to_string_lossy().to_string());
        assert!(result.is_ok());
        assert!(Path::new(&result.unwrap()).exists());

        let _ = std::fs::remove_dir_all(std::env::temp_dir().join("broll-test-nested"));
    }

    #[test]
    fn migrations_has_correct_structure() {
        let m = migrations();
        assert_eq!(m.len(), 1);
        assert_eq!(m[0].version, 1);
        assert_eq!(m[0].description, "create_initial_schema");
    }

    #[test]
    fn migration_sql_contains_all_tables() {
        let m = migrations();
        let sql = m[0].sql;
        let expected_tables = [
            "projects",
            "moments",
            "search_results",
            "evaluated_clips",
            "downloaded_clips",
            "transcript_cache",
            "settings",
        ];
        for table in &expected_tables {
            assert!(
                sql.contains(&format!("CREATE TABLE IF NOT EXISTS {table}")),
                "Missing table: {table}"
            );
        }
    }

    #[test]
    fn migration_sql_has_correct_foreign_keys() {
        let m = migrations();
        let sql = m[0].sql;
        assert!(sql.contains("REFERENCES projects(id) ON DELETE CASCADE"));
        assert!(sql.contains("REFERENCES moments(id) ON DELETE CASCADE"));
        assert!(sql.contains("REFERENCES search_results(id) ON DELETE CASCADE"));
    }

    #[test]
    fn migration_sql_has_primary_keys() {
        let m = migrations();
        let sql = m[0].sql;
        let tables_with_text_pk = ["projects", "moments", "search_results", "evaluated_clips", "downloaded_clips", "settings"];
        for table in &tables_with_text_pk {
            assert!(
                sql.contains(&format!("{table}")) && sql.contains("id TEXT PRIMARY KEY"),
                "Table {table} missing TEXT PRIMARY KEY"
            );
        }
        assert!(sql.contains("video_id TEXT PRIMARY KEY"));
    }
}
