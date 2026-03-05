import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

interface DownloadProgressPayload {
  clip_id: string;
  line: string;
}

export async function downloadClip(
  clipId: string,
  videoUrl: string,
  startTime: number,
  endTime: number,
  outputPath: string,
  onProgress?: (line: string) => void,
): Promise<string> {
  let unlisten: UnlistenFn | undefined;

  if (onProgress) {
    unlisten = await listen<DownloadProgressPayload>("download-progress", (event) => {
      if (event.payload.clip_id === clipId) {
        onProgress(event.payload.line);
      }
    });
  }

  try {
    const result = await invoke<string>("download_clip", {
      clip_id: clipId,
      video_url: videoUrl,
      start_time: startTime,
      end_time: endTime,
      output_path: outputPath,
    });
    return result;
  } finally {
    unlisten?.();
  }
}

export async function cancelDownload(clipId: string): Promise<void> {
  await invoke("cancel_download", { clip_id: clipId });
}

export async function ensureOutputDir(path: string): Promise<string> {
  return invoke<string>("ensure_output_dir", { path });
}
