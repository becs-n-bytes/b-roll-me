import { create } from "zustand";
import { downloadClip, cancelDownload as cancelClipProcess } from "../lib/downloader";
import { getDb } from "../lib/database";
import { useSettingsStore } from "./settingsStore";

export type DownloadStatus = "pending" | "downloading" | "complete" | "error" | "cancelled";

export interface DownloadItem {
  id: string;
  momentId: string;
  videoId: string;
  videoTitle: string;
  startTime: number;
  endTime: number;
  outputPath: string;
  status: DownloadStatus;
  progressLines: string[];
  error: string | null;
}

interface DownloadState {
  queue: DownloadItem[];
  downloadedMomentIds: Set<string>;
  addToQueue: (item: Omit<DownloadItem, "id" | "status" | "progressLines" | "error">) => void;
  cancelDownload: (id: string) => Promise<void>;
  retryDownload: (id: string) => void;
  clearCompleted: () => void;
  loadDownloadedMoments: (momentIds: string[]) => Promise<void>;
}

export const useDownloadStore = create<DownloadState>((set, get) => {
  const processQueue = () => {
    const { queue } = get();
    const activeCount = queue.filter((d) => d.status === "downloading").length;
    const pending = queue.filter((d) => d.status === "pending");
    const maxConcurrent = useSettingsStore.getState().settings.max_concurrent_downloads;

    const toStart = Math.min(maxConcurrent - activeCount, pending.length);
    for (let i = 0; i < toStart; i++) {
      startDownload(pending[i].id);
    }
  };

  const startDownload = async (id: string) => {
    const item = get().queue.find((d) => d.id === id);
    if (!item) return;

    set((s) => ({
      queue: s.queue.map((d) => d.id === id ? { ...d, status: "downloading" as const } : d),
    }));

    try {
      await downloadClip(
        id,
        `https://www.youtube.com/watch?v=${item.videoId}`,
        item.startTime,
        item.endTime,
        item.outputPath,
        (line) => {
          set((s) => ({
            queue: s.queue.map((d) =>
              d.id === id ? { ...d, progressLines: [...d.progressLines.slice(-20), line] } : d
            ),
          }));
        },
      );

      const db = await getDb();
      await db.execute(
        "INSERT INTO downloaded_clips (id, moment_id, video_id, file_path, start_time, end_time, downloaded_at) VALUES ($1, $2, $3, $4, $5, $6, datetime('now'))",
        [id, item.momentId, item.videoId, item.outputPath, item.startTime, item.endTime]
      );

      set((s) => ({
        queue: s.queue.map((d) => d.id === id ? { ...d, status: "complete" as const } : d),
        downloadedMomentIds: new Set([...s.downloadedMomentIds, item.momentId]),
      }));
    } catch (err) {
      const currentItem = get().queue.find((d) => d.id === id);
      if (currentItem?.status === "cancelled") return;

      set((s) => ({
        queue: s.queue.map((d) =>
          d.id === id ? { ...d, status: "error" as const, error: err instanceof Error ? err.message : String(err) } : d
        ),
      }));
    } finally {
      processQueue();
    }
  };

  return {
    queue: [],
    downloadedMomentIds: new Set<string>(),

    addToQueue: (item) => {
      const id = crypto.randomUUID();
      set((s) => ({
        queue: [...s.queue, { ...item, id, status: "pending", progressLines: [], error: null }],
      }));
      processQueue();
    },

    cancelDownload: async (id) => {
      const item = get().queue.find((d) => d.id === id);
      if (!item) return;

      set((s) => ({
        queue: s.queue.map((d) =>
          d.id === id ? { ...d, status: "cancelled" as const } : d
        ),
      }));

      if (item.status === "downloading") {
        await cancelClipProcess(id);
      }
    },

    retryDownload: (id) => {
      set((s) => ({
        queue: s.queue.map((d) =>
          d.id === id ? { ...d, status: "pending" as const, progressLines: [], error: null } : d
        ),
      }));
      processQueue();
    },

    clearCompleted: () => {
      set((s) => ({
        queue: s.queue.filter((d) => d.status !== "complete" && d.status !== "cancelled"),
      }));
    },

    loadDownloadedMoments: async (momentIds) => {
      if (momentIds.length === 0) return;
      const db = await getDb();
      const placeholders = momentIds.map((_, i) => `$${i + 1}`).join(", ");
      const rows = await db.select<{ moment_id: string }[]>(
        `SELECT DISTINCT moment_id FROM downloaded_clips WHERE moment_id IN (${placeholders})`,
        momentIds
      );
      set({ downloadedMomentIds: new Set(rows.map((r) => r.moment_id)) });
    },
  };
});
