import { describe, it, expect, vi, beforeEach } from "vitest";
import { evaluateClips, estimateEvaluationTokens } from "../evaluator";

describe("estimateEvaluationTokens", () => {
  it("returns token estimate based on result count", () => {
    expect(estimateEvaluationTokens(0)).toBe(400);
    expect(estimateEvaluationTokens(5)).toBe(1400);
    expect(estimateEvaluationTokens(10)).toBe(2400);
  });

  it("rounds up to nearest integer", () => {
    const result = estimateEvaluationTokens(3);
    expect(Number.isInteger(result)).toBe(true);
  });
});

describe("evaluateClips", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    const http = await import("@tauri-apps/plugin-http");
    mockFetch = http.fetch as ReturnType<typeof vi.fn>;
    vi.clearAllMocks();
  });

  const makeSuccessResponse = (evaluations: object[]) => ({
    ok: true,
    status: 200,
    json: () =>
      Promise.resolve({
        content: [{ type: "text", text: JSON.stringify({ evaluations }) }],
      }),
  });

  const sampleResults = [
    {
      videoId: "vid-1",
      videoTitle: "Test Video",
      channelName: "Test Channel",
      duration: 120,
      transcriptMatches: [],
    },
    {
      videoId: "vid-2",
      videoTitle: "Another Video",
      channelName: "Another Channel",
      duration: 300,
      transcriptMatches: [{ text: "relevant segment", startTime: 30, endTime: 45 }],
    },
  ];

  const sampleEvaluations = [
    {
      videoId: "vid-1",
      relevanceScore: 75,
      relevanceReason: "Good match",
      suggestedStartTime: 0,
      suggestedEndTime: 15,
      clipDescription: "Shows relevant content",
      usable: true,
    },
    {
      videoId: "vid-2",
      relevanceScore: 90,
      relevanceReason: "Excellent match",
      suggestedStartTime: 30,
      suggestedEndTime: 45,
      clipDescription: "Perfect B-Roll footage",
      usable: true,
    },
  ];

  it("sends correct request to Anthropic API", async () => {
    mockFetch.mockResolvedValue(makeSuccessResponse(sampleEvaluations));

    await evaluateClips(
      "the quick brown fox",
      "needs visual",
      ["fox running footage"],
      sampleResults,
      "sk-ant-key",
    );

    expect(mockFetch).toHaveBeenCalledWith("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": "sk-ant-key",
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: expect.stringContaining("the quick brown fox"),
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.model).toBe("claude-sonnet-4-20250514");
    expect(body.max_tokens).toBe(4096);
    expect(body.messages[0].role).toBe("user");
    expect(body.messages[0].content).toContain("fox running footage");
    expect(body.system).toBeTruthy();
  });

  it("includes transcript matches in request body", async () => {
    mockFetch.mockResolvedValue(makeSuccessResponse(sampleEvaluations));

    await evaluateClips("excerpt", "note", ["desc"], sampleResults, "key");

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.messages[0].content).toContain("relevant segment");
    expect(body.messages[0].content).toContain("30.0s");
  });

  it("parses valid response with evaluations", async () => {
    mockFetch.mockResolvedValue(makeSuccessResponse(sampleEvaluations));

    const results = await evaluateClips("excerpt", "note", ["desc"], sampleResults, "key");

    expect(results).toHaveLength(2);
    expect(results[0].videoId).toBe("vid-1");
    expect(results[0].relevanceScore).toBe(75);
    expect(results[0].usable).toBe(true);
    expect(results[1].videoId).toBe("vid-2");
    expect(results[1].relevanceScore).toBe(90);
    expect(results[1].suggestedStartTime).toBe(30);
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
              text: `Here are the evaluations:\n${JSON.stringify({ evaluations: [sampleEvaluations[0]] })}\nDone!`,
            },
          ],
        }),
    });

    const results = await evaluateClips("excerpt", "note", ["desc"], [sampleResults[0]], "key");
    expect(results).toHaveLength(1);
    expect(results[0].videoId).toBe("vid-1");
  });

  it("returns empty array for empty results input", async () => {
    const results = await evaluateClips("excerpt", "note", ["desc"], [], "key");
    expect(results).toEqual([]);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("handles 401 invalid key error", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 401 });
    await expect(
      evaluateClips("s", "n", ["d"], sampleResults, "bad-key"),
    ).rejects.toThrow("Invalid API key");
  });

  it("handles 429 rate limit error", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 429 });
    await expect(
      evaluateClips("s", "n", ["d"], sampleResults, "k"),
    ).rejects.toThrow("Rate limited");
  });

  it("handles 5xx server error", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 502 });
    await expect(
      evaluateClips("s", "n", ["d"], sampleResults, "k"),
    ).rejects.toThrow("server error");
  });

  it("handles other non-ok responses with body text", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 418,
      text: () => Promise.resolve("I'm a teapot"),
    });
    await expect(
      evaluateClips("s", "n", ["d"], sampleResults, "k"),
    ).rejects.toThrow("API error (418): I'm a teapot");
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

    await expect(
      evaluateClips("s", "n", ["d"], sampleResults, "k"),
    ).rejects.toThrow("API error: Bad request");
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

    await expect(
      evaluateClips("s", "n", ["d"], sampleResults, "k"),
    ).rejects.toThrow("No text content");
  });

  it("handles invalid JSON in response", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          content: [{ type: "text", text: "not json" }],
        }),
    });

    await expect(
      evaluateClips("s", "n", ["d"], sampleResults, "k"),
    ).rejects.toThrow("No JSON object found");
  });

  it("handles missing evaluations array", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          content: [{ type: "text", text: '{"results": []}' }],
        }),
    });

    await expect(
      evaluateClips("s", "n", ["d"], sampleResults, "k"),
    ).rejects.toThrow("missing evaluations array");
  });

  it("formats duration correctly in request", async () => {
    mockFetch.mockResolvedValue(makeSuccessResponse([]));
    const results = [{ ...sampleResults[0], duration: 185 }];

    await evaluateClips("excerpt", "note", ["desc"], results, "key").catch(() => {});

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.messages[0].content).toContain("3:05");
  });

  it("handles null duration in results", async () => {
    mockFetch.mockResolvedValue(makeSuccessResponse([]));
    const results = [{ ...sampleResults[0], duration: null }];

    await evaluateClips("excerpt", "note", ["desc"], results, "key").catch(() => {});

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.messages[0].content).toContain("unknown");
  });
});
