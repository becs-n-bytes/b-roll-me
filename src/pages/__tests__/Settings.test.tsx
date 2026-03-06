import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import Settings from "../Settings";
import { useSettingsStore, SETTING_DEFAULTS } from "../../stores/settingsStore";
import type { ModelOption } from "../../lib/models";

const mockFetchAllModels = vi.fn<() => Promise<ModelOption[]>>().mockResolvedValue([]);

vi.mock("../../lib/models", () => ({
  fetchAllModels: (...args: unknown[]) => mockFetchAllModels(...(args as [])),
  parseModelValue: (value: string) => {
    const i = value.indexOf(":");
    if (i === -1) return { provider: "anthropic", modelId: value };
    return { provider: value.slice(0, i), modelId: value.slice(i + 1) };
  },
  toModelValue: (provider: string, modelId: string) => `${provider}:${modelId}`,
}));

vi.mock("../../lib/database", () => ({
  getDb: vi.fn().mockResolvedValue({
    select: vi.fn().mockResolvedValue([]),
    execute: vi.fn().mockResolvedValue({ rowsAffected: 0 }),
  }),
}));

describe("Settings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetchAllModels.mockResolvedValue([]);
    useSettingsStore.setState({
      sidebarCollapsed: false,
      settings: { ...SETTING_DEFAULTS },
      loaded: true,
    });
  });

  it("renders Settings heading", () => {
    render(<Settings />);
    expect(screen.getByText("Settings")).toBeInTheDocument();
  });

  it("renders API Keys section", () => {
    render(<Settings />);
    expect(screen.getByText("API Keys")).toBeInTheDocument();
  });

  it("shows Anthropic API Key input", () => {
    render(<Settings />);
    expect(screen.getByText("Anthropic API Key")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("sk-ant-...")).toBeInTheDocument();
  });

  it("shows OpenAI API Key input", () => {
    render(<Settings />);
    expect(screen.getByText("OpenAI API Key")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("sk-...")).toBeInTheDocument();
  });

  it("shows OpenRouter API Key input", () => {
    render(<Settings />);
    expect(screen.getByText("OpenRouter API Key")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("sk-or-...")).toBeInTheDocument();
  });

  it("shows Gemini API Key input", () => {
    render(<Settings />);
    expect(screen.getByText("Google Gemini API Key")).toBeInTheDocument();
  });

  it("shows Test button for each API key", () => {
    render(<Settings />);
    const testButtons = screen.getAllByText("Test");
    expect(testButtons.length).toBe(4);
  });

  it("shows Save button for each API key", () => {
    render(<Settings />);
    const saveButtons = screen.getAllByText("Save");
    expect(saveButtons.length).toBe(4);
  });

  it("renders Download Preferences section", () => {
    render(<Settings />);
    expect(screen.getByText("Download Preferences")).toBeInTheDocument();
    expect(screen.getByText("Video format")).toBeInTheDocument();
    expect(screen.getByText("Resolution")).toBeInTheDocument();
    expect(screen.getByText("Max concurrent downloads")).toBeInTheDocument();
    expect(screen.getByText("Default output directory")).toBeInTheDocument();
  });

  it("renders Analysis Preferences section", () => {
    render(<Settings />);
    expect(screen.getByText("Analysis Preferences")).toBeInTheDocument();
    expect(screen.getByText("LLM model")).toBeInTheDocument();
    expect(screen.getByText("Max moments per analysis")).toBeInTheDocument();
  });

  it("renders Application section with theme and updates", () => {
    render(<Settings />);
    expect(screen.getByText("Application")).toBeInTheDocument();
    expect(screen.getByText("Theme")).toBeInTheDocument();
    expect(screen.getByText("Check for updates")).toBeInTheDocument();
  });

  it("renders About section with version", () => {
    render(<Settings />);
    expect(screen.getByText("About")).toBeInTheDocument();
    expect(screen.getByText("0.1.0")).toBeInTheDocument();
    expect(screen.getByText("com.aibroll.desktop")).toBeInTheDocument();
  });

  it("shows fallback model when no models fetched", async () => {
    render(<Settings />);
    await waitFor(() => {
      expect(screen.getByText("claude-sonnet-4-20250514")).toBeInTheDocument();
    });
  });

  it("shows selected model display name on dropdown trigger", async () => {
    mockFetchAllModels.mockResolvedValue([
      { provider: "anthropic", id: "claude-sonnet-4-20250514", displayName: "Claude Sonnet 4" },
      { provider: "openai", id: "gpt-4o", displayName: "gpt-4o" },
    ]);
    render(<Settings />);
    await waitFor(() => {
      expect(screen.getByText("Claude Sonnet 4")).toBeInTheDocument();
    });
  });

  it("shows models grouped by provider when dropdown opened", async () => {
    mockFetchAllModels.mockResolvedValue([
      { provider: "anthropic", id: "claude-sonnet-4-20250514", displayName: "Claude Sonnet 4" },
      { provider: "openai", id: "gpt-4o", displayName: "gpt-4o" },
    ]);
    render(<Settings />);
    await waitFor(() => {
      expect(screen.getByText("Claude Sonnet 4")).toBeInTheDocument();
    });
    screen.getByText("Claude Sonnet 4").click();
    await waitFor(() => {
      expect(screen.getByPlaceholderText("Search models...")).toBeInTheDocument();
      expect(screen.getAllByText("Anthropic").length).toBeGreaterThanOrEqual(2);
      expect(screen.getAllByText("OpenAI").length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText("gpt-4o").length).toBeGreaterThanOrEqual(1);
    });
  });

  it("shows Refresh Models button", async () => {
    render(<Settings />);
    await waitFor(() => {
      expect(screen.getByText("Refresh Models")).toBeInTheDocument();
    });
  });

  it("renders per-feature model override toggles", async () => {
    render(<Settings />);
    await waitFor(() => {
      expect(screen.getByText("Per-feature model overrides")).toBeInTheDocument();
      expect(screen.getByText("Script Analysis")).toBeInTheDocument();
      expect(screen.getByText("Clip Evaluation")).toBeInTheDocument();
    });
  });

  it("shows format options in select", () => {
    render(<Settings />);
    expect(screen.getByText("MP4")).toBeInTheDocument();
    expect(screen.getByText("WebM")).toBeInTheDocument();
  });

  it("shows resolution options in select", () => {
    render(<Settings />);
    expect(screen.getByText("Best available")).toBeInTheDocument();
    expect(screen.getByText("1080p")).toBeInTheDocument();
    expect(screen.getByText("720p")).toBeInTheDocument();
  });

  it("shows configured state for keys that have values", () => {
    useSettingsStore.setState({
      settings: { ...SETTING_DEFAULTS, anthropic_api_key: "sk-ant-test123456" },
      loaded: true,
    });
    render(<Settings />);
    const configuredIndicators = screen.getAllByText("Configured");
    expect(configuredIndicators.length).toBeGreaterThanOrEqual(1);
  });

  it("shows not configured state for empty keys", () => {
    render(<Settings />);
    const notConfigured = screen.getAllByText("Not configured");
    expect(notConfigured.length).toBe(4);
  });
});
