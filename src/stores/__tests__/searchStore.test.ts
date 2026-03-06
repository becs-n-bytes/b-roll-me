import { describe, it, expect, vi, beforeEach } from "vitest";
import type { YouTubeResult } from "../../lib/youtube";
import type { SearchResult, TranscriptSegment } from "../../types";

vi.mock("../../lib/youtube");
vi.mock("../../lib/transcript");

const { mockDb } = await import("../../test/setup");
const { searchYouTube } = await import("../../lib/youtube");
const { fetchTranscript, searchTranscript } = await import("../../lib/transcript");

const mockSearchYouTube = vi.mocked(searchYouTube);
const mockFetchTranscript = vi.mocked(fetchTranscript);
const mockSearchTranscript = vi.mocked(searchTranscript);

const { useSearchStore } = await import("../searchStore");

const makeYTResult = (overrides: Partial<YouTubeResult> = {}): YouTubeResult => ({
  videoId: "vid-1",
  title: "Test Video",
  channelName: "Test Channel",
  thumbnailUrl: "https://img.youtube.com/thumb.jpg",
  duration: 120,
  publishDate: "2025-01-01",
  captionsAvailable: false,
  sourceQuery: "test query",
  ...overrides,
});

const makeSearchResult = (overrides: Partial<SearchResult> = {}): SearchResult => ({
  id: "sr-1",
  moment_id: "m-1",
  video_id: "vid-1",
  video_title: "Test Video",
  channel_name: "Test Channel",
  thumbnail_url: "https://img.youtube.com/thumb.jpg",
  duration: 120,
  publish_date: "2025-01-01",
  captions_available: 0,
  relevance_score: null,
  source_query: "test query",
  transcript_matches_json: null,
  created_at: "2025-01-01T00:00:00.000Z",
  ...overrides,
});

