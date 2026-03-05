import { describe, it, expect, beforeEach, vi } from "vitest";
import { useSettingsStore, getSettingFromDb, SETTING_DEFAULTS } from "../settingsStore";

const { mockDb } = vi.hoisted(() => {
  const mockDb = {
    select: vi.fn().mockResolvedValue([]),
    execute: vi.fn().mockResolvedValue({ rowsAffected: 0 }),
  };
  return { mockDb };
});

vi.mock("../../lib/database", () => ({
  getDb: vi.fn().mockResolvedValue(mockDb),
}));

describe("settingsStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.select.mockResolvedValue([]);
    useSettingsStore.setState({
      sidebarCollapsed: false,
      settings: { ...SETTING_DEFAULTS },
      loaded: false,
    });
  });

  it("has correct defaults", () => {
    const { settings } = useSettingsStore.getState();
    expect(settings.anthropic_api_key).toBe("");
    expect(settings.openai_api_key).toBe("");
    expect(settings.youtube_api_key).toBe("");
    expect(settings.default_output_dir).toBe("");
    expect(settings.video_format).toBe("mp4");
    expect(settings.resolution).toBe("best");
    expect(settings.max_concurrent_downloads).toBe(2);
    expect(settings.llm_model).toBe("claude-sonnet-4-20250514");
    expect(settings.max_moments_per_analysis).toBe(10);
    expect(settings.theme).toBe("dark");
    expect(settings.check_for_updates).toBe(true);
  });

  it("toggleSidebar flips sidebarCollapsed", () => {
    expect(useSettingsStore.getState().sidebarCollapsed).toBe(false);
    useSettingsStore.getState().toggleSidebar();
    expect(useSettingsStore.getState().sidebarCollapsed).toBe(true);
    useSettingsStore.getState().toggleSidebar();
    expect(useSettingsStore.getState().sidebarCollapsed).toBe(false);
  });

  it("loadSettings fetches all rows from DB", async () => {
    mockDb.select.mockResolvedValue([
      { key: "anthropic_api_key", value: "sk-ant-test" },
      { key: "video_format", value: "webm" },
    ]);

    await useSettingsStore.getState().loadSettings();

    const { settings, loaded } = useSettingsStore.getState();
    expect(loaded).toBe(true);
    expect(settings.anthropic_api_key).toBe("sk-ant-test");
    expect(settings.video_format).toBe("webm");
    expect(settings.resolution).toBe("best");
  });

  it("loadSettings deserializes numbers correctly", async () => {
    mockDb.select.mockResolvedValue([
      { key: "max_concurrent_downloads", value: "4" },
      { key: "max_moments_per_analysis", value: "15" },
    ]);

    await useSettingsStore.getState().loadSettings();

    const { settings } = useSettingsStore.getState();
    expect(settings.max_concurrent_downloads).toBe(4);
    expect(settings.max_moments_per_analysis).toBe(15);
  });

  it("loadSettings deserializes booleans correctly", async () => {
    mockDb.select.mockResolvedValue([
      { key: "check_for_updates", value: "false" },
    ]);

    await useSettingsStore.getState().loadSettings();

    expect(useSettingsStore.getState().settings.check_for_updates).toBe(false);
  });

  it("loadSettings ignores unknown keys", async () => {
    mockDb.select.mockResolvedValue([
      { key: "unknown_key", value: "whatever" },
      { key: "theme", value: "light" },
    ]);

    await useSettingsStore.getState().loadSettings();

    expect(useSettingsStore.getState().settings.theme).toBe("light");
  });

  it("loadSettings with empty DB uses all defaults", async () => {
    mockDb.select.mockResolvedValue([]);

    await useSettingsStore.getState().loadSettings();

    const { settings, loaded } = useSettingsStore.getState();
    expect(loaded).toBe(true);
    expect(settings).toEqual(SETTING_DEFAULTS);
  });

  it("saveSetting persists to DB and updates store", async () => {
    await useSettingsStore.getState().saveSetting("anthropic_api_key", "sk-ant-new");

    expect(mockDb.execute).toHaveBeenCalledWith(
      "INSERT OR REPLACE INTO settings (key, value) VALUES ($1, $2)",
      ["anthropic_api_key", "sk-ant-new"]
    );
    expect(useSettingsStore.getState().settings.anthropic_api_key).toBe("sk-ant-new");
  });

  it("saveSetting serializes numbers", async () => {
    await useSettingsStore.getState().saveSetting("max_concurrent_downloads", 5);

    expect(mockDb.execute).toHaveBeenCalledWith(
      "INSERT OR REPLACE INTO settings (key, value) VALUES ($1, $2)",
      ["max_concurrent_downloads", "5"]
    );
    expect(useSettingsStore.getState().settings.max_concurrent_downloads).toBe(5);
  });

  it("saveSetting serializes booleans", async () => {
    await useSettingsStore.getState().saveSetting("check_for_updates", false);

    expect(mockDb.execute).toHaveBeenCalledWith(
      "INSERT OR REPLACE INTO settings (key, value) VALUES ($1, $2)",
      ["check_for_updates", "false"]
    );
    expect(useSettingsStore.getState().settings.check_for_updates).toBe(false);
  });

  it("getSetting returns current value", () => {
    useSettingsStore.setState({
      settings: { ...SETTING_DEFAULTS, llm_model: "gpt-4o" },
    });

    expect(useSettingsStore.getState().getSetting("llm_model")).toBe("gpt-4o");
  });

  it("getSetting returns default for unset values", () => {
    expect(useSettingsStore.getState().getSetting("video_format")).toBe("mp4");
  });

  it("saveSetting for model selection", async () => {
    await useSettingsStore.getState().saveSetting("llm_model", "claude-haiku-4-20250414");

    expect(useSettingsStore.getState().settings.llm_model).toBe("claude-haiku-4-20250414");
  });

  it("saveSetting for resolution", async () => {
    await useSettingsStore.getState().saveSetting("resolution", "1080");

    expect(useSettingsStore.getState().settings.resolution).toBe("1080");
  });
});

describe("getSettingFromDb", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.select.mockResolvedValue([]);
    useSettingsStore.setState({
      sidebarCollapsed: false,
      settings: { ...SETTING_DEFAULTS },
      loaded: false,
    });
  });

  it("returns from store if loaded", async () => {
    useSettingsStore.setState({
      settings: { ...SETTING_DEFAULTS, llm_model: "gpt-4o" },
      loaded: true,
    });

    const result = await getSettingFromDb("llm_model");
    expect(result).toBe("gpt-4o");
    expect(mockDb.select).not.toHaveBeenCalled();
  });

  it("queries DB if not loaded", async () => {
    mockDb.select.mockResolvedValue([{ value: "webm" }]);

    const result = await getSettingFromDb("video_format");
    expect(result).toBe("webm");
    expect(mockDb.select).toHaveBeenCalledWith(
      "SELECT value FROM settings WHERE key = $1",
      ["video_format"]
    );
  });

  it("returns default if DB has no row", async () => {
    mockDb.select.mockResolvedValue([]);

    const result = await getSettingFromDb("max_concurrent_downloads");
    expect(result).toBe(2);
  });

  it("deserializes number from DB", async () => {
    mockDb.select.mockResolvedValue([{ value: "3" }]);

    const result = await getSettingFromDb("max_concurrent_downloads");
    expect(result).toBe(3);
  });

  it("deserializes boolean from DB", async () => {
    mockDb.select.mockResolvedValue([{ value: "false" }]);

    const result = await getSettingFromDb("check_for_updates");
    expect(result).toBe(false);
  });
});
