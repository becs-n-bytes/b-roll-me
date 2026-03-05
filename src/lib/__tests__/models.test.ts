import { describe, it, expect, vi, beforeEach } from "vitest";
import { parseModelValue, toModelValue, fetchAllModels } from "../models";

describe("parseModelValue", () => {
  it("splits provider:modelId format", () => {
    expect(parseModelValue("anthropic:claude-sonnet-4-20250514")).toEqual({
      provider: "anthropic",
      modelId: "claude-sonnet-4-20250514",
    });
  });

  it("handles openai provider", () => {
    expect(parseModelValue("openai:gpt-4o")).toEqual({
      provider: "openai",
      modelId: "gpt-4o",
    });
  });

  it("handles openrouter provider", () => {
    expect(parseModelValue("openrouter:anthropic/claude-3.5-sonnet")).toEqual({
      provider: "openrouter",
      modelId: "anthropic/claude-3.5-sonnet",
    });
  });

  it("handles gemini provider", () => {
    expect(parseModelValue("gemini:gemini-2.5-flash")).toEqual({
      provider: "gemini",
      modelId: "gemini-2.5-flash",
    });
  });

  it("defaults to anthropic when no colon present", () => {
    expect(parseModelValue("claude-sonnet-4-20250514")).toEqual({
      provider: "anthropic",
      modelId: "claude-sonnet-4-20250514",
    });
  });

  it("splits only on first colon", () => {
    expect(parseModelValue("openrouter:meta/llama:70b")).toEqual({
      provider: "openrouter",
      modelId: "meta/llama:70b",
    });
  });
});

describe("toModelValue", () => {
  it("combines provider and modelId", () => {
    expect(toModelValue("anthropic", "claude-sonnet-4-20250514")).toBe(
      "anthropic:claude-sonnet-4-20250514",
    );
  });

  it("combines openai provider", () => {
    expect(toModelValue("openai", "gpt-4o")).toBe("openai:gpt-4o");
  });

  it("combines openrouter provider with slash in id", () => {
    expect(toModelValue("openrouter", "anthropic/claude-3.5-sonnet")).toBe(
      "openrouter:anthropic/claude-3.5-sonnet",
    );
  });

  it("roundtrips with parseModelValue", () => {
    const value = toModelValue("gemini", "gemini-2.5-pro");
    const parsed = parseModelValue(value);
    expect(parsed).toEqual({ provider: "gemini", modelId: "gemini-2.5-pro" });
  });
});

