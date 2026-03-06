import { create } from "zustand";
import type { SearchResult } from "../types";
import { getDb } from "../lib/database";
import { searchYouTube } from "../lib/youtube";
import type { YouTubeResult } from "../lib/youtube";
import { fetchTranscript, searchTranscript } from "../lib/transcript";

interface SearchState {
  results: Map<string, SearchResult[]>;
  searchingMoments: Set<string>;
  error: string | null;
  loadResults: (momentIds: string[]) => Promise<void>;
  searchForMoment: (momentId: string, queries: string[]) => Promise<void>;
  searchCustom: (momentId: string, query: string) => Promise<void>;
  fetchTranscriptMatches: (resultId: string, videoId: string, queries: string[]) => Promise<void>;
}

async function saveResults(momentId: string, ytResults: YouTubeResult[]): Promise<SearchResult[]> {
  const db = await getDb();
  const saved: SearchResult[] = [];

  for (const r of ytResults) {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await db.execute(
      "INSERT INTO search_results (id, moment_id, video_id, video_title, channel_name, thumbnail_url, duration, publish_date, captions_available, source_query, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)",
      [id, momentId, r.videoId, r.title, r.channelName, r.thumbnailUrl, r.duration, r.publishDate, r.captionsAvailable ? 1 : 0, r.sourceQuery, now]
    );
    saved.push({
      id,
      moment_id: momentId,
      video_id: r.videoId,
      video_title: r.title,
      channel_name: r.channelName,
      thumbnail_url: r.thumbnailUrl,
      duration: r.duration,
      publish_date: r.publishDate,
      captions_available: r.captionsAvailable ? 1 : 0,
      relevance_score: null,
      source_query: r.sourceQuery,
      transcript_matches_json: null,
      created_at: now,
    });
  }
  return saved;
}

export const useSearchStore = create<SearchState>((set, get) => ({
  results: new Map(),
  searchingMoments: new Set(),
  error: null,

  loadResults: async (momentIds: string[]) => {
    if (momentIds.length === 0) return;
    const db = await getDb();
    const newResults = new Map(get().results);

    for (const momentId of momentIds) {
      const rows = await db.select<SearchResult[]>(
        "SELECT * FROM search_results WHERE moment_id = $1 ORDER BY created_at DESC",
        [momentId]
      );
      if (rows.length > 0) {
        newResults.set(momentId, rows);
      }
    }
    set({ results: newResults });
  },

  searchForMoment: async (momentId: string, queries: string[]) => {
    set((s) => ({ searchingMoments: new Set(s.searchingMoments).add(momentId), error: null }));

    try {
      const allResults: YouTubeResult[] = [];
      const seenVideoIds = new Set<string>();

      for (const query of queries) {
        const results = await searchYouTube(query);
        for (const r of results) {
          if (!seenVideoIds.has(r.videoId)) {
            seenVideoIds.add(r.videoId);
            allResults.push(r);
          }
        }
        if (allResults.length >= 10) break;
      }

      const saved = await saveResults(momentId, allResults);

      for (const result of saved) {
        try {
          const segments = await fetchTranscript(result.video_id);
          if (segments) {
            const matches = queries.flatMap((q) => searchTranscript(segments, q));
            if (matches.length > 0) {
              const uniqueMatches = matches.filter(
                (m, i, arr) => arr.findIndex((a) => Math.abs(a.startTime - m.startTime) < 3) === i
              ).slice(0, 5);

              const db = await getDb();
              const matchesJson = JSON.stringify(uniqueMatches);
              await db.execute(
                "UPDATE search_results SET transcript_matches_json = $1 WHERE id = $2",
                [matchesJson, result.id]
              );
              result.transcript_matches_json = matchesJson;
            }
          }
        } catch (err) {
          console.warn(`Transcript fetch failed for ${result.video_id}:`, err);
        }
      }

      set((s) => {
        const newResults = new Map(s.results);
        const existing = newResults.get(momentId) ?? [];
        newResults.set(momentId, [...saved, ...existing]);
        const newSearching = new Set(s.searchingMoments);
        newSearching.delete(momentId);
        return { results: newResults, searchingMoments: newSearching };
      });
    } catch (err) {
      set((s) => {
        const newSearching = new Set(s.searchingMoments);
        newSearching.delete(momentId);
        return {
          searchingMoments: newSearching,
          error: err instanceof Error ? err.message : "Search failed",
        };
      });
    }
  },

  searchCustom: async (momentId: string, query: string) => {
    set((s) => ({ searchingMoments: new Set(s.searchingMoments).add(momentId), error: null }));

    try {
      const results = await searchYouTube(query);
      const saved = await saveResults(momentId, results);
      set((s) => {
        const newResults = new Map(s.results);
        const existing = newResults.get(momentId) ?? [];
        newResults.set(momentId, [...saved, ...existing]);
        const newSearching = new Set(s.searchingMoments);
        newSearching.delete(momentId);
        return { results: newResults, searchingMoments: newSearching };
      });
    } catch (err) {
      set((s) => {
        const newSearching = new Set(s.searchingMoments);
        newSearching.delete(momentId);
        return {
          searchingMoments: newSearching,
          error: err instanceof Error ? err.message : "Search failed",
        };
      });
    }
  },

  fetchTranscriptMatches: async (resultId: string, videoId: string, queries: string[]) => {
    const segments = await fetchTranscript(videoId);
    if (!segments) return;

    const matches = queries.flatMap((q) => searchTranscript(segments, q));
    if (matches.length === 0) return;

    const uniqueMatches = matches.filter(
      (m, i, arr) => arr.findIndex((a) => Math.abs(a.startTime - m.startTime) < 3) === i
    ).slice(0, 5);

    const db = await getDb();
    const matchesJson = JSON.stringify(uniqueMatches);
    await db.execute(
      "UPDATE search_results SET transcript_matches_json = $1 WHERE id = $2",
      [matchesJson, resultId]
    );

    set((s) => {
      const newResults = new Map(s.results);
      for (const [momentId, results] of newResults) {
        const updated = results.map((r) =>
          r.id === resultId ? { ...r, transcript_matches_json: matchesJson } : r
        );
        newResults.set(momentId, updated);
      }
      return { results: newResults };
    });
  },
}));
