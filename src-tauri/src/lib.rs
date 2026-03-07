use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{Emitter, Manager};
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

#[derive(serde::Serialize, Clone)]
struct TranscriptionProgress {
    video_id: String,
    stage: String,
    progress: f64,
}

#[derive(serde::Serialize, Clone)]
struct ModelDownloadProgress {
    model_name: String,
    downloaded: u64,
    total: u64,
}

#[derive(serde::Serialize)]
struct WhisperModelStatus {
    downloaded: bool,
    path: String,
    size_bytes: Option<u64>,
}

#[derive(serde::Serialize)]
struct WhisperSegment {
    text: String,
    start: f64,
    duration: f64,
}

#[derive(serde::Serialize)]
struct WhisperTranscript {
    segments: Vec<WhisperSegment>,
    language: String,
    #[serde(rename = "languageCode")]
    language_code: String,
    #[serde(rename = "isGenerated")]
    is_generated: bool,
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

fn get_whisper_model_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|p| p.join("models"))
        .map_err(|e| e.to_string())
}

fn emit_transcription_progress(app: &tauri::AppHandle, video_id: &str, stage: &str, progress: f64) {
    let _ = app.emit(
        "transcription-progress",
        TranscriptionProgress {
            video_id: video_id.to_string(),
            stage: stage.to_string(),
            progress,
        },
    );
}

fn find_audio_file(dir: &std::path::Path) -> Result<PathBuf, String> {
    std::fs::read_dir(dir)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok())
        .find(|e| {
            let name = e.file_name().to_string_lossy().to_string();
            name.starts_with("audio.") && !name.ends_with(".part") && name != "audio_16k.wav"
        })
        .map(|e| e.path())
        .ok_or_else(|| "Audio file not found after download".into())
}

fn whisper_transcribe(model_path: &str, wav_path: &str) -> Result<String, String> {
    let reader = hound::WavReader::open(wav_path)
        .map_err(|e| format!("Failed to read WAV: {e}"))?;
    let spec = reader.spec();

    let samples: Vec<f32> = if spec.sample_format == hound::SampleFormat::Float {
        reader
            .into_samples::<f32>()
            .filter_map(|s| s.ok())
            .collect()
    } else {
        let max_val = (1i64 << (spec.bits_per_sample - 1)) as f32;
        reader
            .into_samples::<i32>()
            .filter_map(|s| s.ok())
            .map(|s| s as f32 / max_val)
            .collect()
    };

    let mut ctx_params = whisper_rs::WhisperContextParameters::default();
    #[cfg(target_os = "macos")]
    {
        if std::env::consts::ARCH != "aarch64" {
            ctx_params.use_gpu(false);
        }
    }

    let ctx = match std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        whisper_rs::WhisperContext::new_with_params(model_path, ctx_params)
    })) {
        Ok(Ok(ctx)) => ctx,
        Ok(Err(_)) | Err(_) => {
            let mut cpu_params = whisper_rs::WhisperContextParameters::default();
            cpu_params.use_gpu(false);
            whisper_rs::WhisperContext::new_with_params(model_path, cpu_params)
                .map_err(|e| format!("Failed to load model: {e}"))?
        }
    };

    let mut state = ctx
        .create_state()
        .map_err(|e| format!("Failed to create state: {e}"))?;

    let mut params =
        whisper_rs::FullParams::new(whisper_rs::SamplingStrategy::Greedy { best_of: 1 });
    params.set_language(Some("en"));
    params.set_print_special(false);
    params.set_print_progress(false);
    params.set_print_realtime(false);
    params.set_print_timestamps(false);

    state
        .full(params, &samples)
        .map_err(|e| format!("Transcription failed: {e}"))?;

    let mut segments = Vec::new();
    for segment in state.as_iter() {
        let text = segment
            .to_str()
            .map_err(|e| format!("Segment text error: {e}"))?;
        let t0 = segment.start_timestamp();
        let t1 = segment.end_timestamp();

        let trimmed = text.trim().to_string();
        if !trimmed.is_empty() {
            segments.push(WhisperSegment {
                text: trimmed,
                start: t0 as f64 / 100.0,
                duration: (t1 - t0) as f64 / 100.0,
            });
        }
    }

    let transcript = WhisperTranscript {
        segments,
        language: "English".to_string(),
        language_code: "en".to_string(),
        is_generated: true,
    };

    serde_json::to_string(&transcript).map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_whisper_status(
    app: tauri::AppHandle,
    model_name: String,
) -> Result<WhisperModelStatus, String> {
    let models_dir = get_whisper_model_dir(&app)?;
    let model_path = models_dir.join(format!("ggml-{}.bin", model_name));
    Ok(WhisperModelStatus {
        downloaded: model_path.exists(),
        path: model_path.to_string_lossy().to_string(),
        size_bytes: if model_path.exists() {
            std::fs::metadata(&model_path).map(|m| m.len()).ok()
        } else {
            None
        },
    })
}

