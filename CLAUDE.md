# CLAUDE.md

Instructions for AI agents working on this codebase.

## Quick Reference

```bash
# Build & verify
npx tsc --noEmit                  # TypeScript check (ignore mocks.ts errors)
npx vite build                    # Frontend production build
npm test                          # 214 Vitest tests
source "$HOME/.cargo/env" && cd src-tauri && cargo test  # 7 Rust tests

# Development
npm run tauri dev                 # Full app (Tauri + Vite)
npm run dev                       # Frontend only (port 1420)
npm run test:watch                # Vitest watch mode
```

## Code Conventions

### No Comments
Do not write comments in source code. The code should be self-documenting through clear naming.

### No Type Suppression
Never use `as any`, `@ts-ignore`, or `@ts-expect-error`. Fix the actual types.

### No Unused Variables
TypeScript is configured with `noUnusedLocals` and `noUnusedParameters`. Every variable and parameter must be used.

### Dark Theme Colors
- Background: `#0a0a0a`
- Sidebar: `#171717`
- Cards/sections: `bg-neutral-900`
- Borders: `border-neutral-800`
- Text hierarchy: `text-neutral-100` (headings), `text-neutral-200` (body), `text-neutral-400` (labels), `text-neutral-500` (secondary), `text-neutral-600` (help text)

### SQLite Parameter Style
Use positional parameters `$1`, `$2`, `$3` for SQLite queries. NOT `?` placeholders.

```typescript
// Correct
await db.execute("INSERT INTO settings (key, value) VALUES ($1, $2)", [key, value]);

// Wrong
await db.execute("INSERT INTO settings (key, value) VALUES (?, ?)", [key, value]);
```

### Store Pattern (Zustand)
Every store follows this pattern:
- `create<StateInterface>((set, get) => ({ ... }))` 
- Async operations use `getDb()` for database access
- Stores are the single source of truth for their domain
- Other modules can read store state mid-async with `useXStore.getState()`

### API Calls
All HTTP requests to external APIs use `fetch` from `@tauri-apps/plugin-http`, not the browser's native fetch. This is required because Tauri's fetch bypasses CORS.

```typescript
import { fetch } from "@tauri-apps/plugin-http";
```

### LLM Integration
Four providers are supported: Anthropic, OpenAI, OpenRouter, and Google Gemini. Models are stored as `provider:model_id` strings (e.g., `anthropic:claude-sonnet-4-20250514`, `openai:gpt-4o`, `openrouter:anthropic/claude-3.5-sonnet`, `gemini:gemini-2.5-flash`). The `callLlm()` function in `src/lib/llm.ts` uses `parseModelValue()` to split the provider and route accordingly. The model selector in Settings dynamically fetches available models from all configured provider APIs. Functions that call the LLM accept an optional `model?: string` parameter; if omitted, the user's configured model from settings is used.

### Tauri v2 Specifics

**Config structure** (different from Tauri v1):
- `app.windows[]` not `tauri.windows[]`
- `build.devUrl` not `build.devPath`
- `build.frontendDist` not `build.distDir`
- Top-level `identifier` field

**Invoke parameter names** must match exactly between Rust snake_case and JS snake_case:
```typescript
// JS side
await invoke("download_clip", { clip_id: "abc", video_url: "..." });
// Rust side
async fn download_clip(clip_id: String, video_url: String) -> Result<String, String>
```

**Sidecar API**:
- In Rust: `app.shell().sidecar("binaries/yt-dlp")`
- In JS: `Command.sidecar('binaries/yt-dlp')`
- Both auto-resolve the target triple suffix

**Capabilities** replace Tauri v1's allowlist. Permissions are declared in `src-tauri/capabilities/default.json`.

## Testing

### Global Mocks
`src/test/setup.ts` globally mocks all Tauri APIs:
- `@tauri-apps/plugin-sql` - `Database.load()` returns a mock with `select` (returns `[]`) and `execute` (returns `{ rowsAffected: 0 }`)
- `@tauri-apps/plugin-http` - `fetch` is a `vi.fn()` (returns undefined by default)
- `@tauri-apps/api/core` - `invoke` is a `vi.fn()`
- `@tauri-apps/api/event` - `listen` returns a noop unlisten function
- `@tauri-apps/api/path` - `downloadDir` returns `/mock/Downloads/`
- `@tauri-apps/plugin-opener` - `revealItemInDir` and `open` are noops

