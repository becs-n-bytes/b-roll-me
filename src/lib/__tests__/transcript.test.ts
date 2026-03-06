import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchTranscript, searchTranscript } from "../transcript";
import type { TranscriptSegment } from "../../types";

describe("searchTranscript", () => {
  const makeSegment = (text: string, start: number, duration = 5): TranscriptSegment => ({
    text,
    start,
    duration,
  });

  it("returns empty array for empty segments", () => {
    expect(searchTranscript([], "hello world")).toEqual([]);
  });

  it("matches all segments when query is empty (0 words means 0 threshold)", () => {
    const segments = [makeSegment("hello world", 0)];
    const results = searchTranscript(segments, "");
    expect(results.length).toBe(1);
    expect(results[0].text).toBe("hello world");
  });

  it("matches all when all query words are 2 chars or fewer (threshold becomes 0)", () => {
    const segments = [makeSegment("an ox is by us", 0)];
    const results = searchTranscript(segments, "an ox is");
    expect(results.length).toBe(1);
  });

  it("matches all when single short word query (threshold becomes 0)", () => {
    const segments = [makeSegment("the cat sat on the mat", 0)];
    const results = searchTranscript(segments, "at");
    expect(results.length).toBe(1);
  });

  it("matches when at least 50% of words are found", () => {
    const segments = [
      makeSegment("the quick brown fox", 0, 3),
      makeSegment("jumps over the lazy", 3, 3),
      makeSegment("dog in the park", 6, 3),
    ];
    const results = searchTranscript(segments, "quick brown missing unknown");
    expect(results.length).toBe(1);
    expect(results[0].text).toContain("quick brown fox");
  });

  it("does not match when below 50% threshold", () => {
    const segments = [
      makeSegment("the quick brown fox", 0, 3),
      makeSegment("jumps over the lazy", 3, 3),
      makeSegment("dog in the park", 6, 3),
    ];
    const results = searchTranscript(segments, "quick xyz abc def ghi");
    expect(results.length).toBe(0);
  });

  it("uses sliding window of 3 segments", () => {
    const segments = [
      makeSegment("alpha beta", 0, 2),
      makeSegment("gamma delta", 2, 2),
      makeSegment("epsilon zeta", 4, 2),
      makeSegment("eta theta", 6, 2),
    ];
    const results = searchTranscript(segments, "epsilon zeta");
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.some((m) => m.text.includes("epsilon zeta"))).toBe(true);
  });

  it("deduplicates matches within 5 seconds of each other", () => {
    const segments = [
      makeSegment("important topic here", 0, 2),
      makeSegment("important topic now", 1, 2),
      makeSegment("important topic again", 2, 2),
      makeSegment("important topic still", 3, 2),
    ];
    const results = searchTranscript(segments, "important topic");
    expect(results.length).toBe(1);
  });

  it("allows matches more than 5 seconds apart", () => {
    const segments = [
      makeSegment("important topic here", 0, 2),
      makeSegment("unrelated stuff", 2, 2),
      makeSegment("other content", 4, 2),
      makeSegment("important topic again", 10, 2),
      makeSegment("more about topic", 12, 2),
      makeSegment("important details", 14, 2),
    ];
    const results = searchTranscript(segments, "important topic");
    expect(results.length).toBe(2);
  });

  it("returns maximum 5 results", () => {
    const segments: TranscriptSegment[] = [];
    for (let i = 0; i < 30; i++) {
      segments.push(makeSegment("target keyword here", i * 10, 2));
    }
    const results = searchTranscript(segments, "target keyword");
    expect(results.length).toBe(5);
  });

  it("calculates correct startTime and endTime", () => {
    const segments = [
      makeSegment("start text here", 10, 5),
      makeSegment("middle text", 15, 3),
      makeSegment("end text now", 18, 4),
    ];
    const results = searchTranscript(segments, "start text here");
    expect(results.length).toBe(1);
    expect(results[0].startTime).toBe(10);
    expect(results[0].endTime).toBe(22);
  });

  it("joins window segment text with spaces", () => {
    const segments = [
      makeSegment("hello", 0, 2),
      makeSegment("world", 2, 2),
      makeSegment("today", 4, 2),
    ];
    const results = searchTranscript(segments, "hello world today");
    expect(results.length).toBe(1);
    expect(results[0].text).toBe("hello world today");
  });

  it("performs case-insensitive matching", () => {
    const segments = [makeSegment("Hello WORLD Today", 0, 5)];
    const results = searchTranscript(segments, "HELLO world TODAY");
    expect(results.length).toBe(1);
  });

  it("handles window at end of segments with fewer than 3", () => {
    const segments = [
      makeSegment("first segment", 0, 2),
      makeSegment("keyword match here", 2, 3),
    ];
    const results = searchTranscript(segments, "keyword match");
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].endTime).toBe(5);
  });
});

