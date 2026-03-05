import { describe, it, expect, vi, beforeEach } from "vitest";
import { analyzeScript } from "../llm";

describe("analyzeScript", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    const http = await import("@tauri-apps/plugin-http");
    mockFetch = http.fetch as ReturnType<typeof vi.fn>;
    vi.clearAllMocks();
    vi.spyOn(crypto, "randomUUID").mockReturnValue("test-uuid-1234" as ReturnType<typeof crypto.randomUUID>);
  });

  const makeSuccessResponse = (moments: object[]) => ({
    ok: true,
    status: 200,
    json: () =>
      Promise.resolve({
        content: [{ type: "text", text: JSON.stringify({ moments }) }],
      }),
  });

  it("sends correct request to Anthropic API", async () => {
    mockFetch.mockResolvedValue(
      makeSuccessResponse([
        {
          scriptExcerpt: "test",
          timestampHint: "0:00",
          editorialNote: "note",
          suggestions: [],
        },
      ]),
    );

    await analyzeScript("my script", "sk-ant-key");

    expect(mockFetch).toHaveBeenCalledWith("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": "sk-ant-key",
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: expect.stringContaining("my script"),
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.model).toBe("claude-sonnet-4-20250514");
    expect(body.max_tokens).toBe(16384);
    expect(body.messages[0].role).toBe("user");
    expect(body.messages[0].content).toContain("my script");
    expect(body.system).toBeTruthy();
  });

  it("parses valid response with moments", async () => {
    const moment = {
      scriptExcerpt: "the quick brown fox",
      timestampHint: "0:30-0:45",
      editorialNote: "needs visual",
      suggestions: [
        {
          rank: 1,
          type: "visual",
          description: "fox running",
          searchQueries: ["fox running"],
          durationHint: "short",
        },
      ],
    };

    mockFetch.mockResolvedValue(makeSuccessResponse([moment]));
    const results = await analyzeScript("script", "key");

    expect(results).toHaveLength(1);
    expect(results[0].scriptExcerpt).toBe("the quick brown fox");
    expect(results[0].suggestions).toHaveLength(1);
    expect(results[0].suggestions[0].rank).toBe(1);
  });

  it("extracts JSON wrapped in text", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          content: [
            {
              type: "text",
              text: 'Here is the analysis:\n{"moments": [{"scriptExcerpt": "test", "timestampHint": "0:00", "editorialNote": "note", "suggestions": []}]}\nHope this helps!',
            },
          ],
        }),
    });

    const results = await analyzeScript("script", "key");
    expect(results).toHaveLength(1);
    expect(results[0].scriptExcerpt).toBe("test");
  });

  it("adds UUID id to each moment", async () => {
    mockFetch.mockResolvedValue(
      makeSuccessResponse([
        { scriptExcerpt: "a", timestampHint: "", editorialNote: "", suggestions: [] },
        { scriptExcerpt: "b", timestampHint: "", editorialNote: "", suggestions: [] },
      ]),
    );

    const results = await analyzeScript("script", "key");
    expect(results[0].id).toBe("test-uuid-1234");
    expect(results[1].id).toBe("test-uuid-1234");
  });

  it("handles 401 invalid key error", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 401 });
    await expect(analyzeScript("s", "bad-key")).rejects.toThrow("Invalid API key");
  });

  it("handles 429 rate limit error", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 429 });
    await expect(analyzeScript("s", "k")).rejects.toThrow("Rate limited");
  });

  it("handles 5xx server error", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 502 });
    await expect(analyzeScript("s", "k")).rejects.toThrow("server error");
  });

  it("handles 500 server error", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500 });
    await expect(analyzeScript("s", "k")).rejects.toThrow("server error");
  });

  it("handles other non-ok responses with body text", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 418,
      text: () => Promise.resolve("I'm a teapot"),
    });
    await expect(analyzeScript("s", "k")).rejects.toThrow("API error (418): I'm a teapot");
  });

  it("handles API error in response body", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          content: [],
          error: { type: "invalid_request", message: "Bad request" },
        }),
    });

    await expect(analyzeScript("s", "k")).rejects.toThrow("API error: Bad request");
  });

  it("handles missing text content", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          content: [{ type: "image", source: {} }],
        }),
    });

    await expect(analyzeScript("s", "k")).rejects.toThrow("No text content");
  });

  it("handles empty content array", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ content: [] }),
    });

    await expect(analyzeScript("s", "k")).rejects.toThrow("No text content");
  });

  it("handles invalid JSON in response", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          content: [{ type: "text", text: "this is not json at all" }],
        }),
    });

    await expect(analyzeScript("s", "k")).rejects.toThrow("No JSON object found");
  });

  it("handles missing moments array", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          content: [{ type: "text", text: '{"results": []}' }],
        }),
    });

    await expect(analyzeScript("s", "k")).rejects.toThrow("missing moments array");
  });

  it("handles moments as non-array", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          content: [{ type: "text", text: '{"moments": "not an array"}' }],
        }),
    });

    await expect(analyzeScript("s", "k")).rejects.toThrow("missing moments array");
  });

  it("includes max moments limit in system prompt", async () => {
    mockFetch.mockResolvedValue(
      makeSuccessResponse([
        { scriptExcerpt: "test", timestampHint: "0:00", editorialNote: "note", suggestions: [] },
      ]),
    );

    await analyzeScript("script", "key");
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.system).toContain("at most 10 moments");
  });

  it("shows user-friendly error on truncated JSON response", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          content: [{ type: "text", text: '{"moments": [{"scriptExcerpt": "test", "timestampHint": "0:00"}' }],
        }),
    });

    await expect(analyzeScript("s", "k")).rejects.toThrow("LLM response was cut short");
  });
});
