import { create } from "zustand";
import type { BRollMoment, Moment } from "../types";
import { getDb } from "../lib/database";

interface MomentState {
  moments: Moment[];
  loading: boolean;
  error: string | null;
  loadMoments: (projectId: string) => Promise<void>;
  saveMoments: (projectId: string, brollMoments: BRollMoment[]) => Promise<void>;
  clearMoments: (projectId: string) => Promise<void>;
}

export const useMomentStore = create<MomentState>((set) => ({
  moments: [],
  loading: false,
  error: null,

  loadMoments: async (projectId: string) => {
    const db = await getDb();
    const rows = await db.select<Moment[]>(
      "SELECT * FROM moments WHERE project_id = $1 ORDER BY sort_order ASC",
      [projectId]
    );
    set({ moments: rows });
  },

  saveMoments: async (projectId: string, brollMoments: BRollMoment[]) => {
    const db = await getDb();
    await db.execute("DELETE FROM moments WHERE project_id = $1", [projectId]);

    for (let i = 0; i < brollMoments.length; i++) {
      const m = brollMoments[i];
      await db.execute(
        "INSERT INTO moments (id, project_id, script_excerpt, timestamp_hint, editorial_note, suggestions_json, sort_order) VALUES ($1, $2, $3, $4, $5, $6, $7)",
        [
          m.id,
          projectId,
          m.scriptExcerpt,
          m.timestampHint,
          m.editorialNote,
          JSON.stringify(m.suggestions),
          i,
        ]
      );
    }

    const rows = await db.select<Moment[]>(
      "SELECT * FROM moments WHERE project_id = $1 ORDER BY sort_order ASC",
      [projectId]
    );
    set({ moments: rows, error: null });
  },

  clearMoments: async (projectId: string) => {
    const db = await getDb();
    await db.execute("DELETE FROM moments WHERE project_id = $1", [projectId]);
    set({ moments: [] });
  },
}));
