import { create } from "zustand";
import { getDb } from "../lib/database";
import type { AppSettings, VideoFormat, Resolution, LlmModel } from "../types";

const DEFAULTS: AppSettings = {
  anthropic_api_key: "",
  openai_api_key: "",
  openrouter_api_key: "",
  gemini_api_key: "",
  default_output_dir: "",
  video_format: "mp4",
  resolution: "best",
  max_concurrent_downloads: 2,
  llm_model: "anthropic:claude-sonnet-4-20250514",
  analysis_model_override: "",
  evaluation_model_override: "",
  max_moments_per_analysis: 10,
  theme: "dark",
  check_for_updates: true,
};

interface SettingsState {
  sidebarCollapsed: boolean;
  settings: AppSettings;
  loaded: boolean;
  toggleSidebar: () => void;
  loadSettings: () => Promise<void>;
  saveSetting: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => Promise<void>;
  getSetting: <K extends keyof AppSettings>(key: K) => AppSettings[K];
}

function deserialize<K extends keyof AppSettings>(key: K, raw: string): AppSettings[K] {
  const trimmed = raw.trim();
  if (key === "max_concurrent_downloads" || key === "max_moments_per_analysis") {
    return Number(trimmed) as AppSettings[K];
  }
  if (key === "check_for_updates") {
    return (trimmed === "true") as AppSettings[K];
  }
  return trimmed as AppSettings[K];
}

function serialize(value: unknown): string {
  return String(value);
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  sidebarCollapsed: false,
  settings: { ...DEFAULTS },
  loaded: false,

  toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),

  loadSettings: async () => {
    const db = await getDb();
    const rows = await db.select<{ key: string; value: string }[]>(
      "SELECT key, value FROM settings"
    );
    const overrides: Partial<AppSettings> = {};
    for (const row of rows) {
      if (row.key in DEFAULTS) {
        const k = row.key as keyof AppSettings;
        (overrides as Record<string, unknown>)[k] = deserialize(k, row.value);
      }
    }
    set({ settings: { ...DEFAULTS, ...overrides }, loaded: true });
  },

  saveSetting: async (key, value) => {
    const db = await getDb();
    const raw = serialize(value).trim();
    await db.execute(
      "INSERT OR REPLACE INTO settings (key, value) VALUES ($1, $2)",
      [key, raw]
    );
    set((state) => ({
      settings: { ...state.settings, [key]: deserialize(key, raw) },
    }));
  },

  getSetting: (key) => get().settings[key],
}));

export async function getSettingFromDb<K extends keyof AppSettings>(
  key: K
): Promise<AppSettings[K]> {
  const store = useSettingsStore.getState();
  if (store.loaded) return store.settings[key];
  const db = await getDb();
  const rows = await db.select<{ value: string }[]>(
    "SELECT value FROM settings WHERE key = $1",
    [key]
  );
  if (rows.length > 0 && rows[0].value) {
    return deserialize(key, rows[0].value);
  }
  return DEFAULTS[key];
}

export { DEFAULTS as SETTING_DEFAULTS };
export type { VideoFormat, Resolution, LlmModel };