const CAPTION_BASE_URL = "https://www.youtube.com/api/timedtext?v=test&lang=en&pot=TOKEN123&fmt=json3";

function makePlayerResponse(baseUrl = CAPTION_BASE_URL, lang = "en") {
  return {
    ok: true,
    json: () => Promise.resolve({
      captions: {
        playerCaptionsTracklistRenderer: {
          captionTracks: [{ baseUrl, languageCode: lang }],
        },
      },
    }),
  };
}

function makeCaptionResponse(events: { segs?: { utf8: string }[]; tStartMs?: number; dDurationMs?: number }[]) {
  return {
    ok: true,
    json: () => Promise.resolve({ events }),
  };
}

describe("fetchTranscript", () => {
  let mockFetch: ReturnType<typeof vi.fn>;
  let mockDb: { select: ReturnType<typeof vi.fn>; execute: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    const setup = await import("../../test/setup");
    mockDb = setup.mockDb;
    const http = await import("@tauri-apps/plugin-http");
    mockFetch = http.fetch as ReturnType<typeof vi.fn>;
    vi.clearAllMocks();
    mockDb.select.mockResolvedValue([]);
    mockDb.execute.mockResolvedValue({ rowsAffected: 0 });
  });

  it("returns cached transcript from DB if exists", async () => {
    const cached = [{ text: "hello", start: 0, duration: 5 }];
    mockDb.select.mockResolvedValue([{ transcript_json: JSON.stringify(cached) }]);

    const result = await fetchTranscript("abc123");
    expect(result).toEqual(cached);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("fetches via InnerTube player then caption URL", async () => {
    mockFetch
      .mockResolvedValueOnce(makePlayerResponse())
      .mockResolvedValueOnce(makeCaptionResponse([
        { segs: [{ utf8: "hello world" }], tStartMs: 1000, dDurationMs: 5000 },
      ]));

    const result = await fetchTranscript("video1");
    expect(result).toEqual([{ text: "hello world", start: 1, duration: 5 }]);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch).toHaveBeenNthCalledWith(1,
      "https://www.youtube.com/youtubei/v1/player",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("sends User-Agent header to both requests", async () => {
    mockFetch
      .mockResolvedValueOnce(makePlayerResponse())
      .mockResolvedValueOnce(makeCaptionResponse([
        { segs: [{ utf8: "text" }], tStartMs: 0, dDurationMs: 1000 },
      ]));

    await fetchTranscript("vid-ua");
    const playerHeaders = mockFetch.mock.calls[0][1].headers;
    const captionHeaders = mockFetch.mock.calls[1][1].headers;
    expect(playerHeaders["User-Agent"]).toContain("android.youtube");
    expect(captionHeaders["User-Agent"]).toContain("android.youtube");
  });

  it("sends videoId in InnerTube request body", async () => {
    mockFetch
      .mockResolvedValueOnce(makePlayerResponse())
      .mockResolvedValueOnce(makeCaptionResponse([
        { segs: [{ utf8: "text" }], tStartMs: 0, dDurationMs: 1000 },
      ]));

    await fetchTranscript("myVideoId123");
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.videoId).toBe("myVideoId123");
    expect(body.context.client.clientName).toBe("ANDROID");
    expect(body.context.client.clientVersion).toBe("19.09.37");
    expect(body.context.client.androidSdkVersion).toBe(33);
    expect(body.videoId).toBe("myVideoId123");
    expect(body.contentCheckOk).toBe(true);
    expect(body.racyCheckOk).toBe(true);
  });

  it("parses TimedText JSON response with multiple segments", async () => {
    mockFetch
      .mockResolvedValueOnce(makePlayerResponse())
      .mockResolvedValueOnce(makeCaptionResponse([
        { segs: [{ utf8: "first " }, { utf8: "part" }], tStartMs: 0, dDurationMs: 3000 },
        { segs: [{ utf8: "second" }], tStartMs: 3000, dDurationMs: 2000 },
      ]));

    const result = await fetchTranscript("vid2");
    expect(result).toEqual([
      { text: "first part", start: 0, duration: 3 },
      { text: "second", start: 3, duration: 2 },
    ]);
  });

  it("caches fetched transcripts in DB", async () => {
    mockFetch
      .mockResolvedValueOnce(makePlayerResponse())
      .mockResolvedValueOnce(makeCaptionResponse([
        { segs: [{ utf8: "cached text" }], tStartMs: 0, dDurationMs: 1000 },
      ]));

    await fetchTranscript("vid3");
    expect(mockDb.execute).toHaveBeenCalledWith(
      expect.stringContaining("INSERT OR REPLACE INTO transcript_cache"),
      ["vid3", expect.any(String), "en"],
    );
  });

  it("returns null when InnerTube player request fails", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false });
    const result = await fetchTranscript("fail");
    expect(result).toBeNull();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("returns null when no caption tracks in player response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ captions: {} }),
    });
    const result = await fetchTranscript("nocaps");
    expect(result).toBeNull();
  });

  it("returns null when caption fetch fails", async () => {
    mockFetch
      .mockResolvedValueOnce(makePlayerResponse())
      .mockResolvedValueOnce({ ok: false });
    const result = await fetchTranscript("capfail");
    expect(result).toBeNull();
  });

  it("returns null on empty events", async () => {
    mockFetch
      .mockResolvedValueOnce(makePlayerResponse())
      .mockResolvedValueOnce(makeCaptionResponse([]));
    const result = await fetchTranscript("empty");
    expect(result).toBeNull();
  });

  it("returns null when events is undefined", async () => {
    mockFetch
      .mockResolvedValueOnce(makePlayerResponse())
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) });
    const result = await fetchTranscript("noevents");
    expect(result).toBeNull();
  });

  it("filters out segments with empty text", async () => {
    mockFetch
      .mockResolvedValueOnce(makePlayerResponse())
      .mockResolvedValueOnce(makeCaptionResponse([
        { segs: [{ utf8: "" }], tStartMs: 0, dDurationMs: 1000 },
        { segs: [{ utf8: "  " }], tStartMs: 1000, dDurationMs: 1000 },
        { segs: [{ utf8: "valid" }], tStartMs: 2000, dDurationMs: 1000 },
      ]));

    const result = await fetchTranscript("mixed");
    expect(result).toEqual([{ text: "valid", start: 2, duration: 1 }]);
  });

  it("filters out events without segs", async () => {
    mockFetch
      .mockResolvedValueOnce(makePlayerResponse())
      .mockResolvedValueOnce(makeCaptionResponse([
        { tStartMs: 0, dDurationMs: 1000 },
        { segs: [{ utf8: "has segs" }], tStartMs: 1000, dDurationMs: 1000 },
      ]));

    const result = await fetchTranscript("nosegs");
    expect(result).toEqual([{ text: "has segs", start: 1, duration: 1 }]);
  });

  it("returns null when all segments have empty text after filtering", async () => {
    mockFetch
      .mockResolvedValueOnce(makePlayerResponse())
      .mockResolvedValueOnce(makeCaptionResponse([
        { segs: [{ utf8: "   " }], tStartMs: 0, dDurationMs: 1000 },
      ]));

    const result = await fetchTranscript("allempty");
    expect(result).toBeNull();
  });

  it("appends fmt=json3 to baseUrl when not present", async () => {
    const baseUrlWithoutFmt = "https://www.youtube.com/api/timedtext?v=test&lang=en&pot=TOKEN";
    mockFetch
      .mockResolvedValueOnce(makePlayerResponse(baseUrlWithoutFmt))
      .mockResolvedValueOnce(makeCaptionResponse([
        { segs: [{ utf8: "text" }], tStartMs: 0, dDurationMs: 1000 },
      ]));

    await fetchTranscript("fmttest");
    const captionUrlArg = mockFetch.mock.calls[1][0] as string;
    expect(captionUrlArg).toContain("fmt=json3");
  });

  it("does not double-append fmt when baseUrl already has it", async () => {
    const baseUrlWithFmt = "https://www.youtube.com/api/timedtext?v=test&fmt=json3&pot=TOKEN";
    mockFetch
      .mockResolvedValueOnce(makePlayerResponse(baseUrlWithFmt))
      .mockResolvedValueOnce(makeCaptionResponse([
        { segs: [{ utf8: "text" }], tStartMs: 0, dDurationMs: 1000 },
      ]));

    await fetchTranscript("fmtexists");
    const captionUrlArg = mockFetch.mock.calls[1][0] as string;
    const fmtCount = (captionUrlArg.match(/fmt=/g) ?? []).length;
    expect(fmtCount).toBe(1);
  });
});
