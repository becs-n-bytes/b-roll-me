import { describe, it, expect, vi, beforeEach } from "vitest";
import type { DownloadItem } from "../downloadStore";

vi.mock("../../lib/downloader");

const { mockDb } = await import("../../test/setup");
const { downloadClip, cancelDownload: cancelClipProcess } = await import("../../lib/downloader");

const mockDownloadClip = vi.mocked(downloadClip);
const mockCancelClipProcess = vi.mocked(cancelClipProcess);

const { useDownloadStore } = await import("../downloadStore");

const queueItem = (overrides: Partial<Omit<DownloadItem, "id" | "status" | "progressLines" | "error">> = {}) => ({
  momentId: "m-1",
  videoId: "vid-1",
  videoTitle: "Test Video",
  startTime: 10,
  endTime: 30,
  outputPath: "/output/clip.mp4",
  ...overrides,
});

describe("downloadStore", () => {
  beforeEach(() => {
    useDownloadStore.setState({
      queue: [],
      downloadedMomentIds: new Set<string>(),
    });
    mockDb.select.mockReset().mockResolvedValue([]);
    mockDb.execute.mockReset().mockResolvedValue({ rowsAffected: 0 });
    mockDownloadClip.mockReset();
    mockCancelClipProcess.mockReset().mockResolvedValue(undefined);
  });

  describe("addToQueue", () => {
    it("adds item with pending status and generated UUID", () => {
      mockDownloadClip.mockImplementation(() => new Promise(() => {}));

      useDownloadStore.setState({
        queue: [
          { id: "busy-1", momentId: "x", videoId: "x", videoTitle: "X", startTime: 0, endTime: 1, outputPath: "/x", status: "downloading", progressLines: [], error: null },
          { id: "busy-2", momentId: "y", videoId: "y", videoTitle: "Y", startTime: 0, endTime: 1, outputPath: "/y", status: "downloading", progressLines: [], error: null },
        ],
        downloadedMomentIds: new Set<string>(),
      });

      useDownloadStore.getState().addToQueue(queueItem());

      const { queue } = useDownloadStore.getState();
      expect(queue).toHaveLength(3);
      const added = queue[2];
      expect(added.status).toBe("pending");
      expect(added.id).toBeDefined();
      expect(added.progressLines).toEqual([]);
      expect(added.error).toBeNull();
      expect(added.momentId).toBe("m-1");
    });

    it("starts download for pending items", async () => {
      let resolveDownload: (value: string) => void;
      mockDownloadClip.mockImplementation(
        () => new Promise((resolve) => { resolveDownload = resolve; })
      );

      useDownloadStore.getState().addToQueue(queueItem());

      await vi.waitFor(() => {
        expect(mockDownloadClip).toHaveBeenCalledTimes(1);
      });

      const { queue } = useDownloadStore.getState();
      expect(queue[0].status).toBe("downloading");

      resolveDownload!("done");
    });
  });

  describe("concurrency", () => {
    it("respects max 2 concurrent downloads", async () => {
      const controllers: Array<{ resolve: (v: string) => void }> = [];
      mockDownloadClip.mockImplementation(
        () => new Promise((resolve) => { controllers.push({ resolve }); })
      );

      useDownloadStore.getState().addToQueue(queueItem({ videoId: "v1" }));
      useDownloadStore.getState().addToQueue(queueItem({ videoId: "v2" }));
      useDownloadStore.getState().addToQueue(queueItem({ videoId: "v3" }));

      await vi.waitFor(() => {
        expect(mockDownloadClip).toHaveBeenCalledTimes(2);
      });

      const { queue } = useDownloadStore.getState();
      const downloading = queue.filter((d) => d.status === "downloading");
      const pending = queue.filter((d) => d.status === "pending");
      expect(downloading).toHaveLength(2);
      expect(pending).toHaveLength(1);

      controllers.forEach((c) => c.resolve("done"));
    });

    it("starts next pending download when a slot frees up", async () => {
      const controllers: Array<{ resolve: (v: string) => void }> = [];
      mockDownloadClip.mockImplementation(
        () => new Promise((resolve) => { controllers.push({ resolve }); })
      );

      useDownloadStore.getState().addToQueue(queueItem({ videoId: "v1" }));
      useDownloadStore.getState().addToQueue(queueItem({ videoId: "v2" }));
      useDownloadStore.getState().addToQueue(queueItem({ videoId: "v3" }));

      await vi.waitFor(() => {
        expect(controllers).toHaveLength(2);
      });

      controllers[0].resolve("done");

      await vi.waitFor(() => {
        expect(mockDownloadClip).toHaveBeenCalledTimes(3);
      });

      controllers.forEach((c) => c.resolve("done"));
    });
  });

  describe("download completion", () => {
    it("saves to DB, sets complete status, and tracks momentId", async () => {
      mockDownloadClip.mockResolvedValue("done");

      useDownloadStore.getState().addToQueue(queueItem());

      await vi.waitFor(() => {
        const { queue } = useDownloadStore.getState();
        expect(queue[0].status).toBe("complete");
      });

      expect(mockDb.execute).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO downloaded_clips"),
        expect.arrayContaining(["m-1", "vid-1", "/output/clip.mp4", 10, 30])
      );
      expect(useDownloadStore.getState().downloadedMomentIds.has("m-1")).toBe(true);
    });
  });

  describe("download error", () => {
    it("sets error status with message", async () => {
      mockDownloadClip.mockRejectedValue(new Error("ffmpeg failed"));

      useDownloadStore.getState().addToQueue(queueItem());

      await vi.waitFor(() => {
        const { queue } = useDownloadStore.getState();
        expect(queue[0].status).toBe("error");
      });

      expect(useDownloadStore.getState().queue[0].error).toBe("ffmpeg failed");
    });
  });

  describe("cancelDownload", () => {
    it("sets cancelled status for pending items", async () => {
      mockDownloadClip.mockImplementation(() => new Promise(() => {}));

      useDownloadStore.getState().addToQueue(queueItem());

      await vi.waitFor(() => {
        expect(useDownloadStore.getState().queue).toHaveLength(1);
      });

      const id = useDownloadStore.getState().queue[0].id;
      await useDownloadStore.getState().cancelDownload(id);

      expect(useDownloadStore.getState().queue[0].status).toBe("cancelled");
    });

    it("calls cancelClipProcess for actively downloading items", async () => {
      mockDownloadClip.mockImplementation(() => new Promise(() => {}));

      useDownloadStore.getState().addToQueue(queueItem());

      await vi.waitFor(() => {
        expect(useDownloadStore.getState().queue[0].status).toBe("downloading");
      });

      const id = useDownloadStore.getState().queue[0].id;
      await useDownloadStore.getState().cancelDownload(id);

      expect(mockCancelClipProcess).toHaveBeenCalledWith(id);
    });

    it("does nothing for nonexistent id", async () => {
      await useDownloadStore.getState().cancelDownload("nonexistent");
      expect(mockCancelClipProcess).not.toHaveBeenCalled();
    });
  });

  describe("retryDownload", () => {
    it("resets status to pending and clears error", async () => {
      mockDownloadClip.mockRejectedValueOnce(new Error("fail"));

      useDownloadStore.getState().addToQueue(queueItem());

      await vi.waitFor(() => {
        expect(useDownloadStore.getState().queue[0].status).toBe("error");
      });

      mockDownloadClip.mockImplementation(() => new Promise(() => {}));

      const id = useDownloadStore.getState().queue[0].id;
      useDownloadStore.getState().retryDownload(id);

      await vi.waitFor(() => {
        const item = useDownloadStore.getState().queue[0];
        expect(item.error).toBeNull();
        expect(["pending", "downloading"]).toContain(item.status);
      });
    });
  });

  describe("clearCompleted", () => {
    it("removes complete and cancelled items from queue", () => {
      useDownloadStore.setState({
        queue: [
          { id: "1", momentId: "m-1", videoId: "v1", videoTitle: "V1", startTime: 0, endTime: 10, outputPath: "/a", status: "complete", progressLines: [], error: null },
          { id: "2", momentId: "m-2", videoId: "v2", videoTitle: "V2", startTime: 0, endTime: 10, outputPath: "/b", status: "cancelled", progressLines: [], error: null },
          { id: "3", momentId: "m-3", videoId: "v3", videoTitle: "V3", startTime: 0, endTime: 10, outputPath: "/c", status: "error", progressLines: [], error: "fail" },
          { id: "4", momentId: "m-4", videoId: "v4", videoTitle: "V4", startTime: 0, endTime: 10, outputPath: "/d", status: "pending", progressLines: [], error: null },
        ],
        downloadedMomentIds: new Set<string>(),
      });

      useDownloadStore.getState().clearCompleted();

      const { queue } = useDownloadStore.getState();
      expect(queue).toHaveLength(2);
      expect(queue.map((d) => d.id)).toEqual(["3", "4"]);
    });
  });

  describe("loadDownloadedMoments", () => {
    it("queries DB and populates downloadedMomentIds", async () => {
      mockDb.select.mockResolvedValueOnce([
        { moment_id: "m-1" },
        { moment_id: "m-3" },
      ]);

      await useDownloadStore.getState().loadDownloadedMoments(["m-1", "m-2", "m-3"]);

      expect(mockDb.select).toHaveBeenCalledWith(
        "SELECT DISTINCT moment_id FROM downloaded_clips WHERE moment_id IN ($1, $2, $3)",
        ["m-1", "m-2", "m-3"]
      );
      const ids = useDownloadStore.getState().downloadedMomentIds;
      expect(ids.has("m-1")).toBe(true);
      expect(ids.has("m-3")).toBe(true);
      expect(ids.has("m-2")).toBe(false);
    });

    it("returns early for empty momentIds array", async () => {
      await useDownloadStore.getState().loadDownloadedMoments([]);
      expect(mockDb.select).not.toHaveBeenCalled();
    });
  });
});
