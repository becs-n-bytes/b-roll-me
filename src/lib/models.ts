import { fetch } from "@tauri-apps/plugin-http";

export type LlmProvider = "anthropic" | "openai" | "openrouter" | "gemini";

export interface ModelOption {
  provider: LlmProvider;
  id: string;
  displayName: string;
}

export function parseModelValue(value: string): { provider: LlmProvider; modelId: string } {
  const colonIndex = value.indexOf(":");
  if (colonIndex === -1) {
    return { provider: "anthropic", modelId: value };
  }
  return {
    provider: value.slice(0, colonIndex) as LlmProvider,
    modelId: value.slice(colonIndex + 1),
  };
}

export function toModelValue(provider: LlmProvider, modelId: string): string {
  return `${provider}:${modelId}`;
}

async function fetchAnthropicModels(apiKey: string): Promise<ModelOption[]> {
  const response = await fetch("https://api.anthropic.com/v1/models?limit=100", {
    method: "GET",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
  });
  if (!response.ok) return [];
  const data = (await response.json()) as {
    data: { id: string; display_name?: string }[];
  };
  return (data.data ?? [])
    .filter((m) => m.id.startsWith("claude-"))
    .map((m) => ({
      provider: "anthropic" as const,
      id: m.id,
      displayName: m.display_name ?? m.id,
    }));
}

async function fetchOpenAiModels(apiKey: string): Promise<ModelOption[]> {
  const response = await fetch("https://api.openai.com/v1/models", {
    method: "GET",
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!response.ok) return [];
  const data = (await response.json()) as {
    data: { id: string; owned_by?: string }[];
  };
  return (data.data ?? [])
    .filter((m) => m.id.startsWith("gpt-") || m.id.startsWith("o") || m.id.startsWith("chatgpt-"))
    .filter((m) => !m.id.includes("instruct") && !m.id.includes("realtime") && !m.id.includes("audio") && !m.id.includes("transcri"))
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((m) => ({
      provider: "openai" as const,
      id: m.id,
      displayName: m.id,
    }));
}

async function fetchOpenRouterModels(): Promise<ModelOption[]> {
  const response = await fetch("https://openrouter.ai/api/v1/models");
  if (!response.ok) return [];
  const data = (await response.json()) as {
    data: { id: string; name?: string }[];
  };
  return (data.data ?? [])
    .sort((a, b) => (a.name ?? a.id).localeCompare(b.name ?? b.id))
    .map((m) => ({
      provider: "openrouter" as const,
      id: m.id,
      displayName: m.name ?? m.id,
    }));
}

async function fetchGeminiModels(apiKey: string): Promise<ModelOption[]> {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`
  );
  if (!response.ok) return [];
  const data = (await response.json()) as {
    models: {
      name: string;
      displayName?: string;
      supportedGenerationMethods?: string[];
    }[];
  };
  return (data.models ?? [])
    .filter((m) => m.supportedGenerationMethods?.includes("generateContent"))
    .map((m) => {
      const id = m.name.replace("models/", "");
      return {
        provider: "gemini" as const,
        id,
        displayName: m.displayName ?? id,
      };
    });
}

export async function fetchAllModels(keys: {
  anthropic?: string;
  openai?: string;
  openrouter?: string;
  gemini?: string;
}): Promise<ModelOption[]> {
  const fetches: Promise<ModelOption[]>[] = [];

  if (keys.anthropic) fetches.push(fetchAnthropicModels(keys.anthropic));
  if (keys.openai) fetches.push(fetchOpenAiModels(keys.openai));
  if (keys.openrouter) fetches.push(fetchOpenRouterModels());
  else fetches.push(fetchOpenRouterModels());
  if (keys.gemini) fetches.push(fetchGeminiModels(keys.gemini));

  const results = await Promise.allSettled(fetches);
  return results.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
}
