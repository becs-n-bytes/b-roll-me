import { fetch } from "@tauri-apps/plugin-http";
import { getDb } from "./database";
import type { TranscriptSegment, TranscriptMatch } from "../types";

const BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

interface CaptionTrack {
  baseUrl: string;
  languageCode: string;
}

interface PlayerResponse {
  captions?: {
    playerCaptionsTracklistRenderer?: {
      captionTracks?: CaptionTrack[];
    };
  };
}

interface TimedTextEvent {
  segs?: { utf8: string }[];
  tStartMs?: number;
  dDurationMs?: number;
}

interface TimedTextResponse {
  events?: TimedTextEvent[];
}

async function getCaptionUrl(videoId: string, lang = "en"): Promise<string | null> {
  const response = await fetch("https://www.youtube.com/youtubei/v1/player", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": BROWSER_UA,
    },
    body: JSON.stringify({
      context: {
        client: {
          clientName: "WEB",
          clientVersion: "2.20240101.00.00",
        },
      },
      videoId,
    }),
  });

  if (!response.ok) return null;

  const data = (await response.json()) as PlayerResponse;
  const tracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
  if (!tracks?.length) return null;

  const track = tracks.find((t) => t.languageCode === lang) ?? tracks[0];
  if (!track?.baseUrl) return null;

  return track.baseUrl.includes("fmt=")
    ? track.baseUrl
    : `${track.baseUrl}&fmt=json3`;
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

  const captionUrl = await getCaptionUrl(videoId);
  if (!captionUrl) return null;

  let safeUrl: string;
  try {
    safeUrl = new URL(captionUrl).toString();
  } catch {
    return null;
  }

  const response = await fetch(safeUrl, {
    headers: { "User-Agent": BROWSER_UA },
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
    [videoId, JSON.stringify(segments), "en"]
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
