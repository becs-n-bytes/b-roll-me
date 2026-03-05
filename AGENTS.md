# AGENTS.md

Hierarchical knowledge base for AI agents working on the AI B-Roll codebase.

## System Overview

AI B-Roll is a Tauri v2 desktop application that automates B-Roll footage discovery for video editors. The system is a pipeline: script text goes in, downloaded clip files come out. Each stage is independently triggered or chained via the batch pipeline.

```
Script -> [M1: Analyze] -> Moments -> [M2: Search+Transcript] -> Results -> [M3: Evaluate] -> Scored Clips -> [M4: Download] -> Files
```

## Module Map

### Frontend Layer (React + TypeScript)

#### Pages

**`src/pages/ProjectView.tsx`** - The central nervous system. ~1000 lines. Orchestrates the entire pipeline UI. Contains the script editor (textarea with debounced auto-save), analysis trigger, moment cards with expandable search results, evaluation controls, download buttons, preview modal integration, and the batch "Auto-Analyze" pipeline (a state machine: idle -> confirming -> analyzing -> searching -> evaluating -> complete). Uses refs for cancellation. Reads API keys directly from the settings DB table at each pipeline stage.

**`src/pages/Dashboard.tsx`** - Project list/grid. CRUD operations via `projectStore`. Each project card shows name and timestamps. "New Project" button opens `NewProjectDialog`.

**`src/pages/Settings.tsx`** - Full settings UI. Six sections: API Keys (Anthropic, OpenAI, OpenRouter, Gemini, YouTube with Test Connection buttons), Download Preferences (output dir, format, resolution, concurrent limit), Analysis Preferences (dynamic LLM model selector via `ModelSelector` component that fetches models from all configured provider APIs, per-feature model overrides via `FeatureModelOverride` components driven by `LLM_FEATURES` array, max moments), Application (theme, updates toggle), About (version, app ID). All changes persist immediately via `settingsStore.saveSetting()`.

#### Components

**`src/components/Layout.tsx`** - App shell. Collapsible sidebar (Dashboard, Settings nav items) + top header bar. Uses `settingsStore` for sidebar state.

**`src/components/NewProjectDialog.tsx`** - Modal dialog for project creation. Controlled by open/onClose/onCreate props. Auto-focuses input on open.

**`src/components/PreviewModal.tsx`** - YouTube embed preview. Shows video in iframe with start time parameter. Has +/-1 and +/-5 second time adjustment buttons for start/end. Displays transcript matches as clickable segments that set the time range. Shows evaluation score and description if available. "Download Clip" and "Open in YouTube" actions.

#### Stores (Zustand + SQLite)

All stores follow the same pattern: `create<Interface>((set, get) => ({ ... }))` with async methods that read/write SQLite via `getDb()`.

**`src/stores/settingsStore.ts`** - App settings. `AppSettings` interface defines all configurable values with typed defaults. `loadSettings()` bulk-loads from DB, `saveSetting(key, value)` writes one setting. `getSettingFromDb(key)` is a standalone export for reading settings outside React (used by `callLlm`). Handles serialization/deserialization for string, number, and boolean types. Also manages `sidebarCollapsed` (in-memory only).

**`src/stores/projectStore.ts`** - Project CRUD. `loadProjects()`, `createProject(name)`, `loadProject(id)`, `updateProject(id, updates)`, `deleteProject(id)`. Tracks `projects[]`, `currentProject`, `loaded` state.

**`src/stores/momentStore.ts`** - Analysis results. `loadMoments(projectId)`, `saveMoments(projectId, brollMoments)` (deletes old, inserts new), `clearMoments(projectId)`. Stores parsed `BRollMoment` objects with suggestions.

**`src/stores/searchStore.ts`** - YouTube search results. `searchForMoment(momentId, queries, apiKey)`, `loadResults(momentIds)`. Stores results keyed by moment ID. Also triggers transcript fetching and keyword matching via `searchTranscript()`.

**`src/stores/evaluationStore.ts`** - LLM evaluations. `evaluateMoment(...)` sends search results to the LLM for scoring. Stores `evaluations: Map<string, EvaluatedClip[]>` keyed by moment ID. `toggleSort()` switches between default and score-sorted display.

**`src/stores/downloadStore.ts`** - Download queue. `addToQueue(item)` adds and auto-starts. `processQueue()` respects `max_concurrent_downloads` from settings. Tracks status (pending/downloading/complete/error/cancelled), progress lines, and records completions to the `downloaded_clips` table.

#### Lib (Business Logic)

**`src/lib/models.ts`** - Model discovery and selection. `fetchAllModels(keys)` queries all 4 provider APIs (Anthropic, OpenAI, OpenRouter, Gemini) in parallel via `Promise.allSettled` and returns `ModelOption[]`. `parseModelValue(value)` splits a `provider:model_id` string. `toModelValue(provider, modelId)` creates one. Exports `LlmProvider` and `ModelOption` types. Per-provider fetch functions apply filters (Anthropic: `claude-*` only; OpenAI: excludes instruct/realtime/audio/transcription; Gemini: `generateContent` support only). OpenRouter listing requires no auth.

