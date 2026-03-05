import { create } from "zustand";
import type { EvaluatedClip, SearchResult, TranscriptMatch, LlmModel } from "../types";
import { getDb } from "../lib/database";
import { evaluateClips } from "../lib/evaluator";

interface EvaluationState {
  evaluations: Map<string, EvaluatedClip[]>;
  evaluatingMoments: Set<string>;
  sortByEvaluation: boolean;
  error: string | null;
  loadEvaluations: (momentIds: string[]) => Promise<void>;
  evaluateMoment: (
    momentId: string,
    scriptExcerpt: string,
    editorialNote: string,
    suggestionDescriptions: string[],
    results: SearchResult[],
    apiKey: string,
    model?: LlmModel,
  ) => Promise<void>;
  toggleSort: () => void;
}

export const useEvaluationStore = create<EvaluationState>((set, get) => ({
  evaluations: new Map(),
  evaluatingMoments: new Set(),
  sortByEvaluation: false,
  error: null,

  loadEvaluations: async (momentIds: string[]) => {
    if (momentIds.length === 0) return;
    const db = await getDb();
    const newEvaluations = new Map(get().evaluations);

    for (const momentId of momentIds) {
      const rows = await db.select<EvaluatedClip[]>(
        "SELECT * FROM evaluated_clips WHERE moment_id = $1 ORDER BY relevance_score DESC",
        [momentId],
      );
      if (rows.length > 0) {
        newEvaluations.set(momentId, rows);
      }
    }
    set({ evaluations: newEvaluations });
  },

  evaluateMoment: async (
    momentId,
    scriptExcerpt,
    editorialNote,
    suggestionDescriptions,
    results,
    apiKey,
    model?,
  ) => {
    set((s) => ({
      evaluatingMoments: new Set(s.evaluatingMoments).add(momentId),
      error: null,
    }));

    try {
      const inputs = results.map((r) => {
        const matches: TranscriptMatch[] = r.transcript_matches_json
          ? JSON.parse(r.transcript_matches_json)
          : [];
        return {
          videoId: r.video_id,
          videoTitle: r.video_title ?? "Untitled",
          channelName: r.channel_name ?? "Unknown",
          duration: r.duration,
          transcriptMatches: matches,
        };
      });

      const clipEvaluations = await evaluateClips(
        scriptExcerpt,
        editorialNote,
        suggestionDescriptions,
        inputs,
        apiKey,
        model,
      );

      const db = await getDb();
      await db.execute("DELETE FROM evaluated_clips WHERE moment_id = $1", [
        momentId,
      ]);

      const saved: EvaluatedClip[] = [];
      for (const ev of clipEvaluations) {
        const matchingResult = results.find((r) => r.video_id === ev.videoId);
        if (!matchingResult) continue;

        const id = crypto.randomUUID();
        const now = new Date().toISOString();
        await db.execute(
          "INSERT INTO evaluated_clips (id, search_result_id, moment_id, relevance_score, relevance_reason, suggested_start_time, suggested_end_time, clip_description, usable, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)",
          [
            id,
            matchingResult.id,
            momentId,
            ev.relevanceScore,
            ev.relevanceReason,
            ev.suggestedStartTime,
            ev.suggestedEndTime,
            ev.clipDescription,
            ev.usable ? 1 : 0,
            now,
          ],
        );
        saved.push({
          id,
          search_result_id: matchingResult.id,
          moment_id: momentId,
          relevance_score: ev.relevanceScore,
          relevance_reason: ev.relevanceReason,
          suggested_start_time: ev.suggestedStartTime,
          suggested_end_time: ev.suggestedEndTime,
          clip_description: ev.clipDescription,
          usable: ev.usable ? 1 : 0,
          created_at: now,
        });
      }

      set((s) => {
        const newEvaluations = new Map(s.evaluations);
        newEvaluations.set(momentId, saved);
        const newEvaluating = new Set(s.evaluatingMoments);
        newEvaluating.delete(momentId);
        return {
          evaluations: newEvaluations,
          evaluatingMoments: newEvaluating,
        };
      });
    } catch (err) {
      set((s) => {
        const newEvaluating = new Set(s.evaluatingMoments);
        newEvaluating.delete(momentId);
        return {
          evaluatingMoments: newEvaluating,
          error: err instanceof Error ? err.message : "Evaluation failed",
        };
      });
    }
  },

  toggleSort: () => {
    set((s) => ({ sortByEvaluation: !s.sortByEvaluation }));
  },
}));
