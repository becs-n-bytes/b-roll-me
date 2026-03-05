import { useEffect, useState } from "react";
import { fetch } from "@tauri-apps/plugin-http";
import { useSettingsStore } from "../stores/settingsStore";
import type { VideoFormat, Resolution, LlmModel } from "../types";

type TestStatus = "idle" | "testing" | "success" | "error";

function ApiKeySection({
  label,
  settingsKey,
  placeholder,
  helpText,
  testEndpoint,
}: {
  label: string;
  settingsKey: "anthropic_api_key" | "openai_api_key" | "youtube_api_key";
  placeholder: string;
  helpText: string;
  testEndpoint?: () => Promise<void>;
}) {
  const { settings, saveSetting, loaded } = useSettingsStore();
  const [localKey, setLocalKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testStatus, setTestStatus] = useState<TestStatus>("idle");
  const [testMessage, setTestMessage] = useState("");

  useEffect(() => {
    if (loaded) {
      setLocalKey(settings[settingsKey]);
    }
  }, [loaded, settings, settingsKey]);

  const maskedKey =
    localKey.length > 8
      ? "\u2022".repeat(localKey.length - 4) + localKey.slice(-4)
      : localKey;

  const handleSave = async () => {
    setSaving(true);
    await saveSetting(settingsKey, localKey.trim());
    setSaving(false);
  };

  const handleTest = async () => {
    if (!testEndpoint || !localKey.trim()) return;
    setTestStatus("testing");
    setTestMessage("");
    try {
      await testEndpoint();
      setTestStatus("success");
      setTestMessage("Connection successful");
    } catch (err) {
      setTestStatus("error");
      setTestMessage(err instanceof Error ? err.message : String(err));
    }
  };

  const isConfigured = localKey.trim().length > 0;

  return (
    <div className="mb-6 last:mb-0">
      <div className="flex items-center justify-between mb-2">
        <label className="text-sm font-medium text-neutral-400">{label}</label>
        <span
          className={`flex items-center gap-2 text-xs font-medium ${
            isConfigured ? "text-emerald-500" : "text-neutral-500"
          }`}
        >
          <span
            className={`w-2 h-2 rounded-full ${
              isConfigured ? "bg-emerald-500" : "bg-neutral-600"
            }`}
          />
          {isConfigured ? "Configured" : "Not configured"}
        </span>
      </div>
      <div className="flex gap-3">
        <input
          type={showKey ? "text" : "password"}
          value={showKey ? localKey : maskedKey}
          onChange={(e) => setLocalKey(e.target.value)}
          onFocus={() => setShowKey(true)}
          onBlur={() => setShowKey(false)}
          placeholder={placeholder}
          className="flex-1 px-4 py-2.5 rounded-lg bg-neutral-800 border border-neutral-700 text-neutral-200 placeholder-neutral-600 text-sm focus:outline-none focus:border-blue-500 transition-colors font-mono"
        />
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-5 py-2.5 rounded-lg text-sm font-medium bg-blue-600 hover:bg-blue-700 disabled:bg-neutral-700 disabled:text-neutral-500 text-white transition-colors"
        >
          {saving ? "Saving..." : "Save"}
        </button>
        {testEndpoint && (
          <button
            onClick={handleTest}
            disabled={testStatus === "testing" || !localKey.trim()}
            className="px-4 py-2.5 rounded-lg text-sm font-medium bg-neutral-700 hover:bg-neutral-600 disabled:bg-neutral-800 disabled:text-neutral-600 text-neutral-200 transition-colors"
          >
            {testStatus === "testing" ? "Testing..." : "Test"}
          </button>
        )}
      </div>
      <p className="text-xs text-neutral-600 mt-2">{helpText}</p>
      {testStatus === "success" && (
        <p className="text-xs text-emerald-500 mt-1">{testMessage}</p>
      )}
      {testStatus === "error" && (
        <p className="text-xs text-red-400 mt-1">{testMessage}</p>
      )}
    </div>
  );
}

function SelectField<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex items-center justify-between py-3">
      <label className="text-sm text-neutral-300">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className="px-3 py-2 rounded-lg bg-neutral-800 border border-neutral-700 text-neutral-200 text-sm focus:outline-none focus:border-blue-500 transition-colors"
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function NumberField({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="flex items-center justify-between py-3">
      <label className="text-sm text-neutral-300">{label}</label>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        onChange={(e) => {
          const n = parseInt(e.target.value);
          if (!isNaN(n) && n >= min && n <= max) onChange(n);
        }}
        className="w-20 px-3 py-2 rounded-lg bg-neutral-800 border border-neutral-700 text-neutral-200 text-sm text-center focus:outline-none focus:border-blue-500 transition-colors"
      />
    </div>
  );
}

function ToggleField({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between py-3">
      <div>
        <label className="text-sm text-neutral-300">{label}</label>
        {description && (
          <p className="text-xs text-neutral-600 mt-0.5">{description}</p>
        )}
      </div>
      <button
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative w-11 h-6 rounded-full transition-colors ${
          checked ? "bg-blue-600" : "bg-neutral-700"
        }`}
      >
        <span
          className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${
            checked ? "translate-x-5" : "translate-x-0"
          }`}
        />
      </button>
    </div>
  );
}

function TextInputField({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex items-center justify-between py-3 gap-4">
      <label className="text-sm text-neutral-300 shrink-0">{label}</label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="flex-1 max-w-sm px-3 py-2 rounded-lg bg-neutral-800 border border-neutral-700 text-neutral-200 placeholder-neutral-600 text-sm focus:outline-none focus:border-blue-500 transition-colors font-mono"
      />
    </div>
  );
}