**`src/lib/llm.ts`** - LLM abstraction. `callLlm(systemPrompt, userMessage, apiKey, model?)` uses `parseModelValue()` to determine provider, then routes to `callAnthropic()`, `callOpenAi()`, `callOpenAiCompatible()` (for OpenRouter), or `callGemini()`. `analyzeScript(scriptText, apiKey, model?)` is the high-level analysis function. All API calls use `fetch` from `@tauri-apps/plugin-http`.

**`src/lib/evaluator.ts`** - Clip evaluation. `evaluateClips(scriptExcerpt, editorialNote, suggestionDescriptions, results, apiKey, model?)` sends a batch of search results to the LLM for scoring. Uses `callLlm()` internally. `estimateEvaluationTokens()` provides cost estimates.

**`src/lib/youtube.ts`** - YouTube Data API v3. `searchYouTube(query, apiKey, maxResults)` does a two-phase search: Search endpoint for video IDs, then Videos endpoint for duration and caption metadata. Returns `YouTubeResult[]`.

**`src/lib/transcript.ts`** - YouTube transcript fetching. `fetchTranscript(videoId)` scrapes the YouTube page for embedded caption data, parses XML tracks into `TranscriptSegment[]`. Caches results in the `transcript_cache` table. `searchTranscript(segments, keywords)` performs keyword matching and returns `TranscriptMatch[]` with timestamps.

**`src/lib/downloader.ts`** - Tauri invoke wrappers. `downloadClip(clipId, videoUrl, startTime, endTime, outputPath, onProgress)` calls the Rust `download_clip` command and listens for `download-progress` events. `cancelDownload(clipId)` and `ensureOutputDir(path)` are also thin wrappers.

**`src/lib/prompts.ts`** - System prompts. `BROLL_SYSTEM_PROMPT` instructs the LLM to identify B-Roll moments and return structured JSON. `EVALUATION_SYSTEM_PROMPT` instructs the LLM to score clips on a 0-100 scale with specific guidelines for each range.

**`src/lib/database.ts`** - SQLite singleton. `getDb()` returns a cached `Database` instance loaded from `sqlite:ai-broll.db`.

#### Types

**`src/types/index.ts`** - All shared interfaces: `Project`, `BRollMoment`, `BRollSuggestion`, `Moment`, `SearchResult`, `EvaluatedClip`, `TranscriptSegment`, `TranscriptMatch`, `AppSettings`. Type unions: `VideoFormat`, `Resolution`. `LlmModel` is a `string` type (was a fixed union; now dynamic since models are fetched from provider APIs).

### Backend Layer (Rust + Tauri v2)

**`src-tauri/src/lib.rs`** - The entire Rust backend in one file. Contains:
- `AppState` struct with `Mutex<HashMap<String, CommandChild>>` for tracking active downloads
- `download_clip` command: spawns yt-dlp sidecar with `--download-sections` for time ranges, streams stdout/stderr as `download-progress` events
- `cancel_download` command: kills active download process
- `ensure_output_dir` command: creates directories recursively
- `migrations()` function: single migration with all 7 CREATE TABLE statements
- `run()` function: Tauri builder with all plugins (opener, http, shell, sql) and state management

**`src-tauri/tauri.conf.json`** - Tauri configuration. CSP is null (no restrictions). External binaries: yt-dlp and ffmpeg. Window: 1200x800, min 900x600.

**`src-tauri/capabilities/default.json`** - Security permissions. HTTP fetch is scoped to Anthropic, OpenAI, OpenRouter, Google APIs (Gemini + YouTube). Shell spawn/execute is scoped to the two sidecar binaries only.

### Test Infrastructure

**`src/test/setup.ts`** - Global mock layer. Mocks all Tauri plugins so tests run without the native runtime. `mockDb.select` returns `[]` and `mockDb.execute` returns `{ rowsAffected: 0 }` by default. Individual tests override these per-test.

**`src/test/mocks.ts`** - Shared mock utilities. Has known pre-existing TS errors about `require` (harmless).

Test files are colocated in `__tests__/` directories next to their source:
- `src/lib/__tests__/` - 6 test files (llm, models, evaluator, youtube, transcript, downloader)
- `src/stores/__tests__/` - 6 test files (settings, project, moment, search, evaluation, download)
- `src/pages/__tests__/` - 3 test files (Dashboard, ProjectView, Settings)

## Data Flow Details

