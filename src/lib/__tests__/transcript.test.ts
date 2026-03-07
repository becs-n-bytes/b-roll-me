import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchTranscript, searchTranscript, listTranscriptLanguages } from "../transcript";
import type { TranscriptSegment } from "../../types";

vi.mock("../innertube");

const { getInnertube } = await import("../innertube");
const mockGetInnertube = vi.mocked(getInnertube);

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

const CAPTION_BASE_URL = "https://www.youtube.com/api/timedtext?v=test&lang=en&fmt=json3";

function makeMockInnertube(captionTracks: { base_url: string; language_code: string; kind?: string }[] | null) {
  return {
    getBasicInfo: vi.fn().mockResolvedValue({
      captions: captionTracks ? { caption_tracks: captionTracks } : undefined,
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

  it("returns cached transcript from DB if exists (old array format)", async () => {
    const cached = [{ text: "hello", start: 0, duration: 5 }];
    mockDb.select.mockResolvedValue([{ transcript_json: JSON.stringify(cached), language: "en" }]);

    const result = await fetchTranscript("abc123");
    expect(result?.segments).toEqual(cached);
    expect(result?.languageCode).toBe("en");
    expect(result?.isGenerated).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("returns cached transcript from DB (new FetchedTranscript format)", async () => {
    const cached = { segments: [{ text: "hello", start: 0, duration: 5 }], language: "English", languageCode: "en", isGenerated: true };
    mockDb.select.mockResolvedValue([{ transcript_json: JSON.stringify(cached), language: "en" }]);

    const result = await fetchTranscript("abc123");
    expect(result).toEqual(cached);
    expect(result?.isGenerated).toBe(true);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("fetches via getBasicInfo then caption URL", async () => {
    const yt = makeMockInnertube([{ base_url: CAPTION_BASE_URL, language_code: "en" }]);
    mockGetInnertube.mockResolvedValue(yt as never);
    mockFetch.mockResolvedValueOnce(makeCaptionResponse([
      { segs: [{ utf8: "hello world" }], tStartMs: 1000, dDurationMs: 5000 },
    ]));

    const result = await fetchTranscript("video1");
    expect(result?.segments).toEqual([{ text: "hello world", start: 1, duration: 5 }]);
    expect(result?.languageCode).toBe("en");
    expect(result?.isGenerated).toBe(false);
    expect(yt.getBasicInfo).toHaveBeenCalledWith("video1", { client: "ANDROID" });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("parses multiple segments from caption response", async () => {
    const yt = makeMockInnertube([{ base_url: CAPTION_BASE_URL, language_code: "en" }]);
    mockGetInnertube.mockResolvedValue(yt as never);
    mockFetch.mockResolvedValueOnce(makeCaptionResponse([
      { segs: [{ utf8: "first " }, { utf8: "part" }], tStartMs: 0, dDurationMs: 3000 },
      { segs: [{ utf8: "second" }], tStartMs: 3000, dDurationMs: 2000 },
    ]));

    const result = await fetchTranscript("vid2");
    expect(result?.segments).toEqual([
      { text: "first part", start: 0, duration: 3 },
      { text: "second", start: 3, duration: 2 },
    ]);
  });

  it("caches fetched transcripts in DB", async () => {
    const yt = makeMockInnertube([{ base_url: CAPTION_BASE_URL, language_code: "en" }]);
    mockGetInnertube.mockResolvedValue(yt as never);
    mockFetch.mockResolvedValueOnce(makeCaptionResponse([
      { segs: [{ utf8: "cached text" }], tStartMs: 0, dDurationMs: 1000 },
    ]));

    await fetchTranscript("vid3");
    expect(mockDb.execute).toHaveBeenCalledWith(
      expect.stringContaining("INSERT OR REPLACE INTO transcript_cache"),
      ["vid3", expect.any(String), "en"],
    );
  });

  it("prefers manual English captions over ASR", async () => {
    const yt = makeMockInnertube([
      { base_url: "https://example.com/asr", language_code: "en", kind: "asr" },
      { base_url: "https://example.com/manual", language_code: "en" },
    ]);
    mockGetInnertube.mockResolvedValue(yt as never);
    mockFetch.mockResolvedValueOnce(makeCaptionResponse([
      { segs: [{ utf8: "manual" }], tStartMs: 0, dDurationMs: 1000 },
    ]));

    await fetchTranscript("pref");
    const captionUrl = mockFetch.mock.calls[0][0] as string;
    expect(captionUrl).toContain("example.com/manual");
  });

  it("falls back to ASR English if no manual English", async () => {
    const yt = makeMockInnertube([
      { base_url: "https://example.com/asr", language_code: "en", kind: "asr" },
    ]);
    mockGetInnertube.mockResolvedValue(yt as never);
    mockFetch.mockResolvedValueOnce(makeCaptionResponse([
      { segs: [{ utf8: "asr text" }], tStartMs: 0, dDurationMs: 1000 },
    ]));

    await fetchTranscript("asrfallback");
    const captionUrl = mockFetch.mock.calls[0][0] as string;
    expect(captionUrl).toContain("example.com/asr");
  });

  it("falls back to first track if no English", async () => {
    const yt = makeMockInnertube([
      { base_url: "https://example.com/es", language_code: "es" },
    ]);
    mockGetInnertube.mockResolvedValue(yt as never);
    mockFetch.mockResolvedValueOnce(makeCaptionResponse([
      { segs: [{ utf8: "hola" }], tStartMs: 0, dDurationMs: 1000 },
    ]));

    await fetchTranscript("spanish");
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("returns null when no caption tracks", async () => {
    const yt = makeMockInnertube(null);
    mockGetInnertube.mockResolvedValue(yt as never);

    const result = await fetchTranscript("nocaps");
    expect(result).toBeNull();
  });

  it("returns null when caption tracks is empty array", async () => {
    const yt = makeMockInnertube([]);
    mockGetInnertube.mockResolvedValue(yt as never);

    const result = await fetchTranscript("emptytracks");
    expect(result).toBeNull();
  });

  it("returns null when caption fetch fails", async () => {
    const yt = makeMockInnertube([{ base_url: CAPTION_BASE_URL, language_code: "en" }]);
    mockGetInnertube.mockResolvedValue(yt as never);
    mockFetch.mockResolvedValueOnce({ ok: false });

    const result = await fetchTranscript("capfail");
    expect(result).toBeNull();
  });

  it("returns null on empty events", async () => {
    const yt = makeMockInnertube([{ base_url: CAPTION_BASE_URL, language_code: "en" }]);
    mockGetInnertube.mockResolvedValue(yt as never);
    mockFetch.mockResolvedValueOnce(makeCaptionResponse([]));

    const result = await fetchTranscript("empty");
    expect(result).toBeNull();
  });

  it("returns null when events is undefined", async () => {
    const yt = makeMockInnertube([{ base_url: CAPTION_BASE_URL, language_code: "en" }]);
    mockGetInnertube.mockResolvedValue(yt as never);
    mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) });

    const result = await fetchTranscript("noevents");
    expect(result).toBeNull();
  });

  it("filters out segments with empty text", async () => {
    const yt = makeMockInnertube([{ base_url: CAPTION_BASE_URL, language_code: "en" }]);
    mockGetInnertube.mockResolvedValue(yt as never);
    mockFetch.mockResolvedValueOnce(makeCaptionResponse([
      { segs: [{ utf8: "" }], tStartMs: 0, dDurationMs: 1000 },
      { segs: [{ utf8: "  " }], tStartMs: 1000, dDurationMs: 1000 },
      { segs: [{ utf8: "valid" }], tStartMs: 2000, dDurationMs: 1000 },
    ]));

    const result = await fetchTranscript("mixed");
    expect(result?.segments).toEqual([{ text: "valid", start: 2, duration: 1 }]);
  });

  it("filters out events without segs", async () => {
    const yt = makeMockInnertube([{ base_url: CAPTION_BASE_URL, language_code: "en" }]);
    mockGetInnertube.mockResolvedValue(yt as never);
    mockFetch.mockResolvedValueOnce(makeCaptionResponse([
      { tStartMs: 0, dDurationMs: 1000 },
      { segs: [{ utf8: "has segs" }], tStartMs: 1000, dDurationMs: 1000 },
    ]));

    const result = await fetchTranscript("nosegs");
    expect(result?.segments).toEqual([{ text: "has segs", start: 1, duration: 1 }]);
  });

  it("returns null when all segments have empty text after filtering", async () => {
    const yt = makeMockInnertube([{ base_url: CAPTION_BASE_URL, language_code: "en" }]);
    mockGetInnertube.mockResolvedValue(yt as never);
    mockFetch.mockResolvedValueOnce(makeCaptionResponse([
      { segs: [{ utf8: "   " }], tStartMs: 0, dDurationMs: 1000 },
    ]));

    const result = await fetchTranscript("allempty");
    expect(result).toBeNull();
  });

  it("sets fmt=json3 on caption URL", async () => {
    const baseUrlWithoutFmt = "https://www.youtube.com/api/timedtext?v=test&lang=en&pot=TOKEN";
    const yt = makeMockInnertube([{ base_url: baseUrlWithoutFmt, language_code: "en" }]);
    mockGetInnertube.mockResolvedValue(yt as never);
    mockFetch.mockResolvedValueOnce(makeCaptionResponse([
      { segs: [{ utf8: "text" }], tStartMs: 0, dDurationMs: 1000 },
    ]));

    await fetchTranscript("fmttest");
    const captionUrlArg = mockFetch.mock.calls[0][0] as string;
    expect(captionUrlArg).toContain("fmt=json3");
  });

  it("replaces existing fmt parameter with json3", async () => {
    const baseUrlWithSrv3 = "https://www.youtube.com/api/timedtext?v=test&fmt=srv3&pot=TOKEN";
    const yt = makeMockInnertube([{ base_url: baseUrlWithSrv3, language_code: "en" }]);
    mockGetInnertube.mockResolvedValue(yt as never);
    mockFetch.mockResolvedValueOnce(makeCaptionResponse([
      { segs: [{ utf8: "text" }], tStartMs: 0, dDurationMs: 1000 },
    ]));

    await fetchTranscript("fmtreplace");
    const captionUrlArg = mockFetch.mock.calls[0][0] as string;
    expect(captionUrlArg).toContain("fmt=json3");
    expect(captionUrlArg).not.toContain("fmt=srv3");
    const fmtCount = (captionUrlArg.match(/fmt=/g) ?? []).length;
    expect(fmtCount).toBe(1);
  });

  it("returns isGenerated true for ASR tracks", async () => {
    const yt = makeMockInnertube([{ base_url: CAPTION_BASE_URL, language_code: "en", kind: "asr" }]);
    mockGetInnertube.mockResolvedValue(yt as never);
    mockFetch.mockResolvedValueOnce(makeCaptionResponse([
      { segs: [{ utf8: "auto text" }], tStartMs: 0, dDurationMs: 1000 },
    ]));

    const result = await fetchTranscript("asrvid");
    expect(result?.isGenerated).toBe(true);
  });

  it("selects specific language when requested", async () => {
    const yt = makeMockInnertube([
      { base_url: "https://example.com/en", language_code: "en" },
      { base_url: "https://example.com/es", language_code: "es" },
    ]);
    mockGetInnertube.mockResolvedValue(yt as never);
    mockFetch.mockResolvedValueOnce(makeCaptionResponse([
      { segs: [{ utf8: "hola" }], tStartMs: 0, dDurationMs: 1000 },
    ]));

    const result = await fetchTranscript("langvid", { language: "es" });
    const captionUrl = mockFetch.mock.calls[0][0] as string;
    expect(captionUrl).toContain("example.com/es");
    expect(result?.languageCode).toBe("es");
  });

  it("appends tlang param for translation", async () => {
    const yt = makeMockInnertube([{ base_url: CAPTION_BASE_URL, language_code: "en" }]);
    mockGetInnertube.mockResolvedValue(yt as never);
    mockFetch.mockResolvedValueOnce(makeCaptionResponse([
      { segs: [{ utf8: "translated" }], tStartMs: 0, dDurationMs: 1000 },
    ]));

    const result = await fetchTranscript("tlangvid", { translateTo: "de" });
    const captionUrl = mockFetch.mock.calls[0][0] as string;
    expect(captionUrl).toContain("tlang=de");
    expect(result?.languageCode).toBe("de");
  });

  it("does not cache translation results", async () => {
    const yt = makeMockInnertube([{ base_url: CAPTION_BASE_URL, language_code: "en" }]);
    mockGetInnertube.mockResolvedValue(yt as never);
    mockFetch.mockResolvedValueOnce(makeCaptionResponse([
      { segs: [{ utf8: "text" }], tStartMs: 0, dDurationMs: 1000 },
    ]));

    await fetchTranscript("nocachevid", { translateTo: "fr" });
    expect(mockDb.execute).not.toHaveBeenCalledWith(
      expect.stringContaining("INSERT OR REPLACE"),
      expect.anything(),
    );
  });

  it("bypasses cache when language is specified", async () => {
    mockDb.select.mockResolvedValue([{ transcript_json: JSON.stringify([]), language: "en" }]);
    const yt = makeMockInnertube([{ base_url: CAPTION_BASE_URL, language_code: "es" }]);
    mockGetInnertube.mockResolvedValue(yt as never);
    mockFetch.mockResolvedValueOnce(makeCaptionResponse([
      { segs: [{ utf8: "hola" }], tStartMs: 0, dDurationMs: 1000 },
    ]));

    const result = await fetchTranscript("bypassvid", { language: "es" });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(result?.segments[0].text).toBe("hola");
  });

  it("falls back to any manual track before ASR when no English", async () => {
    const yt = makeMockInnertube([
      { base_url: "https://example.com/asr-fr", language_code: "fr", kind: "asr" },
      { base_url: "https://example.com/manual-de", language_code: "de" },
    ]);
    mockGetInnertube.mockResolvedValue(yt as never);
    mockFetch.mockResolvedValueOnce(makeCaptionResponse([
      { segs: [{ utf8: "manuell" }], tStartMs: 0, dDurationMs: 1000 },
    ]));

    await fetchTranscript("fallbackvid");
    const captionUrl = mockFetch.mock.calls[0][0] as string;
    expect(captionUrl).toContain("example.com/manual-de");
  });
});

describe("listTranscriptLanguages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns available languages with metadata", async () => {
    const yt = makeMockInnertube([
      { base_url: "https://example.com/en", language_code: "en", kind: undefined },
      { base_url: "https://example.com/es", language_code: "es", kind: "asr" },
    ]);
    mockGetInnertube.mockResolvedValue(yt as never);

    const langs = await listTranscriptLanguages("testvid");
    expect(langs).toHaveLength(2);
    expect(langs[0]).toEqual({ code: "en", name: "en", isGenerated: false, isTranslatable: false });
    expect(langs[1]).toEqual({ code: "es", name: "es", isGenerated: true, isTranslatable: false });
  });

  it("returns empty array when no tracks", async () => {
    const yt = makeMockInnertube(null);
    mockGetInnertube.mockResolvedValue(yt as never);

    const langs = await listTranscriptLanguages("novid");
    expect(langs).toEqual([]);
  });

  it("includes isTranslatable flag from track", async () => {
    const yt = {
      getBasicInfo: vi.fn().mockResolvedValue({
        captions: {
          caption_tracks: [
            { base_url: "https://example.com/en", language_code: "en", is_translatable: true },
          ],
        },
      }),
    };
    mockGetInnertube.mockResolvedValue(yt as never);

    const langs = await listTranscriptLanguages("transvid");
    expect(langs[0].isTranslatable).toBe(true);
  });
});