export default function Settings() {
  const { settings, saveSetting, loadSettings, loaded } = useSettingsStore();

  useEffect(() => {
    if (!loaded) {
      loadSettings();
    }
  }, [loaded, loadSettings]);

  const testAnthropicKey = async () => {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": settings.anthropic_api_key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-20250414",
        max_tokens: 1,
        messages: [{ role: "user", content: "Hi" }],
      }),
    });
    if (response.status === 401) throw new Error("Invalid API key");
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`API error (${response.status}): ${text}`);
    }
  };

  const testOpenAiKey = async () => {
    const response = await fetch("https://api.openai.com/v1/models", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${settings.openai_api_key}`,
      },
    });
    if (response.status === 401) throw new Error("Invalid API key");
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`API error (${response.status}): ${text}`);
    }
  };

  const testYouTubeKey = async () => {
    const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=test&maxResults=1&key=${settings.youtube_api_key}`;
    const response = await fetch(url);
    if (response.status === 400 || response.status === 403) {
      throw new Error("Invalid or restricted API key");
    }
    if (!response.ok) {
      throw new Error(`API error (${response.status})`);
    }
  };

  return (
    <div className="p-6 max-w-2xl">
      <h1 className="text-2xl font-semibold text-neutral-100 mb-1">Settings</h1>
      <p className="text-sm text-neutral-500 mb-8">
        Application preferences and configuration.
      </p>

      <section className="bg-neutral-900 border border-neutral-800 rounded-xl p-6 mb-6">
        <h2 className="text-lg font-semibold text-neutral-200 mb-4">
          API Keys
        </h2>

        <ApiKeySection
          label="Anthropic API Key"
          settingsKey="anthropic_api_key"
          placeholder="sk-ant-..."
          helpText="Used for script analysis and clip evaluation. Your key is stored locally and sent directly to Anthropic."
          testEndpoint={testAnthropicKey}
        />

        <ApiKeySection
          label="OpenAI API Key"
          settingsKey="openai_api_key"
          placeholder="sk-..."
          helpText="Optional. Required only if using GPT-4o for analysis."
          testEndpoint={testOpenAiKey}
        />

        <ApiKeySection
          label="YouTube Data API Key"
          settingsKey="youtube_api_key"
          placeholder="AIza..."
          helpText="Used for searching YouTube clips. Get a key from the Google Cloud Console."
          testEndpoint={testYouTubeKey}
        />
      </section>

      <section className="bg-neutral-900 border border-neutral-800 rounded-xl p-6 mb-6">
        <h2 className="text-lg font-semibold text-neutral-200 mb-4">
          Download Preferences
        </h2>
        <div className="divide-y divide-neutral-800">
          <TextInputField
            label="Default output directory"
            value={settings.default_output_dir}
            placeholder="~/Downloads/ai-broll"
            onChange={(v) => saveSetting("default_output_dir", v)}
          />
          <SelectField<VideoFormat>
            label="Video format"
            value={settings.video_format}
            options={[
              { value: "mp4", label: "MP4" },
              { value: "webm", label: "WebM" },
            ]}
            onChange={(v) => saveSetting("video_format", v)}
          />
          <SelectField<Resolution>
            label="Resolution"
            value={settings.resolution}
            options={[
              { value: "best", label: "Best available" },
              { value: "1080", label: "1080p" },
              { value: "720", label: "720p" },
            ]}
            onChange={(v) => saveSetting("resolution", v)}
          />
          <NumberField
            label="Max concurrent downloads"
            value={settings.max_concurrent_downloads}
            min={1}
            max={5}
            onChange={(v) => saveSetting("max_concurrent_downloads", v)}
          />
        </div>
      </section>

      <section className="bg-neutral-900 border border-neutral-800 rounded-xl p-6 mb-6">
        <h2 className="text-lg font-semibold text-neutral-200 mb-4">
          Analysis Preferences
        </h2>
        <div className="divide-y divide-neutral-800">
          <SelectField<LlmModel>
            label="LLM model"
            value={settings.llm_model}
            options={[
              { value: "claude-sonnet-4-20250514", label: "Claude Sonnet 4" },
              { value: "claude-haiku-4-20250414", label: "Claude Haiku 4 (cheaper)" },
              { value: "gpt-4o", label: "GPT-4o (requires OpenAI key)" },
            ]}
            onChange={(v) => saveSetting("llm_model", v)}
          />
          <NumberField
            label="Max moments per analysis"
            value={settings.max_moments_per_analysis}
            min={1}
            max={30}
            onChange={(v) => saveSetting("max_moments_per_analysis", v)}
          />
        </div>
      </section>

      <section className="bg-neutral-900 border border-neutral-800 rounded-xl p-6 mb-6">
        <h2 className="text-lg font-semibold text-neutral-200 mb-4">
          Application
        </h2>
        <div className="divide-y divide-neutral-800">
          <SelectField<"dark" | "light">
            label="Theme"
            value={settings.theme}
            options={[
              { value: "dark", label: "Dark" },
              { value: "light", label: "Light" },
            ]}
            onChange={(v) => saveSetting("theme", v)}
          />
          <ToggleField
            label="Check for updates"
            description="Automatically check for new versions on startup"
            checked={settings.check_for_updates}
            onChange={(v) => saveSetting("check_for_updates", v)}
          />
        </div>
      </section>

      <section className="bg-neutral-900 border border-neutral-800 rounded-xl p-6">
        <h2 className="text-lg font-semibold text-neutral-200 mb-4">About</h2>
        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-neutral-400">Version</span>
            <span className="text-neutral-200 font-mono">0.1.0</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-neutral-400">App ID</span>
            <span className="text-neutral-200 font-mono">com.aibroll.desktop</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-neutral-400">Framework</span>
            <span className="text-neutral-200">Tauri v2 + React</span>
          </div>
        </div>
      </section>
    </div>
  );
}