describe("searchStore", () => {
  beforeEach(() => {
    useSearchStore.setState({
      results: new Map(),
      searchingMoments: new Set(),
      error: null,
    });
    mockDb.select.mockReset().mockResolvedValue([]);
    mockDb.execute.mockReset().mockResolvedValue({ rowsAffected: 0 });
    mockSearchYouTube.mockReset();
    mockFetchTranscript.mockReset();
    mockSearchTranscript.mockReset();
  });

  describe("loadResults", () => {
    it("loads results from DB for each moment id", async () => {
      const results1 = [makeSearchResult({ id: "sr-1", moment_id: "m-1" })];
      const results2 = [makeSearchResult({ id: "sr-2", moment_id: "m-2" })];
      mockDb.select.mockResolvedValueOnce(results1).mockResolvedValueOnce(results2);

      await useSearchStore.getState().loadResults(["m-1", "m-2"]);

      expect(mockDb.select).toHaveBeenCalledTimes(2);
      expect(mockDb.select).toHaveBeenCalledWith(
        "SELECT * FROM search_results WHERE moment_id = $1 ORDER BY created_at DESC",
        ["m-1"]
      );
      const state = useSearchStore.getState();
      expect(state.results.get("m-1")).toEqual(results1);
      expect(state.results.get("m-2")).toEqual(results2);
    });

    it("skips moments with no results in DB", async () => {
      mockDb.select.mockResolvedValueOnce([]);

      await useSearchStore.getState().loadResults(["m-1"]);

      expect(useSearchStore.getState().results.has("m-1")).toBe(false);
    });

    it("returns early for empty momentIds array", async () => {
      await useSearchStore.getState().loadResults([]);
      expect(mockDb.select).not.toHaveBeenCalled();
    });
  });

  describe("searchForMoment", () => {
    it("calls searchYouTube for each query and deduplicates by videoId", async () => {
      const dup = makeYTResult({ videoId: "dup" });
      mockSearchYouTube
        .mockResolvedValueOnce([makeYTResult({ videoId: "a" }), dup])
        .mockResolvedValueOnce([dup, makeYTResult({ videoId: "b" })]);

      await useSearchStore.getState().searchForMoment("m-1", ["q1", "q2"], "key");

      expect(mockSearchYouTube).toHaveBeenCalledTimes(2);
      expect(mockDb.execute).toHaveBeenCalledTimes(3);
      const state = useSearchStore.getState();
      const momentResults = state.results.get("m-1");
      expect(momentResults).toHaveLength(3);
      const videoIds = momentResults?.map((r) => r.video_id);
      expect(new Set(videoIds).size).toBe(3);
    });

    it("caps results at 10 and stops querying", async () => {
      const batch = Array.from({ length: 6 }, (_, i) =>
        makeYTResult({ videoId: `v${i}` })
      );
      mockSearchYouTube
        .mockResolvedValueOnce(batch)
        .mockResolvedValueOnce(batch.map((r) => ({ ...r, videoId: `x${r.videoId}` })));

      await useSearchStore.getState().searchForMoment("m-1", ["q1", "q2", "q3"], "key");

      expect(mockSearchYouTube).toHaveBeenCalledTimes(2);
    });

    it("sets searchingMoments during search and clears after", async () => {
      let capturedSearching = false;
      mockSearchYouTube.mockImplementation(async () => {
        capturedSearching = useSearchStore.getState().searchingMoments.has("m-1");
        return [];
      });

      await useSearchStore.getState().searchForMoment("m-1", ["q1"], "key");

      expect(capturedSearching).toBe(true);
      expect(useSearchStore.getState().searchingMoments.has("m-1")).toBe(false);
    });

    it("fetches transcript matches for results with captions", async () => {
      mockSearchYouTube.mockResolvedValueOnce([
        makeYTResult({ videoId: "cap-vid", captionsAvailable: true }),
      ]);
      const segments: TranscriptSegment[] = [
        { text: "hello world", start: 10, duration: 5 },
      ];
      mockFetchTranscript.mockResolvedValueOnce(segments);
      mockSearchTranscript.mockReturnValueOnce([
        { text: "hello world", startTime: 10, endTime: 15 },
      ]);

      await useSearchStore.getState().searchForMoment("m-1", ["hello"], "key");

      expect(mockFetchTranscript).toHaveBeenCalledWith("cap-vid");
      expect(mockSearchTranscript).toHaveBeenCalledWith(segments, "hello");
      const updateCall = mockDb.execute.mock.calls.find(
        (c) => typeof c[0] === "string" && c[0].includes("UPDATE search_results")
      );
      expect(updateCall).toBeDefined();
    });

    it("attempts transcript fetch for results without captions flag", async () => {
      mockSearchYouTube.mockResolvedValueOnce([
        makeYTResult({ videoId: "no-cap-vid", captionsAvailable: false }),
      ]);
      mockFetchTranscript.mockResolvedValueOnce(null);

      await useSearchStore.getState().searchForMoment("m-1", ["q"], "key");

      expect(mockFetchTranscript).toHaveBeenCalledWith("no-cap-vid");
    });

    it("sets error and clears searching on failure", async () => {
      mockSearchYouTube.mockRejectedValueOnce(new Error("API quota exceeded"));

      await useSearchStore.getState().searchForMoment("m-1", ["q"], "key");

      const state = useSearchStore.getState();
      expect(state.error).toBe("API quota exceeded");
      expect(state.searchingMoments.has("m-1")).toBe(false);
    });

    it("sets generic error for non-Error thrown values", async () => {
      mockSearchYouTube.mockRejectedValueOnce("string error");

      await useSearchStore.getState().searchForMoment("m-1", ["q"], "key");

      expect(useSearchStore.getState().error).toBe("Search failed");
    });
  });

  describe("searchCustom", () => {
    it("searches a single query and saves results", async () => {
      mockSearchYouTube.mockResolvedValueOnce([makeYTResult()]);

      await useSearchStore.getState().searchCustom("m-1", "custom query", "key");

      expect(mockSearchYouTube).toHaveBeenCalledWith("custom query", "key");
      expect(useSearchStore.getState().results.get("m-1")).toHaveLength(1);
    });

    it("appends to existing results for the moment", async () => {
      const existing = [makeSearchResult({ id: "existing-1" })];
      useSearchStore.setState({
        results: new Map([["m-1", existing]]),
        searchingMoments: new Set(),
        error: null,
      });
      mockSearchYouTube.mockResolvedValueOnce([makeYTResult({ videoId: "new-vid" })]);

      await useSearchStore.getState().searchCustom("m-1", "more", "key");

      const results = useSearchStore.getState().results.get("m-1");
      expect(results).toHaveLength(2);
      expect(results?.[1].id).toBe("existing-1");
    });

    it("sets error on failure", async () => {
      mockSearchYouTube.mockRejectedValueOnce(new Error("Network error"));

      await useSearchStore.getState().searchCustom("m-1", "q", "key");

      expect(useSearchStore.getState().error).toBe("Network error");
      expect(useSearchStore.getState().searchingMoments.has("m-1")).toBe(false);
    });
  });

  describe("fetchTranscriptMatches", () => {
    it("fetches transcript and updates matching result across all moments", async () => {
      const sr = makeSearchResult({ id: "sr-1", moment_id: "m-1" });
      useSearchStore.setState({
        results: new Map([["m-1", [sr]]]),
        searchingMoments: new Set(),
        error: null,
      });
      const segments: TranscriptSegment[] = [
        { text: "hello world", start: 10, duration: 5 },
      ];
      mockFetchTranscript.mockResolvedValueOnce(segments);
      mockSearchTranscript.mockReturnValueOnce([
        { text: "hello world", startTime: 10, endTime: 15 },
      ]);

      await useSearchStore.getState().fetchTranscriptMatches("sr-1", "vid-1", ["hello"]);

      expect(mockDb.execute).toHaveBeenCalledWith(
        "UPDATE search_results SET transcript_matches_json = $1 WHERE id = $2",
        [expect.any(String), "sr-1"]
      );
      const updated = useSearchStore.getState().results.get("m-1")?.[0];
      expect(updated?.transcript_matches_json).toBeDefined();
    });

    it("does nothing when transcript fetch returns null", async () => {
      mockFetchTranscript.mockResolvedValueOnce(null);

      await useSearchStore.getState().fetchTranscriptMatches("sr-1", "vid-1", ["q"]);

      expect(mockDb.execute).not.toHaveBeenCalled();
    });

    it("does nothing when no transcript matches found", async () => {
      mockFetchTranscript.mockResolvedValueOnce([
        { text: "unrelated", start: 0, duration: 5 },
      ]);
      mockSearchTranscript.mockReturnValueOnce([]);

      await useSearchStore.getState().fetchTranscriptMatches("sr-1", "vid-1", ["q"]);

      expect(mockDb.execute).not.toHaveBeenCalled();
    });
  });
});
