import { fetch } from "@tauri-apps/plugin-http";
import { getInnertube } from "./innertube";
import { getDb } from "./database";
import { transcribeVideo } from "./whisper";
import type {
  TranscriptSegment,
  TranscriptMatch,
  TranscriptLanguage,
  FetchedTranscript,
} from "../types";

interface TimedTextEvent {
  segs?: { utf8: string }[];
  tStartMs?: number;
  dDurationMs?: number;
}

interface TimedTextResponse {
  events?: TimedTextEvent[];
}

interface CaptionTrack {
  base_url: string;
  language_code: string;
  name?: { text?: string } | string;
  kind?: string;
  is_translatable?: boolean;
}

interface FetchTranscriptOptions {
  language?: string;
  translateTo?: string;
}

function getTrackName(track: CaptionTrack): string {
  if (!track.name) return track.language_code;
  if (typeof track.name === "string") return track.name;
  return track.name.text ?? track.language_code;
}

function selectTrack(tracks: CaptionTrack[], language?: string): CaptionTrack | null {
  if (language) {
    const manual = tracks.find((t) => t.language_code === language && t.kind !== "asr");
    if (manual) return manual;
    const any = tracks.find((t) => t.language_code === language);
    if (any) return any;
  }

  return (
    tracks.find((t) => t.language_code === "en" && t.kind !== "asr") ??
    tracks.find((t) => t.language_code === "en") ??
    tracks.find((t) => t.kind !== "asr") ??
    tracks[0] ??
    null
  );
}

function parseTimedText(data: TimedTextResponse): TranscriptSegment[] {
  if (!data.events?.length) return [];

  return data.events
    .filter((e) => e.segs && e.tStartMs !== undefined)
    .map((e) => ({
      text: e.segs!.map((s) => s.utf8).join("").trim(),
      start: (e.tStartMs ?? 0) / 1000,
      duration: (e.dDurationMs ?? 0) / 1000,
    }))
    .filter((s) => s.text.length > 0);
}

async function getCaptionTracks(videoId: string): Promise<CaptionTrack[]> {
  const yt = await getInnertube();
  const info = await yt.getBasicInfo(videoId, { client: "ANDROID" });
  const tracks = info.captions?.caption_tracks;
  if (!tracks?.length) return [];
  return tracks as unknown as CaptionTrack[];
}

export async function listTranscriptLanguages(
  videoId: string,
): Promise<TranscriptLanguage[]> {
  const tracks = await getCaptionTracks(videoId);
  return tracks.map((t) => ({
    code: t.language_code,
    name: getTrackName(t),
    isGenerated: t.kind === "asr",
    isTranslatable: t.is_translatable ?? false,
  }));
}

export async function fetchTranscript(
  videoId: string,
  options?: FetchTranscriptOptions,
): Promise<FetchedTranscript | null> {
  const db = await getDb();
  const language = options?.language;
  const translateTo = options?.translateTo;

  if (!language && !translateTo) {
    const cached = await db.select<{ transcript_json: string; language: string }[]>(
      "SELECT transcript_json, language FROM transcript_cache WHERE video_id = $1",
      [videoId],
    );

    if (cached.length > 0) {
      const parsed = JSON.parse(cached[0].transcript_json);
      if (Array.isArray(parsed)) {
        return {
          segments: parsed,
          language: cached[0].language ?? "en",
          languageCode: cached[0].language ?? "en",
          isGenerated: false,
        };
      }
      return parsed as FetchedTranscript;
    }
  }

  const tracks = await getCaptionTracks(videoId);
  if (tracks.length === 0) return null;

  const track = selectTrack(tracks, language);
  if (!track?.base_url) return null;

  const captionUrl = new URL(track.base_url);
  captionUrl.searchParams.set("fmt", "json3");
  if (translateTo) {
    captionUrl.searchParams.set("tlang", translateTo);
  }

  const response = await fetch(captionUrl.toString(), {
    headers: { Origin: "https://www.youtube.com", Referer: "https://www.youtube.com/" },
  });
  if (!response.ok) return null;

  const data = (await response.json()) as TimedTextResponse;
  const segments = parseTimedText(data);
  if (segments.length === 0) return null;

  const isGenerated = track.kind === "asr";
  const resolvedLanguage = translateTo ?? track.language_code;
  const resolvedName = translateTo ? `${getTrackName(track)} → ${translateTo}` : getTrackName(track);

  const result: FetchedTranscript = {
    segments,
    language: resolvedName,
    languageCode: resolvedLanguage,
    isGenerated,
  };

  if (!translateTo) {
    await db.execute(
      "INSERT OR REPLACE INTO transcript_cache (video_id, transcript_json, language) VALUES ($1, $2, $3)",
      [videoId, JSON.stringify(result), track.language_code ?? "en"],
    );
  }

  return result;
}

export async function transcribeWithWhisper(
  videoId: string,
  modelName: string,
  onProgress?: (stage: string, progress: number) => void,
): Promise<FetchedTranscript> {
  const json = await transcribeVideo(videoId, modelName, onProgress);
  const result = JSON.parse(json) as FetchedTranscript;

  const db = await getDb();
  await db.execute(
    "INSERT OR REPLACE INTO transcript_cache (video_id, transcript_json, language) VALUES ($1, $2, $3)",
    [videoId, JSON.stringify(result), result.languageCode],
  );

  return result;
}

export function searchTranscript(
  segments: TranscriptSegment[],
  query: string,
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