describe("fetchAllModels", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    const http = await import("@tauri-apps/plugin-http");
    mockFetch = http.fetch as ReturnType<typeof vi.fn>;
    vi.clearAllMocks();
  });

  it("fetches Anthropic models with correct headers", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          data: [
            { id: "claude-sonnet-4-20250514", display_name: "Claude Sonnet 4" },
            { id: "claude-haiku-4-20250414", display_name: "Claude Haiku 4" },
          ],
        }),
    });

    const models = await fetchAllModels({ anthropic: "sk-ant-test" });

    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.anthropic.com/v1/models?limit=100",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          "x-api-key": "sk-ant-test",
          "anthropic-version": "2023-06-01",
        }),
      }),
    );
    expect(models).toContainEqual({
      provider: "anthropic",
      id: "claude-sonnet-4-20250514",
      displayName: "Claude Sonnet 4",
    });
  });

  it("filters Anthropic models to claude- prefix only", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          data: [
            { id: "claude-sonnet-4-20250514", display_name: "Claude Sonnet 4" },
            { id: "some-other-model", display_name: "Other" },
          ],
        }),
    });

    const models = await fetchAllModels({ anthropic: "sk-ant-test" });
    const anthropicModels = models.filter((m) => m.provider === "anthropic");

    expect(anthropicModels).toHaveLength(1);
    expect(anthropicModels[0].id).toBe("claude-sonnet-4-20250514");
  });

  it("fetches OpenAI models with Bearer token", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          data: [
            { id: "gpt-4o", owned_by: "openai" },
            { id: "gpt-4o-mini", owned_by: "openai" },
          ],
        }),
    });

    const models = await fetchAllModels({ openai: "sk-openai-test" });

    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.openai.com/v1/models",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer sk-openai-test",
        }),
      }),
    );
    expect(models).toContainEqual({
      provider: "openai",
      id: "gpt-4o",
      displayName: "gpt-4o",
    });
  });

  it("filters out OpenAI instruct/realtime/audio/transcription models", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          data: [
            { id: "gpt-4o" },
            { id: "gpt-3.5-turbo-instruct" },
            { id: "gpt-4o-realtime-preview" },
            { id: "gpt-4o-audio-preview" },
            { id: "gpt-4o-transcription" },
          ],
        }),
    });

    const models = await fetchAllModels({ openai: "sk-test" });
    const openaiModels = models.filter((m) => m.provider === "openai");

    expect(openaiModels).toHaveLength(1);
    expect(openaiModels[0].id).toBe("gpt-4o");
  });

  it("fetches OpenRouter models without auth", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          data: [
            { id: "anthropic/claude-3.5-sonnet", name: "Claude 3.5 Sonnet" },
            { id: "openai/gpt-4o", name: "GPT-4o" },
          ],
        }),
    });

    const models = await fetchAllModels({});

    expect(mockFetch).toHaveBeenCalledWith("https://openrouter.ai/api/v1/models");
    const orModels = models.filter((m) => m.provider === "openrouter");
    expect(orModels.length).toBeGreaterThanOrEqual(1);
  });

  it("fetches Gemini models with API key in URL", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          models: [
            {
              name: "models/gemini-2.5-flash",
              displayName: "Gemini 2.5 Flash",
              supportedGenerationMethods: ["generateContent"],
            },
            {
              name: "models/embedding-001",
              displayName: "Embedding 001",
              supportedGenerationMethods: ["embedContent"],
            },
          ],
        }),
    });

    const models = await fetchAllModels({ gemini: "AIza-test" });

    expect(mockFetch).toHaveBeenCalledWith(
      "https://generativelanguage.googleapis.com/v1beta/models?key=AIza-test",
    );
    const geminiModels = models.filter((m) => m.provider === "gemini");
    expect(geminiModels).toHaveLength(1);
    expect(geminiModels[0]).toEqual({
      provider: "gemini",
      id: "gemini-2.5-flash",
      displayName: "Gemini 2.5 Flash",
    });
  });

  it("strips models/ prefix from Gemini model ids", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          models: [
            {
              name: "models/gemini-2.5-pro",
              displayName: "Gemini 2.5 Pro",
              supportedGenerationMethods: ["generateContent"],
            },
          ],
        }),
    });

    const models = await fetchAllModels({ gemini: "AIza-test" });
    const geminiModels = models.filter((m) => m.provider === "gemini");
    expect(geminiModels[0].id).toBe("gemini-2.5-pro");
  });

  it("returns empty array for failed API calls", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 401 });

    const models = await fetchAllModels({
      anthropic: "bad-key",
      openai: "bad-key",
      gemini: "bad-key",
    });

    const anthropicModels = models.filter((m) => m.provider === "anthropic");
    const openaiModels = models.filter((m) => m.provider === "openai");
    const geminiModels = models.filter((m) => m.provider === "gemini");
    expect(anthropicModels).toHaveLength(0);
    expect(openaiModels).toHaveLength(0);
    expect(geminiModels).toHaveLength(0);
  });

  it("handles rejected promises gracefully via allSettled", async () => {
    mockFetch.mockRejectedValue(new Error("Network error"));

    const models = await fetchAllModels({
      anthropic: "key",
      openai: "key",
      gemini: "key",
    });

    expect(models).toEqual([]);
  });

  it("skips providers without API keys (except OpenRouter)", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          data: [{ id: "openai/gpt-4o", name: "GPT-4o" }],
        }),
    });

    await fetchAllModels({});

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith("https://openrouter.ai/api/v1/models");
  });

  it("combines results from multiple providers", async () => {
    let callCount = 0;
    mockFetch.mockImplementation((url: string) => {
      callCount++;
      if (url.includes("anthropic")) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              data: [{ id: "claude-sonnet-4-20250514", display_name: "Claude Sonnet 4" }],
            }),
        });
      }
      if (url.includes("openai.com")) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              data: [{ id: "gpt-4o" }],
            }),
        });
      }
      if (url.includes("openrouter")) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              data: [{ id: "meta/llama-3", name: "Llama 3" }],
            }),
        });
      }
      if (url.includes("generativelanguage")) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              models: [
                {
                  name: "models/gemini-2.5-flash",
                  displayName: "Gemini Flash",
                  supportedGenerationMethods: ["generateContent"],
                },
              ],
            }),
        });
      }
      return Promise.resolve({ ok: false });
    });

    const models = await fetchAllModels({
      anthropic: "key1",
      openai: "key2",
      openrouter: "key3",
      gemini: "key4",
    });

    const providers = new Set(models.map((m) => m.provider));
    expect(providers).toContain("anthropic");
    expect(providers).toContain("openai");
    expect(providers).toContain("openrouter");
    expect(providers).toContain("gemini");
    expect(callCount).toBe(4);
  });

  it("uses display_name for Anthropic, falls back to id", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          data: [
            { id: "claude-sonnet-4-20250514", display_name: "Claude Sonnet 4" },
            { id: "claude-haiku-4-20250414" },
          ],
        }),
    });

    const models = await fetchAllModels({ anthropic: "key" });
    const anthropicModels = models.filter((m) => m.provider === "anthropic");

    expect(anthropicModels[0].displayName).toBe("Claude Sonnet 4");
    expect(anthropicModels[1].displayName).toBe("claude-haiku-4-20250414");
  });
});
