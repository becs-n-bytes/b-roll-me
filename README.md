# AI B-Roll

A desktop app that helps video editors find and download B-Roll footage. Paste a script, and the app uses AI to identify moments where B-Roll would enhance the video, searches YouTube for matching clips, evaluates them for relevance, and downloads the best segments.

Built with Tauri v2, React, TypeScript, and SQLite.

## How It Works

1. **Analyze** - Paste your video script. The AI reads it and identifies moments where B-Roll footage would improve the video (cutaways, event footage, illustrative visuals).
2. **Search** - For each moment, the app generates YouTube search queries and finds candidate clips. It fetches transcripts and matches them against what you need.
3. **Evaluate** - The AI scores each candidate clip for relevance (0-100), suggests precise timestamps, and flags unusable results.
4. **Preview** - Watch clips in an embedded player, adjust start/end times, and see transcript matches highlighted.
5. **Download** - Download selected clip segments via yt-dlp. The app handles queuing, concurrent downloads, and file organization.

There's also an "Auto-Analyze" button that runs steps 1-3 as a single pipeline.

## Prerequisites

- **Node.js** >= 20.x
- **Rust** >= 1.70 (install via [rustup](https://rustup.rs/))
- **yt-dlp** and **ffmpeg** (installed via Homebrew or equivalent, then copied as sidecars - see below)

### API Keys (BYOK)

The app does not ship with API keys. You provide your own in Settings:

- **Anthropic API Key** - For script analysis and clip evaluation. Get one at [console.anthropic.com](https://console.anthropic.com/).
- **YouTube Data API Key** - For searching YouTube. Get one from [Google Cloud Console](https://console.cloud.google.com/apis/credentials) with the YouTube Data API v3 enabled.
- **OpenAI API Key** (optional) - Only needed if you select GPT-4o as the analysis model.

## Setup

```bash
# Clone the repo
git clone <repo-url>
cd b-roll-me

# Install frontend dependencies
npm install

# Install Rust dependencies (first time)
source "$HOME/.cargo/env"
cd src-tauri && cargo check && cd ..
```

### Sidecar Binaries

The app bundles yt-dlp and ffmpeg as Tauri sidecars. These must be placed in `src-tauri/binaries/` with the target triple suffix:

```bash
# macOS ARM64 example
cp $(which yt-dlp) src-tauri/binaries/yt-dlp-aarch64-apple-darwin
cp $(which ffmpeg) src-tauri/binaries/ffmpeg-aarch64-apple-darwin

# macOS x86_64
cp $(which yt-dlp) src-tauri/binaries/yt-dlp-x86_64-apple-darwin
cp $(which ffmpeg) src-tauri/binaries/ffmpeg-x86_64-apple-darwin

# Linux x86_64
cp $(which yt-dlp) src-tauri/binaries/yt-dlp-x86_64-unknown-linux-gnu
cp $(which ffmpeg) src-tauri/binaries/ffmpeg-x86_64-unknown-linux-gnu
```

The yt-dlp standalone binary (~35MB) works well. The ffmpeg binary from Homebrew is dynamically linked (~432K) and works for development but needs a static build for distribution.

## Running

```bash
# Full desktop app (Tauri + Vite + Rust)
npm run tauri dev

# Frontend only in browser (no Tauri backend - API calls won't work)
npm run dev
```

The Tauri dev command compiles the Rust backend, starts Vite on port 1420, and opens the desktop window. First build takes a few minutes for Rust compilation; subsequent runs use incremental builds.

## Testing

```bash
# Run all frontend tests (188 tests across 14 files)
npm test

# Watch mode
npm run test:watch

# Coverage report (covers src/lib/ and src/stores/)
npm run test:coverage

# Rust backend tests (7 tests)
cd src-tauri && source "$HOME/.cargo/env" && cargo test

# Type checking (no emit)
npx tsc --noEmit
```

The test suite uses Vitest with jsdom. All Tauri APIs (`@tauri-apps/plugin-sql`, `@tauri-apps/plugin-http`, `@tauri-apps/api/core`, etc.) are globally mocked in `src/test/setup.ts`, so frontend tests run without the Tauri runtime.

## Architecture

```
User pastes script
       |
       v
  [Analyze Script]  ------>  Anthropic/OpenAI API (via plugin-http)
       |
       v
  [B-Roll Moments]  stored in SQLite "moments" table
       |
       v
  [Search YouTube]  ------>  YouTube Data API v3 (via plugin-http)
       |
       v
  [Search Results]  stored in "search_results" table
       |
       v
  [Fetch Transcripts]  ---->  YouTube transcript endpoint
       |
       v
  [Evaluate Clips]  ------>  Anthropic/OpenAI API (via plugin-http)
       |
       v
  [Evaluated Clips]  stored in "evaluated_clips" table
       |
       v
  [Preview & Select]  embedded YouTube player
       |
       v
  [Download Clips]  ------>  yt-dlp sidecar (Rust subprocess)
       |
       v
  [Downloaded Files]  stored in "downloaded_clips" table
```

### Frontend (React + TypeScript)

The frontend is a single-page app with three routes:

- **Dashboard** (`/`) - Project grid with create/delete. Each project is a separate script analysis workspace.
- **Project View** (`/project/:id`) - The main workspace. Script editor, analysis results, search results, evaluation scores, download queue, preview modal, and batch pipeline controls.
- **Settings** (`/settings`) - API keys (with Test Connection), download preferences, analysis preferences, theme, and about section.

State is managed with Zustand stores, each backed by SQLite for persistence:

| Store | Purpose |
|-------|---------|
| `projectStore` | Project CRUD, current project |
| `momentStore` | Analysis moments per project |
| `searchStore` | YouTube search results per moment |
| `evaluationStore` | LLM evaluation scores per moment |
| `downloadStore` | Download queue with concurrent processing |
| `settingsStore` | App settings with DB persistence |

### Backend (Rust + Tauri v2)

The Rust backend is thin. It handles:

- **SQLite** - Schema migration (7 tables) via `tauri-plugin-sql`
- **yt-dlp sidecar** - Spawning download processes, streaming progress events, cancellation
- **ffmpeg sidecar** - Used by yt-dlp for post-processing (merge formats, trim clips)
- **File system** - Creating output directories

Three Tauri commands are exposed to the frontend: `download_clip`, `cancel_download`, `ensure_output_dir`.

All API calls (Anthropic, OpenAI, YouTube) happen from the frontend using `@tauri-apps/plugin-http`, which provides a `fetch()` that bypasses CORS restrictions.

### Database Schema

SQLite database at `ai-broll.db` with 7 tables:

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `projects` | User's projects | id, name, script_text, output_directory |
| `moments` | Analysis results | id, project_id (FK), script_excerpt, suggestions_json |
| `search_results` | YouTube results | id, moment_id (FK), video_id, transcript_matches_json |
| `evaluated_clips` | LLM evaluations | id, search_result_id (FK), relevance_score, usable |
| `downloaded_clips` | Completed downloads | id, moment_id (FK), video_id, file_path |
| `transcript_cache` | Cached transcripts | video_id (PK), transcript_json |
| `settings` | Key-value settings | key (PK), value |

All IDs are UUIDs (TEXT). Cascading deletes propagate from projects down through moments to search results, evaluations, and downloads.

## Project Structure

```
b-roll-me/
  src/
    main.tsx                    # React entry point
    App.tsx                     # Router (/, /project/:id, /settings)
    index.css                   # Tailwind v4 base styles
    types/index.ts              # All TypeScript interfaces and type unions
    components/
      Layout.tsx                # App shell: collapsible sidebar + top bar
      NewProjectDialog.tsx      # Modal for creating projects
      PreviewModal.tsx          # YouTube embed player with time controls
    pages/
      Dashboard.tsx             # Project grid
      ProjectView.tsx           # Main workspace (~1000 lines)
      Settings.tsx              # Settings with API key validation
    stores/
      settingsStore.ts          # App settings with DB persistence
      projectStore.ts           # Project CRUD
      momentStore.ts            # Analysis moments
      searchStore.ts            # YouTube search results + transcripts
      evaluationStore.ts        # LLM clip evaluations
      downloadStore.ts          # Download queue management
    lib/
      database.ts               # SQLite singleton via plugin-sql
      llm.ts                    # LLM abstraction (Anthropic + OpenAI routing)
      prompts.ts                # System prompts for analysis and evaluation
      youtube.ts                # YouTube Data API v3 search
      transcript.ts             # YouTube transcript fetching + search
      evaluator.ts              # Clip evaluation via LLM
      downloader.ts             # Tauri invoke wrappers for yt-dlp
    test/
      setup.ts                  # Global Tauri API mocks
      mocks.ts                  # Shared test utilities
  src-tauri/
    src/lib.rs                  # Rust backend: commands + migrations
    Cargo.toml                  # Rust dependencies
    tauri.conf.json             # Tauri config (window, sidecars, CSP)
    capabilities/default.json   # Permission declarations
    binaries/                   # yt-dlp + ffmpeg sidecars
  vite.config.ts                # Vite + React + Tailwind, port 1420
  vitest.config.ts              # Test config: jsdom, globals, setup file
  tsconfig.json                 # Strict TS with no unused vars/params
  package.json                  # Scripts: dev, build, test, tauri
```

## Development Roadmap

Issues are tracked on GitHub, organized in phases:

| Phase | Tickets | Status |
|-------|---------|--------|
| **0 - Scaffolding** | #1-3 (Tauri init, frontend tooling, SQLite) | Done |
| **1 - MVP** | #4-10 (Projects, analysis, search, transcripts, downloads) | Done |
| **2 - Polish** | #11-14 (Evaluator, preview, pipeline, settings) | Done |
| **3 - Monetization** | #15-19 (Licensing, credits, auto-updates, signing, distribution) | Open |
| **4 - Future** | #20-26 (Audio input, stock footage, timeline export, collaboration) | Open |

## License

TBD
