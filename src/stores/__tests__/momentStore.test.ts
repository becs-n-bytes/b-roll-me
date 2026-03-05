import { describe, it, expect, beforeEach } from "vitest";
import { useMomentStore } from "../momentStore";
import type { Moment, BRollMoment } from "../../types";

const { mockDb } = await import("../../test/setup");

const makeMoment = (overrides: Partial<Moment> = {}): Moment => ({
  id: "m-1",
  project_id: "proj-1",
  script_excerpt: "test excerpt",
  timestamp_hint: "00:30",
  editorial_note: "note",
  suggestions_json: null,
  sort_order: 0,
  created_at: "2025-01-01T00:00:00.000Z",
  ...overrides,
});

const makeBRollMoment = (overrides: Partial<BRollMoment> = {}): BRollMoment => ({
  id: "bm-1",
  scriptExcerpt: "excerpt",
  timestampHint: "00:30",
  editorialNote: "note",
  suggestions: [
    {
      rank: 1,
      type: "visual",
      description: "a visual",
      searchQueries: ["query1"],
      durationHint: "short",
    },
  ],
  ...overrides,
});

describe("momentStore", () => {
  beforeEach(() => {
    useMomentStore.setState({ moments: [], loading: false, error: null });
    mockDb.select.mockReset().mockResolvedValue([]);
    mockDb.execute.mockReset().mockResolvedValue({ rowsAffected: 0 });
  });

  describe("loadMoments", () => {
    it("queries DB with project_id and sets moments", async () => {
      const moments = [makeMoment(), makeMoment({ id: "m-2", sort_order: 1 })];
      mockDb.select.mockResolvedValueOnce(moments);

      await useMomentStore.getState().loadMoments("proj-1");

      expect(mockDb.select).toHaveBeenCalledWith(
        "SELECT * FROM moments WHERE project_id = $1 ORDER BY sort_order ASC",
        ["proj-1"]
      );
      expect(useMomentStore.getState().moments).toEqual(moments);
    });

    it("sets empty array when no moments exist", async () => {
      await useMomentStore.getState().loadMoments("proj-1");
      expect(useMomentStore.getState().moments).toEqual([]);
    });
  });

  describe("saveMoments", () => {
    it("deletes existing moments then inserts each new one", async () => {
      const brollMoments = [makeBRollMoment(), makeBRollMoment({ id: "bm-2" })];
      const reloaded = [makeMoment(), makeMoment({ id: "m-2" })];
      mockDb.select.mockResolvedValueOnce(reloaded);

      await useMomentStore.getState().saveMoments("proj-1", brollMoments);

      expect(mockDb.execute).toHaveBeenCalledWith(
        "DELETE FROM moments WHERE project_id = $1",
        ["proj-1"]
      );
      expect(mockDb.execute).toHaveBeenCalledTimes(3);
      expect(useMomentStore.getState().moments).toEqual(reloaded);
    });

    it("stores suggestions as JSON string", async () => {
      const bm = makeBRollMoment();
      mockDb.select.mockResolvedValueOnce([]);

      await useMomentStore.getState().saveMoments("proj-1", [bm]);

      const insertCall = mockDb.execute.mock.calls[1];
      expect(insertCall[0]).toContain("INSERT INTO moments");
      const params = insertCall[1] as unknown[];
      expect(params[5]).toBe(JSON.stringify(bm.suggestions));
    });

    it("passes correct sort_order for each moment", async () => {
      const moments = [makeBRollMoment({ id: "a" }), makeBRollMoment({ id: "b" })];
      mockDb.select.mockResolvedValueOnce([]);

      await useMomentStore.getState().saveMoments("proj-1", moments);

      const firstInsertParams = (mockDb.execute.mock.calls[1][1] as unknown[]);
      expect(firstInsertParams[6]).toBe(0);
      const secondInsertParams = (mockDb.execute.mock.calls[2][1] as unknown[]);
      expect(secondInsertParams[6]).toBe(1);
    });

    it("clears error on successful save", async () => {
      useMomentStore.setState({ error: "old error" });
      mockDb.select.mockResolvedValueOnce([]);

      await useMomentStore.getState().saveMoments("proj-1", []);

      expect(useMomentStore.getState().error).toBeNull();
    });
  });

  describe("clearMoments", () => {
    it("deletes from DB and clears state", async () => {
      useMomentStore.setState({ moments: [makeMoment()] });

      await useMomentStore.getState().clearMoments("proj-1");

      expect(mockDb.execute).toHaveBeenCalledWith(
        "DELETE FROM moments WHERE project_id = $1",
        ["proj-1"]
      );
      expect(useMomentStore.getState().moments).toEqual([]);
    });
  });
});
