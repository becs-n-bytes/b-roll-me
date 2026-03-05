import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { fetch } from "@tauri-apps/plugin-http";
import { useSettingsStore } from "../stores/settingsStore";
import type { VideoFormat, Resolution } from "../types";
import { fetchAllModels, toModelValue, parseModelValue, type ModelOption, type LlmProvider } from "../lib/models";

type TestStatus = "idle" | "testing" | "success" | "error";

function ApiKeySection({
  label,
  settingsKey,
  placeholder,
  helpText,
  testEndpoint,
}: {
  label: string;
  settingsKey: "anthropic_api_key" | "openai_api_key" | "openrouter_api_key" | "gemini_api_key" | "youtube_api_key";
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

const LLM_FEATURES: { key: "analysis_model_override" | "evaluation_model_override"; label: string; description: string }[] = [
  { key: "analysis_model_override", label: "Script Analysis", description: "Reads your script and identifies B-Roll moments. Benefits from stronger reasoning." },
  { key: "evaluation_model_override", label: "Clip Evaluation", description: "Scores search results for relevance. Structured scoring works well with faster models." },
];

const PROVIDER_LABELS: Record<LlmProvider, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  openrouter: "OpenRouter",
  gemini: "Google Gemini",
};

function ModelSelector({
  value,
  models,
  loading,
  configuredProviders,
  onRefresh,
  onChange,
}: {
  value: string;
  models: ModelOption[];
  loading: boolean;
  configuredProviders: Set<LlmProvider>;
  onRefresh: () => void;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [providerFilter, setProviderFilter] = useState<Set<LlmProvider>>(new Set());
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const initialFilterApplied = useRef(false);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (initialFilterApplied.current || models.length === 0) return;
    const keyed = new Set<LlmProvider>();
    for (const p of configuredProviders) {
      if (models.some((m) => m.provider === p)) keyed.add(p);
    }
    if (keyed.size > 0) setProviderFilter(keyed);
    initialFilterApplied.current = true;
  }, [models, configuredProviders]);

  const providerCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const m of models) {
      counts[m.provider] = (counts[m.provider] ?? 0) + 1;
    }
    return counts;
  }, [models]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return models.filter((m) => {
      if (providerFilter.size > 0 && !providerFilter.has(m.provider)) return false;
      if (!q) return true;
      return (
        m.displayName.toLowerCase().includes(q) ||
        m.id.toLowerCase().includes(q) ||
        PROVIDER_LABELS[m.provider].toLowerCase().includes(q)
      );
    });
  }, [models, search, providerFilter]);

  const grouped = useMemo(() => {
    const acc: Record<string, ModelOption[]> = {};
    for (const m of filtered) {
      (acc[m.provider] ??= []).push(m);
    }
    return acc;
  }, [filtered]);

  const toggleProvider = (p: LlmProvider) => {
    setProviderFilter((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });
  };

  const clearFilters = () => {
    setProviderFilter(new Set());
  };

  const selectedModel = models.find((m) => toModelValue(m.provider, m.id) === value);
  const displayLabel = selectedModel?.displayName ?? parseModelValue(value).modelId;

  return (
    <div className="py-3">
      <div className="flex items-center justify-between mb-2">
        <label className="text-sm text-neutral-300 shrink-0">LLM model</label>
        <button
          onClick={onRefresh}
          disabled={loading}
          className="px-3 py-1.5 rounded-lg text-xs font-medium bg-neutral-700 hover:bg-neutral-600 disabled:bg-neutral-800 disabled:text-neutral-600 text-neutral-300 transition-colors shrink-0"
        >
          {loading ? "Loading..." : "Refresh Models"}
        </button>
      </div>
      <div ref={containerRef} className="relative">
        <button
          type="button"
          onClick={() => {
            setOpen(!open);
            if (!open) setTimeout(() => inputRef.current?.focus(), 0);
          }}
          className="w-full flex items-center justify-between px-3 py-2.5 rounded-lg bg-neutral-800 border border-neutral-700 text-sm text-left transition-colors hover:border-neutral-600 focus:outline-none focus:border-blue-500"
        >
          <span className="text-neutral-200 truncate">{displayLabel}</span>
          <span className="text-neutral-500 ml-2 shrink-0">
            {selectedModel && (
              <span className="text-xs text-neutral-500 mr-2">{PROVIDER_LABELS[selectedModel.provider]}</span>
            )}
            <svg className="w-4 h-4 inline-block" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
            </svg>
          </span>
        </button>

        {open && (
          <div className="absolute z-50 mt-1 w-full rounded-lg bg-neutral-800 border border-neutral-700 shadow-xl shadow-black/40 overflow-hidden">
            <div className="p-2 border-b border-neutral-700">
              <input
                ref={inputRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search models..."
                className="w-full px-3 py-2 rounded-md bg-neutral-900 border border-neutral-700 text-neutral-200 placeholder-neutral-600 text-sm focus:outline-none focus:border-blue-500 transition-colors"
              />
            </div>

            <div className="flex flex-wrap items-center gap-1.5 px-2 py-2 border-b border-neutral-700">
              {(Object.keys(PROVIDER_LABELS) as LlmProvider[]).map((p) => {
                const count = providerCounts[p] ?? 0;
                const active = providerFilter.has(p);
                const dimmed = count === 0;
                return (
                  <button
                    key={p}
                    type="button"
                    disabled={dimmed}
                    onClick={() => toggleProvider(p)}
                    className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                      dimmed
                        ? "bg-neutral-900/50 text-neutral-700 border border-neutral-800 cursor-not-allowed"
                        : active
                          ? "bg-blue-600/20 text-blue-400 border border-blue-500/40"
                          : "bg-neutral-900 text-neutral-400 border border-neutral-700 hover:border-neutral-600"
                    }`}
                  >
                    {PROVIDER_LABELS[p]}
                    <span className={`ml-1.5 ${dimmed ? "text-neutral-700" : active ? "text-blue-500/70" : "text-neutral-600"}`}>
                      {count}
                    </span>
                  </button>
                );
              })}
              {providerFilter.size > 0 && (
                <button
                  type="button"
                  onClick={clearFilters}
                  className="px-2 py-1 rounded-md text-xs text-neutral-500 hover:text-neutral-300 transition-colors"
                >
                  Clear
                </button>
              )}
            </div>

            <div className="max-h-64 overflow-y-auto">
              {filtered.length === 0 && (
                <div className="px-3 py-4 text-sm text-neutral-500 text-center">
                  {models.length === 0 ? "No models loaded" : "No matches"}
                </div>
              )}
              {(Object.keys(PROVIDER_LABELS) as LlmProvider[]).map((provider) => {
                const group = grouped[provider];
                if (!group?.length) return null;
                return (
                  <div key={provider}>
                    <div className="px-3 py-1.5 text-xs font-semibold text-neutral-500 uppercase tracking-wider bg-neutral-800/50 sticky top-0">
                      {PROVIDER_LABELS[provider]}
                    </div>
                    {group.map((m) => {
                      const mv = toModelValue(m.provider, m.id);
                      const selected = mv === value;
                      return (
                        <button
                          key={mv}
                          type="button"
                          onClick={() => {
                            onChange(mv);
                            setOpen(false);
                            setSearch("");
                          }}
                          className={`w-full text-left px-3 py-2 text-sm transition-colors ${
                            selected
                              ? "bg-blue-600/15 text-blue-300"
                              : "text-neutral-300 hover:bg-neutral-700/50"
                          }`}
                        >
                          <span className="block truncate">{m.displayName}</span>
                          {m.displayName !== m.id && (
                            <span className="block text-xs text-neutral-500 truncate">{m.id}</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function FeatureModelOverride({
  feature,
  value,
  defaultModel,
  models,
  onChange,
}: {
  feature: { key: string; label: string; description: string };
  value: string;
  defaultModel: string;
  models: ModelOption[];
  onChange: (value: string) => void;
}) {
  const enabled = value !== "";
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [providerFilter, setProviderFilter] = useState<Set<LlmProvider>>(new Set());
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const providerCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const m of models) counts[m.provider] = (counts[m.provider] ?? 0) + 1;
    return counts;
  }, [models]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return models.filter((m) => {
      if (providerFilter.size > 0 && !providerFilter.has(m.provider)) return false;
      if (!q) return true;
      return (
        m.displayName.toLowerCase().includes(q) ||
        m.id.toLowerCase().includes(q) ||
        PROVIDER_LABELS[m.provider].toLowerCase().includes(q)
      );
    });
  }, [models, search, providerFilter]);

  const grouped = useMemo(() => {
    const acc: Record<string, ModelOption[]> = {};
    for (const m of filtered) (acc[m.provider] ??= []).push(m);
    return acc;
  }, [filtered]);

  const toggleProvider = (p: LlmProvider) => {
    setProviderFilter((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });
  };

  const activeValue = enabled ? value : defaultModel;
  const selectedModel = models.find((m) => toModelValue(m.provider, m.id) === activeValue);
  const displayLabel = selectedModel?.displayName ?? parseModelValue(activeValue).modelId;

  return (
    <div className="py-3">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-3">
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            onClick={() => onChange(enabled ? "" : defaultModel)}
            className={`relative w-9 h-5 rounded-full transition-colors shrink-0 ${
              enabled ? "bg-blue-600" : "bg-neutral-700"
            }`}
          >
            <span
              className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                enabled ? "translate-x-4" : "translate-x-0"
              }`}
            />
          </button>
          <div>
            <span className="text-sm text-neutral-300">{feature.label}</span>
            <p className="text-xs text-neutral-600">{feature.description}</p>
          </div>
        </div>
      </div>

      {enabled && (
        <div ref={containerRef} className="relative mt-2 ml-12">
          <button
            type="button"
            onClick={() => {
              setOpen(!open);
              if (!open) setTimeout(() => inputRef.current?.focus(), 0);
            }}
            className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-neutral-800 border border-neutral-700 text-sm text-left transition-colors hover:border-neutral-600 focus:outline-none focus:border-blue-500"
          >
            <span className="text-neutral-200 truncate text-xs">{displayLabel}</span>
            <span className="text-neutral-500 ml-2 shrink-0">
              {selectedModel && (
                <span className="text-xs text-neutral-500 mr-1">{PROVIDER_LABELS[selectedModel.provider]}</span>
              )}
              <svg className="w-3.5 h-3.5 inline-block" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
              </svg>
            </span>
          </button>

          {open && (
            <div className="absolute z-50 mt-1 w-full rounded-lg bg-neutral-800 border border-neutral-700 shadow-xl shadow-black/40 overflow-hidden">
              <div className="p-2 border-b border-neutral-700">
                <input
                  ref={inputRef}
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search models..."
                  className="w-full px-3 py-1.5 rounded-md bg-neutral-900 border border-neutral-700 text-neutral-200 placeholder-neutral-600 text-xs focus:outline-none focus:border-blue-500 transition-colors"
                />
              </div>

              <div className="flex flex-wrap items-center gap-1 px-2 py-1.5 border-b border-neutral-700">
                {(Object.keys(PROVIDER_LABELS) as LlmProvider[]).map((p) => {
                  const count = providerCounts[p] ?? 0;
                  const active = providerFilter.has(p);
                  const dimmed = count === 0;
                  return (
                    <button
                      key={p}
                      type="button"
                      disabled={dimmed}
                      onClick={() => toggleProvider(p)}
                      className={`px-2 py-0.5 rounded text-xs font-medium transition-colors ${
                        dimmed
                          ? "bg-neutral-900/50 text-neutral-700 border border-neutral-800 cursor-not-allowed"
                          : active
                            ? "bg-blue-600/20 text-blue-400 border border-blue-500/40"
                            : "bg-neutral-900 text-neutral-400 border border-neutral-700 hover:border-neutral-600"
                      }`}
                    >
                      {PROVIDER_LABELS[p]}
                      <span className={`ml-1 ${dimmed ? "text-neutral-700" : active ? "text-blue-500/70" : "text-neutral-600"}`}>
                        {count}
                      </span>
                    </button>
                  );
                })}
                {providerFilter.size > 0 && (
                  <button
                    type="button"
                    onClick={() => setProviderFilter(new Set())}
                    className="px-1.5 py-0.5 rounded text-xs text-neutral-500 hover:text-neutral-300 transition-colors"
                  >
                    Clear
                  </button>
                )}
              </div>

              <div className="max-h-52 overflow-y-auto">
                {filtered.length === 0 && (
                  <div className="px-3 py-3 text-xs text-neutral-500 text-center">
                    {models.length === 0 ? "No models loaded" : "No matches"}
                  </div>
                )}
                {(Object.keys(PROVIDER_LABELS) as LlmProvider[]).map((provider) => {
                  const group = grouped[provider];
                  if (!group?.length) return null;
                  return (
                    <div key={provider}>
                      <div className="px-3 py-1 text-xs font-semibold text-neutral-500 uppercase tracking-wider bg-neutral-800/50 sticky top-0">
                        {PROVIDER_LABELS[provider]}
                      </div>
                      {group.map((m) => {
                        const mv = toModelValue(m.provider, m.id);
                        const selected = mv === value;
                        return (
                          <button
                            key={mv}
                            type="button"
                            onClick={() => {
                              onChange(mv);
                              setOpen(false);
                              setSearch("");
                            }}
                            className={`w-full text-left px-3 py-1.5 text-xs transition-colors ${
                              selected
                                ? "bg-blue-600/15 text-blue-300"
                                : "text-neutral-300 hover:bg-neutral-700/50"
                            }`}
                          >
                            <span className="block truncate">{m.displayName}</span>
                            {m.displayName !== m.id && (
                              <span className="block text-xs text-neutral-500 truncate">{m.id}</span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function Settings() {
  const { settings, saveSetting, loadSettings, loaded } = useSettingsStore();
  const [models, setModels] = useState<ModelOption[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);

  useEffect(() => {
    if (!loaded) {
      loadSettings();
    }
  }, [loaded, loadSettings]);

  const refreshModels = useCallback(async () => {
    setModelsLoading(true);
    try {
      const result = await fetchAllModels({
        anthropic: settings.anthropic_api_key || undefined,
        openai: settings.openai_api_key || undefined,
        openrouter: settings.openrouter_api_key || undefined,
        gemini: settings.gemini_api_key || undefined,
      });
      setModels(result);
    } finally {
      setModelsLoading(false);
    }
  }, [settings.anthropic_api_key, settings.openai_api_key, settings.openrouter_api_key, settings.gemini_api_key]);

  useEffect(() => {
    if (loaded) {
      refreshModels();
    }
  }, [loaded, refreshModels]);

  const configuredProviders = useMemo(() => {
    const set = new Set<LlmProvider>();
    if (settings.anthropic_api_key) set.add("anthropic");
    if (settings.openai_api_key) set.add("openai");
    if (settings.openrouter_api_key) set.add("openrouter");
    if (settings.gemini_api_key) set.add("gemini");
    return set;
  }, [settings.anthropic_api_key, settings.openai_api_key, settings.openrouter_api_key, settings.gemini_api_key]);

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

  const testOpenRouterKey = async () => {
    const response = await fetch("https://openrouter.ai/api/v1/models", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${settings.openrouter_api_key}`,
      },
    });
    if (response.status === 401) throw new Error("Invalid API key");
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`API error (${response.status}): ${text}`);
    }
  };

  const testGeminiKey = async () => {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${settings.gemini_api_key}`
    );
    if (response.status === 400 || response.status === 403) {
      throw new Error("Invalid API key");
    }
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
          label="OpenRouter API Key"
          settingsKey="openrouter_api_key"
          placeholder="sk-or-..."
          helpText="Optional. Gives access to many models through a single key. Get one at openrouter.ai."
          testEndpoint={testOpenRouterKey}
        />

        <ApiKeySection
          label="Google Gemini API Key"
          settingsKey="gemini_api_key"
          placeholder="AIza..."
          helpText="Optional. Required for Gemini Flash or Pro models. Get one at aistudio.google.com."
          testEndpoint={testGeminiKey}
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
          <ModelSelector
            value={settings.llm_model}
            models={models}
            loading={modelsLoading}
            configuredProviders={configuredProviders}
            onRefresh={refreshModels}
            onChange={(v) => saveSetting("llm_model", v)}
          />
          <div className="py-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm text-neutral-300">Per-feature model overrides</span>
              <span className="text-xs text-neutral-600">Use different models for each AI feature</span>
            </div>
            <div className="mt-1 rounded-lg border border-neutral-800 bg-neutral-900/50">
              {LLM_FEATURES.map((feature) => (
                <div key={feature.key} className="border-b border-neutral-800 last:border-b-0 px-3">
                  <FeatureModelOverride
                    feature={feature}
                    value={settings[feature.key]}
                    defaultModel={settings.llm_model}
                    models={models}
                    onChange={(v) => saveSetting(feature.key, v)}
                  />
                </div>
              ))}
            </div>
          </div>
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
