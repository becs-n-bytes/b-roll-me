import { useState, useEffect, useCallback, useRef } from "react";
import type { SearchResult, EvaluatedClip, TranscriptMatch, TranscriptSegment, TranscriptLanguage } from "../types";
import { listTranscriptLanguages, fetchTranscript, transcribeWithWhisper } from "../lib/transcript";
import { getWhisperStatus } from "../lib/whisper";
import { getSettingFromDb } from "../stores/settingsStore";

interface PreviewModalProps {
  result: SearchResult;
  evaluation?: EvaluatedClip;
  onDownload: (startTime: number, endTime: number) => void;
  onClose: () => void;
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function getScoreColor(score: number | null): string {
  if (score === null) return "bg-neutral-700/50 text-neutral-400";
  if (score >= 90) return "bg-emerald-500/20 text-emerald-400";
  if (score >= 70) return "bg-blue-500/20 text-blue-400";
  if (score >= 50) return "bg-amber-500/20 text-amber-400";
  if (score >= 30) return "bg-orange-500/20 text-orange-400";
  return "bg-red-500/20 text-red-400";
}

export default function PreviewModal({
  result,
  evaluation,
  onDownload,
  onClose,
}: PreviewModalProps) {
  const transcriptMatches: TranscriptMatch[] = result.transcript_matches_json
    ? JSON.parse(result.transcript_matches_json)
    : [];

  const initialStart =
    evaluation?.suggested_start_time ??
    (transcriptMatches.length > 0
      ? Math.floor(transcriptMatches[0].startTime)
      : 0);
  const initialEnd =
    evaluation?.suggested_end_time ??
    (transcriptMatches.length > 0
      ? Math.ceil(transcriptMatches[0].endTime)
      : 10);

  const [startTime, setStartTime] = useState(initialStart);
  const [endTime, setEndTime] = useState(initialEnd);
  const [embedKey, setEmbedKey] = useState(0);
  const [languages, setLanguages] = useState<TranscriptLanguage[]>([]);
  const [transcriptLang, setTranscriptLang] = useState<string>("");
  const [transcriptGenerated, setTranscriptGenerated] = useState(false);
  const [fullSegments, setFullSegments] = useState<TranscriptSegment[]>([]);
  const [showFullTranscript, setShowFullTranscript] = useState(false);
  const [transcriptStatus, setTranscriptStatus] = useState<"idle" | "loading" | "loaded" | "unavailable">("idle");
  const [whisperStatus, setWhisperStatus] = useState<"idle" | "running" | "no_model" | "error">("idle");
  const [whisperStage, setWhisperStage] = useState("");
  const [whisperError, setWhisperError] = useState("");
  const activeSegmentRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setTranscriptStatus("loading");
    listTranscriptLanguages(result.video_id)
      .then(setLanguages)
      .catch(() => {});
    fetchTranscript(result.video_id)
      .then((t) => {
        if (t && t.segments.length > 0) {
          setTranscriptLang(t.language);
          setTranscriptGenerated(t.isGenerated);
          setFullSegments(t.segments);
          setTranscriptStatus("loaded");
        } else {
          setTranscriptStatus("unavailable");
        }
      })
      .catch(() => {
        setTranscriptStatus("unavailable");
      });
  }, [result.video_id]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose],
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  const jumpToStart = () => setEmbedKey((k) => k + 1);

  const adjustTime = (field: "start" | "end", delta: number) => {
    if (field === "start") {
      setStartTime((t) => Math.max(0, Math.round((t + delta) * 10) / 10));
    } else {
      setEndTime((t) => Math.max(0, Math.round((t + delta) * 10) / 10));
    }
  };

  const handleDownload = () => {
    onDownload(startTime, endTime);
    onClose();
  };

  const handleWhisperTranscribe = async () => {
    try {
      const modelName = await getSettingFromDb("whisper_model");
      const status = await getWhisperStatus(modelName);
      if (!status.downloaded) {
        setWhisperStatus("no_model");
        return;
      }
      setWhisperStatus("running");
      setWhisperStage("downloading_audio");
      const transcript = await transcribeWithWhisper(
        result.video_id,
        modelName,
        (stage) => setWhisperStage(stage),
      );
      setFullSegments(transcript.segments);
      setTranscriptLang(transcript.language);
      setTranscriptGenerated(transcript.isGenerated);
      setTranscriptStatus("loaded");
      setShowFullTranscript(true);
      setWhisperStatus("idle");
    } catch (err) {
      setWhisperStatus("error");
      setWhisperError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-6"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/70" />
      <div
        className="relative bg-neutral-900 border border-neutral-700 rounded-xl w-full max-w-3xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between p-4 border-b border-neutral-800">
          <div className="flex-1 min-w-0 mr-4">
            <h3 className="text-lg font-semibold text-neutral-100 line-clamp-2">
              {result.video_title}
            </h3>
            <p className="text-sm text-neutral-500 mt-1">
              {result.channel_name}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-neutral-500 hover:text-neutral-300 hover:bg-neutral-800 transition-colors shrink-0"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path
                d="M4 4l8 8M12 4l-8 8"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        <div className="p-4">
          <iframe
            key={embedKey}
            src={`https://www.youtube-nocookie.com/embed/${result.video_id}?start=${Math.floor(startTime)}&autoplay=1`}
            className="w-full aspect-video rounded-lg bg-black"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        </div>

        <div className="px-4 pb-4">
          <div className="flex items-center gap-4 p-3 bg-neutral-800/50 rounded-lg flex-wrap">
            <div className="flex items-center gap-1.5">
              <label className="text-xs text-neutral-500 w-8">Start</label>
              <button
                onClick={() => adjustTime("start", -5)}
                className="px-1.5 py-0.5 rounded bg-neutral-700 text-neutral-400 hover:text-white text-xs transition-colors"
              >
                -5
              </button>
              <button
                onClick={() => adjustTime("start", -1)}
                className="px-1.5 py-0.5 rounded bg-neutral-700 text-neutral-400 hover:text-white text-xs transition-colors"
              >
                -1
              </button>
              <input
                type="number"
                value={startTime}
                onChange={(e) =>
                  setStartTime(Math.max(0, parseFloat(e.target.value) || 0))
                }
                className="w-20 px-2 py-1 rounded bg-neutral-800 border border-neutral-600 text-neutral-200 text-sm font-mono text-center focus:outline-none focus:border-blue-500"
              />
              <button
                onClick={() => adjustTime("start", 1)}
                className="px-1.5 py-0.5 rounded bg-neutral-700 text-neutral-400 hover:text-white text-xs transition-colors"
              >
                +1
              </button>
              <button
                onClick={() => adjustTime("start", 5)}
                className="px-1.5 py-0.5 rounded bg-neutral-700 text-neutral-400 hover:text-white text-xs transition-colors"
              >
                +5
              </button>
            </div>
            <div className="flex items-center gap-1.5">
              <label className="text-xs text-neutral-500 w-8">End</label>
              <button
                onClick={() => adjustTime("end", -5)}
                className="px-1.5 py-0.5 rounded bg-neutral-700 text-neutral-400 hover:text-white text-xs transition-colors"
              >
                -5
              </button>
              <button
                onClick={() => adjustTime("end", -1)}
                className="px-1.5 py-0.5 rounded bg-neutral-700 text-neutral-400 hover:text-white text-xs transition-colors"
              >
                -1
              </button>
              <input
                type="number"
                value={endTime}
                onChange={(e) =>
                  setEndTime(Math.max(0, parseFloat(e.target.value) || 0))
                }
                className="w-20 px-2 py-1 rounded bg-neutral-800 border border-neutral-600 text-neutral-200 text-sm font-mono text-center focus:outline-none focus:border-blue-500"
              />
              <button
                onClick={() => adjustTime("end", 1)}
                className="px-1.5 py-0.5 rounded bg-neutral-700 text-neutral-400 hover:text-white text-xs transition-colors"
              >
                +1
              </button>
              <button
                onClick={() => adjustTime("end", 5)}
                className="px-1.5 py-0.5 rounded bg-neutral-700 text-neutral-400 hover:text-white text-xs transition-colors"
              >
                +5
              </button>
            </div>
            <button
              onClick={jumpToStart}
              className="px-3 py-1 rounded-lg text-xs font-medium text-neutral-400 hover:text-white hover:bg-neutral-700 transition-colors shrink-0"
            >
              Jump to Start
            </button>
          </div>
        </div>

        <div className="px-4 pb-4">
          <div className="flex items-center gap-3 flex-wrap text-xs text-neutral-500">
            {result.duration !== null && result.duration > 0 && (
              <span className="font-mono">{formatDuration(result.duration)}</span>
            )}
            {result.publish_date && <span>{formatDate(result.publish_date)}</span>}
            {result.captions_available === 1 && <span>CC</span>}
            {transcriptMatches.length > 0 && (
              <span className="text-purple-400">
                {transcriptMatches.length} transcript match
                {transcriptMatches.length !== 1 ? "es" : ""}
              </span>
            )}
            {transcriptLang && (
              <span className="text-neutral-400">
                {transcriptLang}
                {transcriptGenerated && (
                  <span className="ml-1 text-amber-500/70">(auto)</span>
                )}
              </span>
            )}
            {languages.length > 1 && (
              <span className="text-neutral-600">
                {languages.length} languages
              </span>
            )}
          </div>
          {evaluation && (
            <div className="mt-2 flex items-start gap-2">
              <span
                className={`px-2 py-0.5 rounded text-xs font-medium shrink-0 ${getScoreColor(evaluation.relevance_score)}`}
              >
                {evaluation.relevance_score}/100
              </span>
              {evaluation.relevance_reason && (
                <span className="text-xs text-neutral-400">
                  {evaluation.relevance_reason}
                </span>
              )}
            </div>
          )}
          {evaluation?.clip_description && (
            <p className="mt-1 text-sm text-neutral-400">
              {evaluation.clip_description}
            </p>
          )}
        </div>

        {transcriptMatches.length > 0 && (
          <div className="px-4 pb-4">
            <h4 className="text-xs font-medium text-neutral-500 mb-2">
              Transcript Matches
              {transcriptLang && (
                <span className="ml-1.5 font-normal text-neutral-600">
                  ({transcriptLang}{transcriptGenerated ? ", auto-generated" : ""})
                </span>
              )}
            </h4>
            <div className="flex flex-col gap-1.5">
              {transcriptMatches.map((m, i) => (
                <button
                  key={i}
                  onClick={() => {
                    setStartTime(Math.floor(m.startTime));
                    setEndTime(Math.ceil(m.endTime));
                  }}
                  className="text-left p-2 rounded bg-purple-500/10 border border-purple-500/20 hover:border-purple-500/40 transition-colors"
                >
                  <span className="px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-400 text-xs font-mono">
                    {formatDuration(Math.floor(m.startTime))} -{" "}
                    {formatDuration(Math.ceil(m.endTime))}
                  </span>
                  <p className="text-xs text-neutral-400 mt-1 line-clamp-2">
                    {m.text}
                  </p>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="px-4 pb-4">
          {transcriptStatus === "loaded" && !showFullTranscript && (
            <button
              onClick={() => setShowFullTranscript(true)}
              className="w-full py-2 rounded-lg text-xs font-medium text-neutral-400 hover:text-neutral-200 bg-neutral-800/50 hover:bg-neutral-800 border border-neutral-700/50 hover:border-neutral-600 transition-colors"
            >
              Show Full Transcript ({fullSegments.length} segments)
            </button>
          )}
          {transcriptStatus === "loading" && (
            <p className="text-xs text-neutral-500 text-center py-2">Loading transcript...</p>
          )}
          {transcriptStatus === "unavailable" && (
            <div>
              {whisperStatus === "idle" && (
                <button
                  onClick={handleWhisperTranscribe}
                  className="w-full py-2 rounded-lg text-xs font-medium text-neutral-400 hover:text-neutral-200 bg-neutral-800/50 hover:bg-neutral-800 border border-neutral-700/50 hover:border-neutral-600 transition-colors"
                >
                  Transcribe with Whisper
                </button>
              )}
              {whisperStatus === "running" && (
                <p className="text-xs text-neutral-400 text-center py-2">
                  {whisperStage === "downloading_audio" && "Downloading audio..."}
                  {whisperStage === "converting_audio" && "Converting audio..."}
                  {whisperStage === "transcribing" && "Transcribing with Whisper... This may take a minute."}
                  {!whisperStage && "Starting..."}
                </p>
              )}
              {whisperStatus === "no_model" && (
                <p className="text-xs text-amber-400 text-center py-2">
                  Download a Whisper model in Settings to enable local transcription
                </p>
              )}
              {whisperStatus === "error" && (
                <div className="text-center py-2">
                  <p className="text-xs text-red-400">{whisperError}</p>
                  <button
                    onClick={() => setWhisperStatus("idle")}
                    className="text-xs text-neutral-500 mt-1 hover:text-neutral-300 transition-colors"
                  >
                    Try again
                  </button>
                </div>
              )}
            </div>
          )}
          {showFullTranscript && fullSegments.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-xs font-medium text-neutral-500">
                  Full Transcript
                  {transcriptLang && (
                    <span className="ml-1.5 font-normal text-neutral-600">
                      ({transcriptLang}{transcriptGenerated ? ", auto-generated" : ""})
                    </span>
                  )}
                </h4>
                <button
                  onClick={() => setShowFullTranscript(false)}
                  className="text-xs text-neutral-500 hover:text-neutral-300 transition-colors"
                >
                  Hide
                </button>
              </div>
              <div className="max-h-64 overflow-y-auto rounded-lg border border-neutral-800 bg-neutral-950/50">
                {fullSegments.map((seg, i) => {
                  const isActive = seg.start >= startTime && seg.start < endTime;
                  return (
                    <button
                      key={i}
                      ref={isActive && !activeSegmentRef.current ? activeSegmentRef : undefined}
                      onClick={() => {
                        setStartTime(Math.floor(seg.start));
                        setEndTime(Math.ceil(seg.start + seg.duration + 5));
                      }}
                      className={`w-full text-left px-3 py-1.5 flex gap-2 hover:bg-neutral-800/70 transition-colors border-b border-neutral-800/50 last:border-b-0 ${
                        isActive ? "bg-blue-500/10" : ""
                      }`}
                    >
                      <span className={`text-xs font-mono shrink-0 pt-0.5 ${isActive ? "text-blue-400" : "text-neutral-600"}`}>
                        {formatDuration(Math.floor(seg.start))}
                      </span>
                      <span className={`text-xs leading-relaxed ${isActive ? "text-neutral-200" : "text-neutral-400"}`}>
                        {seg.text}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between p-4 border-t border-neutral-800">
          <a
            href={`https://youtube.com/watch?v=${result.video_id}&t=${Math.floor(startTime)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-neutral-500 hover:text-neutral-300 transition-colors"
          >
            Open in YouTube ↗
          </a>
          <button
            onClick={handleDownload}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-emerald-600 hover:bg-emerald-700 text-white transition-colors"
          >
            Download Clip ({formatDuration(Math.floor(startTime))} →{" "}
            {formatDuration(Math.ceil(endTime))})
          </button>
        </div>
      </div>
    </div>
  );
}
