import { fetch } from "@tauri-apps/plugin-http";
import { getInnertube } from "./innertube";
import { getDb } from "./database";
import type { TranscriptSegment, TranscriptMatch } from "../types";

interface TimedTextEvent {
  segs?: { utf8: string }[];
  tStartMs?: number;
  dDurationMs?: number;
}

interface TimedTextResponse {
  events?: TimedTextEvent[];
}

export async function fetchTranscript(videoId: string): Promise<TranscriptSegment[] | null> {
  const db = await getDb();
  const cached = await db.select<{ transcript_json: string }[]>(
    "SELECT transcript_json FROM transcript_cache WHERE video_id = $1",
    [videoId]
  );

  if (cached.length > 0) {
    return JSON.parse(cached[0].transcript_json);
  }

  const yt = await getInnertube();
  const info = await yt.getBasicInfo(videoId, { client: "ANDROID" });
  const tracks = info.captions?.caption_tracks;
  if (!tracks?.length) return null;

  const track =
    tracks.find((t) => t.language_code === "en" && t.kind !== "asr") ??
    tracks.find((t) => t.language_code === "en") ??
    tracks[0];

  if (!track?.base_url) return null;

  const captionUrl = new URL(track.base_url);
  captionUrl.searchParams.set("fmt", "json3");

  const response = await fetch(captionUrl.toString(), {
    headers: { Origin: "https://www.youtube.com", Referer: "https://www.youtube.com/" },
  });
  if (!response.ok) return null;

  const data = (await response.json()) as TimedTextResponse;
  if (!data.events?.length) return null;

  const segments: TranscriptSegment[] = data.events
    .filter((e) => e.segs && e.tStartMs !== undefined)
    .map((e) => ({
      text: e.segs!.map((s) => s.utf8).join("").trim(),
      start: (e.tStartMs ?? 0) / 1000,
      duration: (e.dDurationMs ?? 0) / 1000,
    }))
    .filter((s) => s.text.length > 0);

  if (segments.length === 0) return null;

  await db.execute(
    "INSERT OR REPLACE INTO transcript_cache (video_id, transcript_json, language) VALUES ($1, $2, $3)",
    [videoId, JSON.stringify(segments), track.language_code ?? "en"]
  );

  return segments;
}

export function searchTranscript(
  segments: TranscriptSegment[],
  query: string
): TranscriptMatch[] {
  const lowerQuery = query.toLowerCase();
  const words = lowerQuery.split(/\s+/).filter((w) => w.length > 2);
  const matches: TranscriptMatch[] = [];

  for (let i = 0; i < segments.length; i++) {
    const windowSegments = segments.slice(i, i + 3);
    const windowText = windowSegments.map((s) => s.text).join(" ").toLowerCase();

    const matchCount = words.filter((w) => windowText.includes(w)).length;
    if (matchCount >= Math.ceil(words.length * 0.5)) {
      const startTime = windowSegments[0].start;
      const lastSeg = windowSegments[windowSegments.length - 1];
      const endTime = lastSeg.start + lastSeg.duration;

      if (!matches.some((m) => Math.abs(m.startTime - startTime) < 5)) {
        matches.push({
          text: windowSegments.map((s) => s.text).join(" "),
          startTime,
          endTime,
        });
      }
    }
  }

  return matches.slice(0, 5);
}