### Script Analysis Flow
1. User types in textarea -> debounced save to `projects.script_text`
2. "Analyze" button clicked -> read `anthropic_api_key` from settings table
3. `analyzeScript()` -> `callLlm()` -> Anthropic/OpenAI API -> parse JSON response
4. `momentStore.saveMoments()` -> DELETE old moments -> INSERT new ones
5. UI re-renders moment cards

### Search Flow
1. Per moment, "Search" button -> read `youtube_api_key` from settings table
2. `searchStore.searchForMoment()` -> `searchYouTube()` for each query
3. Deduplicate by video ID -> INSERT into `search_results` table
4. For each result with captions: `fetchTranscript()` -> cache in `transcript_cache`
5. `searchTranscript()` matches keywords -> UPDATE `transcript_matches_json`

### Evaluation Flow
1. "Evaluate" button -> read `anthropic_api_key`
2. `evaluationStore.evaluateMoment()` -> `evaluateClips()` -> `callLlm()`
3. LLM returns scores, timestamps, descriptions for each video
4. DELETE old evaluations -> INSERT new ones to `evaluated_clips`
5. UI shows score badges (color-coded by range)

### Download Flow
1. "Download" button -> `downloadStore.addToQueue()`
2. `processQueue()` checks active count vs `max_concurrent_downloads` setting
3. `downloadClip()` -> Rust `download_clip` command -> yt-dlp sidecar
4. Progress events streamed via Tauri event system
5. Completion -> INSERT into `downloaded_clips` table

### Batch Pipeline Flow
1. "Auto-Analyze" button -> confirmation dialog
2. State machine: analyzing -> searching -> evaluating -> complete
3. Each stage reads fresh API keys and uses `useXStore.getState()` for latest state
4. Cancellation via ref: `cancelRef.current = true`, checked between stages
5. Auto-dismiss completion message after 5 seconds

## Key Patterns

### Settings Access
- **In React components**: `useSettingsStore()` hook
- **In lib functions**: `getSettingFromDb(key)` standalone async function
- **In stores**: `useSettingsStore.getState().settings.xxx` for synchronous reads
- **API keys in ProjectView**: Direct DB reads via `getDb()` (predates the store pattern)

### Error Handling
- LLM calls: 401 -> "Invalid API key", 429 -> "Rate limited", 5xx -> "Server error"
- YouTube: 403 + quotaExceeded -> "Quota exceeded", 400 -> "Invalid key"
- Downloads: yt-dlp exit code != 0 -> error message, signal -> "cancelled"
- All errors surface in the UI via store error state

### Per-Feature Model Overrides
Each LLM feature can use a different model via override settings. The pattern:
- Settings key: `{feature}_model_override` (empty string = use default `llm_model`)
- UI: Toggle + searchable dropdown per feature in Settings > Analysis Preferences
- Wiring: Call site reads override via `getSettingFromDb("{feature}_model_override") || undefined`, passes to the LLM function

Current features with overrides:
1. **Script Analysis** — `analysis_model_override` — `analyzeScript()` in `llm.ts`, called from ProjectView
2. **Clip Evaluation** — `evaluation_model_override` — `evaluateClips()` in `evaluator.ts`, called via `evaluationStore.evaluateMoment()`

**When adding a new LLM feature**: Add override key to `AppSettings`, `DEFAULTS`, `LLM_FEATURES` array in Settings.tsx, and wire the call site. See CLAUDE.md for the full checklist.

### Concurrent Operations
- Downloads: controlled by `max_concurrent_downloads` setting (1-5)
- Search: sequential per moment (to avoid YouTube quota spikes)
- Evaluation: one moment at a time (tracked by `evaluatingMoments` Set)

## Gotchas

1. **CSP is null** in tauri.conf.json. This means no Content Security Policy restrictions, which is why YouTube iframes work without extra configuration. This should be tightened before production.

2. **The ffmpeg sidecar is dynamically linked** (~432K from Homebrew). It works for development but will fail on machines without the same shared libraries. Needs a static build for distribution.

3. **ProjectView.tsx reads API keys directly from the DB** instead of using `getSettingFromDb()`. This predates the settings store expansion and works fine, but is inconsistent with the rest of the codebase.

4. **The model is not passed through the full call chain in ProjectView**. When `analyzeScript()` is called from ProjectView, it doesn't pass a model parameter, so it falls back to `getSettingFromDb("llm_model")` inside `callLlm()`. This is correct behavior but may be non-obvious.

5. **`transcript_cache` does not expire**. Cached transcripts are stored indefinitely. If a video's captions change, the app will use stale data until the cache row is manually deleted.

6. **All table IDs are TEXT (UUIDs)** generated client-side via `crypto.randomUUID()`. There are no auto-incrementing integer IDs anywhere in the schema.

7. **Dynamic model design**: Models stored as `provider:model_id` format (e.g., `anthropic:claude-sonnet-4-20250514`). `callLlm()` uses `parseModelValue()` to split provider and route accordingly. Legacy model strings without a colon default to Anthropic provider.