#[tauri::command]
async fn download_whisper_model(
    app: tauri::AppHandle,
    model_name: String,
) -> Result<String, String> {
    let models_dir = get_whisper_model_dir(&app)?;
    std::fs::create_dir_all(&models_dir).map_err(|e| e.to_string())?;

    let model_path = models_dir.join(format!("ggml-{}.bin", model_name));
    let temp_path = models_dir.join(format!("ggml-{}.bin.download", model_name));
    let url = format!(
        "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-{}.bin",
        model_name
    );

    let app_clone = app.clone();
    let mn = model_name.clone();

    tokio::task::spawn_blocking(move || {
        let response = ureq::get(&url).call().map_err(|e| format!("Download failed: {e}"))?;
        let total: u64 = response
            .header("Content-Length")
            .and_then(|v| v.parse().ok())
            .unwrap_or(0);

        let mut file =
            std::fs::File::create(&temp_path).map_err(|e| format!("File create error: {e}"))?;
        let mut reader = response.into_reader();
        let mut downloaded: u64 = 0;
        let mut buf = [0u8; 65536];
        let mut last_emit: u64 = 0;

        loop {
            let n = reader.read(&mut buf).map_err(|e| format!("Read error: {e}"))?;
            if n == 0 {
                break;
            }
            file.write_all(&buf[..n])
                .map_err(|e| format!("Write error: {e}"))?;
            downloaded += n as u64;

            if total > 0 && downloaded - last_emit > 1_048_576 {
                last_emit = downloaded;
                let _ = app_clone.emit(
                    "whisper-model-progress",
                    ModelDownloadProgress {
                        model_name: mn.clone(),
                        downloaded,
                        total,
                    },
                );
            }
        }

        std::fs::rename(&temp_path, &model_path)
            .map_err(|e| format!("Failed to finalize model file: {e}"))?;

        Ok::<String, String>(model_path.to_string_lossy().to_string())
    })
    .await
    .map_err(|e| format!("Download thread error: {e}"))?
}

#[tauri::command]
async fn delete_whisper_model(
    app: tauri::AppHandle,
    model_name: String,
) -> Result<(), String> {
    let models_dir = get_whisper_model_dir(&app)?;
    let model_path = models_dir.join(format!("ggml-{}.bin", model_name));
    if model_path.exists() {
        std::fs::remove_file(&model_path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn transcribe_video(
    app: tauri::AppHandle,
    video_id: String,
    model_name: String,
) -> Result<String, String> {
    let models_dir = get_whisper_model_dir(&app)?;
    let model_path = models_dir.join(format!("ggml-{}.bin", model_name));
    if !model_path.exists() {
        return Err("Whisper model not downloaded. Please download it in Settings.".into());
    }

    let temp_dir = std::env::temp_dir()
        .join("ai-broll-whisper")
        .join(&video_id);
    std::fs::create_dir_all(&temp_dir).map_err(|e| e.to_string())?;

    emit_transcription_progress(&app, &video_id, "downloading_audio", 0.0);

    let audio_template = temp_dir
        .join("audio.%(ext)s")
        .to_string_lossy()
        .to_string();
    let url = format!("https://youtube.com/watch?v={}", video_id);

    let (mut rx, _child) = app
        .shell()
        .sidecar("binaries/yt-dlp")
        .map_err(|e| e.to_string())?
        .args([
            "--no-playlist",
            "--no-part",
            "-f",
            "bestaudio",
            "-o",
            &audio_template,
            &url,
        ])
        .spawn()
        .map_err(|e| format!("Failed to spawn yt-dlp: {e}"))?;

    while let Some(event) = rx.recv().await {
        match event {
            CommandEvent::Terminated(payload) => {
                if payload.code != Some(0) {
                    let _ = std::fs::remove_dir_all(&temp_dir);
                    return Err("Audio download failed".into());
                }
                break;
            }
            CommandEvent::Error(err) => {
                let _ = std::fs::remove_dir_all(&temp_dir);
                return Err(format!("yt-dlp error: {err}"));
            }
            _ => {}
        }
    }

    let audio_path = find_audio_file(&temp_dir).map_err(|e| {
        let _ = std::fs::remove_dir_all(&temp_dir);
        e
    })?;

    emit_transcription_progress(&app, &video_id, "converting_audio", 0.0);

    let wav_path = temp_dir.join("audio_16k.wav");
    let audio_path_str = audio_path.to_string_lossy().to_string();
    let wav_path_str = wav_path.to_string_lossy().to_string();

    let (mut rx, _child) = app
        .shell()
        .sidecar("binaries/ffmpeg")
        .map_err(|e| e.to_string())?
        .args([
            "-i",
            &audio_path_str,
            "-ar",
            "16000",
            "-ac",
            "1",
            "-c:a",
            "pcm_s16le",
            "-y",
            &wav_path_str,
        ])
        .spawn()
        .map_err(|e| format!("Failed to spawn ffmpeg: {e}"))?;

    while let Some(event) = rx.recv().await {
        match event {
            CommandEvent::Terminated(payload) => {
                if payload.code != Some(0) {
                    let _ = std::fs::remove_dir_all(&temp_dir);
                    return Err("Audio conversion failed".into());
                }
                break;
            }
            CommandEvent::Error(err) => {
                let _ = std::fs::remove_dir_all(&temp_dir);
                return Err(format!("ffmpeg error: {err}"));
            }
            _ => {}
        }
    }

    emit_transcription_progress(&app, &video_id, "transcribing", 0.0);

    let model_path_string = model_path.to_string_lossy().to_string();
    let wav_for_whisper = wav_path.to_string_lossy().to_string();

    let transcript_json = tokio::task::spawn_blocking(move || {
        whisper_transcribe(&model_path_string, &wav_for_whisper)
    })
    .await
    .map_err(|e| format!("Transcription thread error: {e}"))??;

    let _ = std::fs::remove_dir_all(&temp_dir);

    emit_transcription_progress(&app, &video_id, "complete", 1.0);

    Ok(transcript_json)
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
        .invoke_handler(tauri::generate_handler![
            download_clip,
            cancel_download,
            ensure_output_dir,
            get_whisper_status,
            download_whisper_model,
            delete_whisper_model,
            transcribe_video
        ])
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
