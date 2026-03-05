import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import Settings from "../Settings";
import { useSettingsStore, SETTING_DEFAULTS } from "../../stores/settingsStore";

vi.mock("../../lib/database", () => ({
  getDb: vi.fn().mockResolvedValue({
    select: vi.fn().mockResolvedValue([]),
    execute: vi.fn().mockResolvedValue({ rowsAffected: 0 }),
  }),
}));

describe("Settings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

  it("shows YouTube API Key input", () => {
    render(<Settings />);
    expect(screen.getByText("YouTube Data API Key")).toBeInTheDocument();
  });

  it("shows Test button for each API key", () => {
    render(<Settings />);
    const testButtons = screen.getAllByText("Test");
    expect(testButtons.length).toBe(5);
  });

  it("shows Save button for each API key", () => {
    render(<Settings />);
    const saveButtons = screen.getAllByText("Save");
    expect(saveButtons.length).toBe(5);
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

  it("shows model options in select", () => {
    render(<Settings />);
    expect(screen.getByText("Claude Sonnet 4")).toBeInTheDocument();
    expect(screen.getByText("Claude Haiku 4 (cheaper)")).toBeInTheDocument();
    expect(screen.getByText("GPT-4o (requires OpenAI key)")).toBeInTheDocument();
    expect(screen.getByText("OpenRouter Auto (requires OpenRouter key)")).toBeInTheDocument();
    expect(screen.getByText("Gemini 2.5 Flash (requires Gemini key)")).toBeInTheDocument();
    expect(screen.getByText("Gemini 2.5 Pro")).toBeInTheDocument();
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
    expect(notConfigured.length).toBe(5);
  });
});