### Test File Structure
Tests live next to their source in `__tests__/` directories:
- `src/lib/__tests__/` - Unit tests for pure functions
- `src/stores/__tests__/` - Integration tests for Zustand stores
- `src/pages/__tests__/` - Component render tests

### Writing New Tests
- Use `vi.hoisted()` when mock variables need to be referenced in `vi.mock()` factories
- Reset store state in `beforeEach` with `useXStore.setState({ ... })`
- For store tests, mock `../../lib/database` with a hoisted `mockDb`
- For page tests, set store state to `loaded: true` before rendering
- Do not write comments in test code

### Known Pre-existing Issues
`src/test/mocks.ts` has TypeScript errors about `require` not being defined. These are harmless and have existed since Phase 1. They show up in `tsc --noEmit` output but do not affect tests.

## Database

SQLite file: `ai-broll.db` (in Tauri's app data directory at runtime).

Seven tables, all with TEXT primary keys (UUIDs). Schema is defined in `src-tauri/src/lib.rs` in the `migrations()` function. Foreign keys cascade on delete from `projects` down through `moments` -> `search_results` -> `evaluated_clips`.

The `settings` table is a simple key-value store. All settings are stored as text and deserialized on read (numbers via `Number()`, booleans via `=== "true"`).

## Project Modules

### lib/models.ts
Model discovery and selection. `fetchAllModels()` queries all 4 provider APIs in parallel via `Promise.allSettled` and returns `ModelOption[]` with provider, id, and display name. `parseModelValue()` splits a `provider:model_id` string. `toModelValue()` creates one. Provider-specific fetch functions filter results (e.g., Anthropic to `claude-*` only, OpenAI excludes instruct/realtime/audio, Gemini filters to `generateContent` support). OpenRouter models are always fetched (no key required for listing).

### lib/llm.ts
LLM abstraction layer. Exports `callLlm()` (generic), `analyzeScript()` (for B-Roll analysis). Uses `parseModelValue()` from `models.ts` to determine provider, then routes to `callAnthropic()`, `callOpenAi()`, `callOpenAiCompatible()` (OpenRouter), or `callGemini()`. Handles auth errors, rate limits, and server errors.

### lib/evaluator.ts
Clip evaluation via LLM. Takes search results with transcript matches and returns relevance scores, suggested timestamps, and usability flags. Uses `callLlm()` internally.

### lib/youtube.ts
YouTube Data API v3 wrapper. Two-phase search: first the Search endpoint for video IDs, then the Videos endpoint for duration and caption details. Returns structured `YouTubeResult` objects.

### lib/transcript.ts
Fetches YouTube transcripts from the YouTube page's embedded data, parses XML caption tracks. `searchTranscript()` performs keyword matching against transcript segments and returns time-stamped matches.

### lib/downloader.ts
Thin wrappers around Tauri invoke calls. `downloadClip()` listens for progress events and delegates to the Rust backend's yt-dlp sidecar.

### lib/prompts.ts
System prompts for the two LLM operations: `BROLL_SYSTEM_PROMPT` (script analysis) and `EVALUATION_SYSTEM_PROMPT` (clip scoring). Both instruct the LLM to return JSON.

### stores/settingsStore.ts
App-wide settings with SQLite persistence. `loadSettings()` reads all rows from the settings table and merges with defaults. `saveSetting()` writes to DB and updates store. `getSettingFromDb()` is a standalone helper for reading a setting outside of React components (used by `callLlm()`).

### pages/ProjectView.tsx
The largest file (~1000 lines). Contains the full project workspace: script editor with debounced save, analysis trigger, moment cards, search results with thumbnails, evaluation badges, download queue, preview modal integration, and the batch pipeline state machine.

## Adding New Features

1. If the feature needs new data, add a column/table to the migration SQL in `lib.rs` (increment migration version)
2. Add TypeScript types to `src/types/index.ts`
3. Create or update a Zustand store in `src/stores/`
4. Update the relevant page/component
5. Write tests alongside the code
6. Verify: `npx tsc --noEmit && npx vite build && npm test`
