import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SearchResult, EvaluatedClip } from "../../types";
import type { ClipEvaluation } from "../../lib/evaluator";

vi.mock("../../lib/evaluator");

const { mockDb } = await import("../../test/setup");
const { evaluateClips } = await import("../../lib/evaluator");

const mockEvaluateClips = vi.mocked(evaluateClips);

const { useEvaluationStore } = await import("../evaluationStore");

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

const makeEvaluatedClip = (overrides: Partial<EvaluatedClip> = {}): EvaluatedClip => ({
  id: "ec-1",
  search_result_id: "sr-1",
  moment_id: "m-1",
  relevance_score: 85,
  relevance_reason: "Good match",
  suggested_start_time: 10,
  suggested_end_time: 25,
  clip_description: "Relevant footage",
  usable: 1,
  created_at: "2025-01-01T00:00:00.000Z",
  ...overrides,
});

describe("evaluationStore", () => {
  beforeEach(() => {
    useEvaluationStore.setState({
      evaluations: new Map(),
      evaluatingMoments: new Set(),
      sortByEvaluation: false,
      error: null,
    });
    mockDb.select.mockReset().mockResolvedValue([]);
    mockDb.execute.mockReset().mockResolvedValue({ rowsAffected: 0 });
    mockEvaluateClips.mockReset();
    vi.spyOn(crypto, "randomUUID").mockReturnValue("test-uuid" as ReturnType<typeof crypto.randomUUID>);
  });

  describe("loadEvaluations", () => {
    it("loads evaluations from DB for each moment id", async () => {
      const evals1 = [makeEvaluatedClip({ id: "ec-1", moment_id: "m-1" })];
      const evals2 = [makeEvaluatedClip({ id: "ec-2", moment_id: "m-2" })];
      mockDb.select.mockResolvedValueOnce(evals1).mockResolvedValueOnce(evals2);

      await useEvaluationStore.getState().loadEvaluations(["m-1", "m-2"]);

      expect(mockDb.select).toHaveBeenCalledTimes(2);
      expect(mockDb.select).toHaveBeenCalledWith(
        "SELECT * FROM evaluated_clips WHERE moment_id = $1 ORDER BY relevance_score DESC",
        ["m-1"],
      );
      const state = useEvaluationStore.getState();
      expect(state.evaluations.get("m-1")).toEqual(evals1);
      expect(state.evaluations.get("m-2")).toEqual(evals2);
    });

    it("skips moments with no evaluations in DB", async () => {
      mockDb.select.mockResolvedValueOnce([]);

      await useEvaluationStore.getState().loadEvaluations(["m-1"]);

      expect(useEvaluationStore.getState().evaluations.has("m-1")).toBe(false);
    });

    it("returns early for empty momentIds array", async () => {
      await useEvaluationStore.getState().loadEvaluations([]);
      expect(mockDb.select).not.toHaveBeenCalled();
    });
  });

  describe("evaluateMoment", () => {
    const results = [
      makeSearchResult({ id: "sr-1", video_id: "vid-1" }),
      makeSearchResult({ id: "sr-2", video_id: "vid-2" }),
    ];

    const clipEvals: ClipEvaluation[] = [
      {
        videoId: "vid-1",
        relevanceScore: 85,
        relevanceReason: "Good match",
        suggestedStartTime: 10,
        suggestedEndTime: 25,
        clipDescription: "Relevant footage",
        usable: true,
      },
      {
        videoId: "vid-2",
        relevanceScore: 30,
        relevanceReason: "Tutorial, not footage",
        suggestedStartTime: 0,
        suggestedEndTime: 10,
        clipDescription: "Code tutorial",
        usable: false,
      },
    ];

    it("calls evaluateClips with correct parameters", async () => {
      mockEvaluateClips.mockResolvedValue(clipEvals);

      await useEvaluationStore.getState().evaluateMoment(
        "m-1", "script excerpt", "editorial note", ["fox footage"], results, "api-key",
      );

      expect(mockEvaluateClips).toHaveBeenCalledWith(
        "script excerpt",
        "editorial note",
        ["fox footage"],
        expect.arrayContaining([
          expect.objectContaining({ videoId: "vid-1", videoTitle: "Test Video" }),
        ]),
        "api-key",
        undefined,
      );
    });

    it("deletes existing evaluations before saving new ones", async () => {
      mockEvaluateClips.mockResolvedValue(clipEvals);

      await useEvaluationStore.getState().evaluateMoment(
        "m-1", "excerpt", "note", ["desc"], results, "key",
      );

      const deleteCalls = mockDb.execute.mock.calls.filter(
        (c) => typeof c[0] === "string" && c[0].includes("DELETE FROM evaluated_clips"),
      );
      expect(deleteCalls).toHaveLength(1);
      expect(deleteCalls[0][1]).toEqual(["m-1"]);
    });

    it("saves evaluations to DB with correct fields", async () => {
      mockEvaluateClips.mockResolvedValue([clipEvals[0]]);

      await useEvaluationStore.getState().evaluateMoment(
        "m-1", "excerpt", "note", ["desc"], [results[0]], "key",
      );

      const insertCalls = mockDb.execute.mock.calls.filter(
        (c) => typeof c[0] === "string" && c[0].includes("INSERT INTO evaluated_clips"),
      );
      expect(insertCalls).toHaveLength(1);
      const params = insertCalls[0][1] as unknown[];
      expect(params[0]).toBe("test-uuid");
      expect(params[1]).toBe("sr-1");
      expect(params[2]).toBe("m-1");
      expect(params[3]).toBe(85);
      expect(params[4]).toBe("Good match");
      expect(params[5]).toBe(10);
      expect(params[6]).toBe(25);
      expect(params[8]).toBe(1);
    });

    it("converts usable boolean to integer for DB", async () => {
      mockEvaluateClips.mockResolvedValue([clipEvals[1]]);

      await useEvaluationStore.getState().evaluateMoment(
        "m-1", "excerpt", "note", ["desc"], [results[1]], "key",
      );

      const insertCalls = mockDb.execute.mock.calls.filter(
        (c) => typeof c[0] === "string" && c[0].includes("INSERT INTO evaluated_clips"),
      );
      const params = insertCalls[0][1] as unknown[];
      expect(params[8]).toBe(0);
    });

    it("updates store state with saved evaluations", async () => {
      mockEvaluateClips.mockResolvedValue(clipEvals);

      await useEvaluationStore.getState().evaluateMoment(
        "m-1", "excerpt", "note", ["desc"], results, "key",
      );

      const state = useEvaluationStore.getState();
      expect(state.evaluations.get("m-1")).toHaveLength(2);
      expect(state.evaluations.get("m-1")?.[0].relevance_score).toBe(85);
      expect(state.evaluations.get("m-1")?.[1].usable).toBe(0);
    });

    it("sets evaluatingMoments during evaluation and clears after", async () => {
      let capturedEvaluating = false;
      mockEvaluateClips.mockImplementation(async () => {
        capturedEvaluating = useEvaluationStore.getState().evaluatingMoments.has("m-1");
        return [];
      });

      await useEvaluationStore.getState().evaluateMoment(
        "m-1", "excerpt", "note", ["desc"], results, "key",
      );

      expect(capturedEvaluating).toBe(true);
      expect(useEvaluationStore.getState().evaluatingMoments.has("m-1")).toBe(false);
    });

    it("skips evaluations for unmatched videoIds", async () => {
      mockEvaluateClips.mockResolvedValue([
        { ...clipEvals[0], videoId: "nonexistent" },
      ]);

      await useEvaluationStore.getState().evaluateMoment(
        "m-1", "excerpt", "note", ["desc"], results, "key",
      );

      const insertCalls = mockDb.execute.mock.calls.filter(
        (c) => typeof c[0] === "string" && c[0].includes("INSERT INTO evaluated_clips"),
      );
      expect(insertCalls).toHaveLength(0);
      expect(useEvaluationStore.getState().evaluations.get("m-1")).toEqual([]);
    });

    it("parses transcript_matches_json from search results", async () => {
      const resultWithMatches = makeSearchResult({
        id: "sr-3",
        video_id: "vid-3",
        transcript_matches_json: JSON.stringify([{ text: "match", startTime: 5, endTime: 10 }]),
      });
      mockEvaluateClips.mockResolvedValue([]);

      await useEvaluationStore.getState().evaluateMoment(
        "m-1", "excerpt", "note", ["desc"], [resultWithMatches], "key",
      );

      const callArgs = mockEvaluateClips.mock.calls[0];
      expect(callArgs[3][0].transcriptMatches).toEqual([{ text: "match", startTime: 5, endTime: 10 }]);
    });

    it("sets error and clears evaluating on failure", async () => {
      mockEvaluateClips.mockRejectedValueOnce(new Error("Rate limited"));

      await useEvaluationStore.getState().evaluateMoment(
        "m-1", "excerpt", "note", ["desc"], results, "key",
      );

      const state = useEvaluationStore.getState();
      expect(state.error).toBe("Rate limited");
      expect(state.evaluatingMoments.has("m-1")).toBe(false);
    });

    it("sets generic error for non-Error thrown values", async () => {
      mockEvaluateClips.mockRejectedValueOnce("string error");

      await useEvaluationStore.getState().evaluateMoment(
        "m-1", "excerpt", "note", ["desc"], results, "key",
      );

      expect(useEvaluationStore.getState().error).toBe("Evaluation failed");
    });
  });

  describe("toggleSort", () => {
    it("toggles sortByEvaluation state", () => {
      expect(useEvaluationStore.getState().sortByEvaluation).toBe(false);

      useEvaluationStore.getState().toggleSort();
      expect(useEvaluationStore.getState().sortByEvaluation).toBe(true);

      useEvaluationStore.getState().toggleSort();
      expect(useEvaluationStore.getState().sortByEvaluation).toBe(false);
    });
  });
});
