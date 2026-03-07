import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { WhisperModelInfo } from "../types";

export const WHISPER_MODELS: WhisperModelInfo[] = [
  { name: "tiny.en", displayName: "Tiny (English)", size: "75 MB", sizeBytes: 78_643_200 },
  { name: "base.en", displayName: "Base (English)", size: "142 MB", sizeBytes: 148_897_792 },
  { name: "small.en", displayName: "Small (English)", size: "466 MB", sizeBytes: 488_636_416 },
  { name: "medium.en", displayName: "Medium (English)", size: "1.5 GB", sizeBytes: 1_610_612_736 },
  { name: "large-v3-turbo-q5_0", displayName: "Large v3 Turbo (Quantized)", size: "547 MB", sizeBytes: 573_308_928 },
];

interface WhisperModelStatus {
  downloaded: boolean;
  path: string;
  size_bytes: number | null;
}

interface ModelDownloadProgressPayload {
  model_name: string;
  downloaded: number;
  total: number;
}

interface TranscriptionProgressPayload {
  video_id: string;
  stage: string;
  progress: number;
}

export async function getWhisperStatus(modelName: string): Promise<WhisperModelStatus> {
  return invoke<WhisperModelStatus>("get_whisper_status", { model_name: modelName });
}

export async function downloadWhisperModel(
  modelName: string,
  onProgress?: (downloaded: number, total: number) => void,
): Promise<string> {
  let unlisten: UnlistenFn | undefined;

  if (onProgress) {
    unlisten = await listen<ModelDownloadProgressPayload>("whisper-model-progress", (event) => {
      if (event.payload.model_name === modelName) {
        onProgress(event.payload.downloaded, event.payload.total);
      }
    });
  }

  try {
    return await invoke<string>("download_whisper_model", { model_name: modelName });
  } finally {
    unlisten?.();
  }
}

export async function deleteWhisperModel(modelName: string): Promise<void> {
  await invoke("delete_whisper_model", { model_name: modelName });
}

export async function transcribeVideo(
  videoId: string,
  modelName: string,
  onProgress?: (stage: string, progress: number) => void,
): Promise<string> {
  let unlisten: UnlistenFn | undefined;

  if (onProgress) {
    unlisten = await listen<TranscriptionProgressPayload>("transcription-progress", (event) => {
      if (event.payload.video_id === videoId) {
        onProgress(event.payload.stage, event.payload.progress);
      }
    });
  }

  try {
    return await invoke<string>("transcribe_video", {
      video_id: videoId,
      model_name: modelName,
    });
  } finally {
    unlisten?.();
  }
}
