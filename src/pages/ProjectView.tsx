import { useEffect, useState, useRef, useCallback } from "react";
import { useParams, useNavigate } from "react-router";
import { useProjectStore } from "../stores/projectStore";
import { useMomentStore } from "../stores/momentStore";
import { useSearchStore } from "../stores/searchStore";
import { useDownloadStore, type DownloadItem } from "../stores/downloadStore";
import { analyzeScript } from "../lib/llm";
import { estimateEvaluationTokens } from "../lib/evaluator";
import { ensureOutputDir } from "../lib/downloader";
import { getDb } from "../lib/database";
import { getSettingFromDb } from "../stores/settingsStore";
import { downloadDir } from "@tauri-apps/api/path";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { useEvaluationStore } from "../stores/evaluationStore";
import PreviewModal from "../components/PreviewModal";
import type { BRollSuggestion, SearchResult, TranscriptMatch, EvaluatedClip } from "../types";

function TrashIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M2 4h12M5.333 4V2.667a1.333 1.333 0 011.334-1.334h2.666a1.333 1.333 0 011.334 1.334V4m2 0v9.333a1.333 1.333 0 01-1.334 1.334H4.667a1.333 1.333 0 01-1.334-1.334V4h9.334z" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M3 7l3 3 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ArrowLeftIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ChevronDownIcon({ open }: { open: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" className={`transition-transform ${open ? "rotate-180" : ""}`}>
      <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.3" />
      <path d="M9.5 9.5L12.5 12.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M7 1v8m0 0L4 6.5m3 2.5l3-2.5M2 10.5v1a1 1 0 001 1h8a1 1 0 001-1v-1" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function FolderIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M1.5 3.5a1 1 0 011-1h3l1.5 1.5h4.5a1 1 0 011 1v5.5a1 1 0 01-1 1h-9a1 1 0 01-1-1v-7z" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

function SparkleIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M7 1l1.5 4.5L13 7l-4.5 1.5L7 13l-1.5-4.5L1 7l4.5-1.5L7 1z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  );
}

function SpinnerIcon() {
  return <div className="w-5 h-5 border-2 border-neutral-700 border-t-blue-500 rounded-full animate-spin" />;
}

function SmallSpinner() {
  return <div className="w-4 h-4 border-2 border-neutral-700 border-t-blue-500 rounded-full animate-spin" />;
}

const TYPE_COLORS: Record<string, string> = {
  visual: "bg-blue-500/20 text-blue-400",
  spoken: "bg-purple-500/20 text-purple-400",
  event: "bg-amber-500/20 text-amber-400",
};

const DURATION_LABELS: Record<string, string> = {
  short: "2-5s",
  medium: "5-15s",
  long: "15-30s",
};

function getScoreColor(score: number | null): string {
  if (score === null) return "bg-neutral-700/50 text-neutral-400";
  if (score >= 90) return "bg-emerald-500/20 text-emerald-400";
  if (score >= 70) return "bg-blue-500/20 text-blue-400";
  if (score >= 50) return "bg-amber-500/20 text-amber-400";
  if (score >= 30) return "bg-orange-500/20 text-orange-400";
  return "bg-red-500/20 text-red-400";
}

type SaveStatus = "idle" | "saving" | "saved";

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function sanitizeForFilename(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
}

function TranscriptMatchBadge({ match }: { match: TranscriptMatch }) {
  return (
    <a
      href={`https://youtube.com/watch?v=&t=${Math.floor(match.startTime)}`}
      target="_blank"
      rel="noopener noreferrer"
      className="block p-2 rounded bg-purple-500/10 border border-purple-500/20 hover:border-purple-500/40 transition-colors"
    >
      <div className="flex items-center gap-2 mb-1">
        <span className="px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-400 text-xs font-mono">
          {formatDuration(Math.floor(match.startTime))} - {formatDuration(Math.floor(match.endTime))}
        </span>
      </div>
      <p className="text-xs text-neutral-400 line-clamp-2">{match.text}</p>
    </a>
  );
}

function DownloadConfirm({
  defaultStart,
  defaultEnd,
  onConfirm,
  onCancel,
}: {
  defaultStart: number;
  defaultEnd: number;
  onConfirm: (start: number, end: number) => void;
  onCancel: () => void;
}) {
  const [start, setStart] = useState(String(defaultStart));
  const [end, setEnd] = useState(String(defaultEnd));

  return (
    <div className="flex items-center gap-2 mt-2 p-2 bg-neutral-800/50 rounded-lg">
      <div className="flex items-center gap-1.5">
        <label className="text-xs text-neutral-500">Start</label>
        <input
          type="text"
          value={start}
          onChange={(e) => setStart(e.target.value)}
          className="w-16 px-2 py-1 rounded bg-neutral-800 border border-neutral-700 text-neutral-200 text-xs font-mono focus:outline-none focus:border-blue-500"
        />
        <label className="text-xs text-neutral-500">End</label>
        <input
          type="text"
          value={end}
          onChange={(e) => setEnd(e.target.value)}
          className="w-16 px-2 py-1 rounded bg-neutral-800 border border-neutral-700 text-neutral-200 text-xs font-mono focus:outline-none focus:border-blue-500"
        />
      </div>
      <button
        onClick={() => onConfirm(parseFloat(start) || 0, parseFloat(end) || 10)}
        className="px-2.5 py-1 rounded text-xs font-medium bg-emerald-600 hover:bg-emerald-700 text-white transition-colors"
      >
        Confirm
      </button>
      <button
        onClick={onCancel}
        className="px-2 py-1 rounded text-xs text-neutral-500 hover:text-neutral-300 transition-colors"
      >
        Cancel
      </button>
    </div>
  );
}

function VideoResultCard({
  result,
  evaluation,
  onDownload,
  onPreview,
}: {
  result: SearchResult;
  evaluation?: EvaluatedClip;
  onDownload: (result: SearchResult, start: number, end: number) => void;
  onPreview: () => void;
}) {
  const [showConfirm, setShowConfirm] = useState(false);
  const transcriptMatches: TranscriptMatch[] = result.transcript_matches_json
    ? JSON.parse(result.transcript_matches_json)
    : [];

  const defaultStart = evaluation?.suggested_start_time ?? (transcriptMatches.length > 0 ? Math.floor(transcriptMatches[0].startTime) : 0);
  const defaultEnd = evaluation?.suggested_end_time ?? (transcriptMatches.length > 0 ? Math.ceil(transcriptMatches[0].endTime) : 10);

  return (
    <div className={`rounded-lg hover:bg-neutral-800/30 transition-colors${evaluation && !evaluation.usable ? " opacity-40" : ""}`}>
      <div className="flex gap-3 p-2">
        <button
          onClick={onPreview}
          className="flex gap-3 flex-1 min-w-0 group text-left"
        >
          {result.thumbnail_url && (
            <div className="w-32 rounded overflow-hidden shrink-0 bg-neutral-800">
              <img src={result.thumbnail_url} alt="" className="w-full h-full object-cover" />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <p className="text-sm text-neutral-200 line-clamp-2 group-hover:text-white">{result.video_title}</p>
            <p className="text-xs text-neutral-500 mt-1">{result.channel_name}</p>
            <div className="flex items-center gap-2 mt-1">
              {result.duration !== null && result.duration > 0 && (
                <span className="text-xs text-neutral-500 font-mono">{formatDuration(result.duration)}</span>
              )}
              {result.publish_date && (
                <span className="text-xs text-neutral-600">{formatDate(result.publish_date)}</span>
              )}
              {result.captions_available === 1 && (
                <span className="text-xs text-neutral-600">CC</span>
              )}
              {transcriptMatches.length > 0 && (
                <span className="text-xs text-purple-400">{transcriptMatches.length} transcript match{transcriptMatches.length !== 1 ? "es" : ""}</span>
              )}
              {evaluation && (
                <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${getScoreColor(evaluation.relevance_score)}`} title={evaluation.relevance_reason ?? undefined}>
                  {evaluation.relevance_score}/100
                </span>
              )}
            </div>
            {evaluation?.clip_description && (
              <p className="text-xs text-neutral-500 mt-1 line-clamp-1">{evaluation.clip_description}</p>
            )}
            {result.source_query && (
              <span className="inline-block mt-1 px-2 py-0.5 rounded bg-neutral-800 text-neutral-500 text-xs font-mono truncate max-w-48">
                {result.source_query}
              </span>
            )}
          </div>
        </button>
        <button
          onClick={() => setShowConfirm(!showConfirm)}
          className="self-start p-2 rounded-lg text-neutral-500 hover:text-emerald-400 hover:bg-emerald-500/10 transition-colors shrink-0"
          title="Download clip"
        >
          <DownloadIcon />
        </button>
      </div>
      {showConfirm && (
        <div className="px-2 pb-2">
          <DownloadConfirm
            defaultStart={defaultStart}
            defaultEnd={defaultEnd}
            onConfirm={(start, end) => {
              onDownload(result, start, end);
              setShowConfirm(false);
            }}
            onCancel={() => setShowConfirm(false)}
          />
        </div>
      )}
      {transcriptMatches.length > 0 && (
        <div className="px-2 pb-2 flex flex-col gap-1.5">
          {transcriptMatches.map((m, i) => (
            <TranscriptMatchBadge key={i} match={m} />
          ))}
        </div>
      )}
    </div>
  );
}

function SuggestionCard({ suggestion }: { suggestion: BRollSuggestion }) {
  return (
    <div className="flex flex-col gap-2 p-3 bg-neutral-800/50 rounded-lg">
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-neutral-500">#{suggestion.rank}</span>
        <span className={`px-2 py-0.5 rounded text-xs font-medium ${TYPE_COLORS[suggestion.type] ?? ""}`}>{suggestion.type}</span>
        <span className="px-2 py-0.5 rounded bg-neutral-700/50 text-neutral-400 text-xs">{DURATION_LABELS[suggestion.durationHint] ?? suggestion.durationHint}</span>
      </div>
      <p className="text-sm text-neutral-300">{suggestion.description}</p>
      <div className="flex flex-wrap gap-1.5">
        {suggestion.searchQueries.map((q, i) => (
          <span key={i} className="px-2 py-0.5 rounded bg-neutral-700/60 text-neutral-400 text-xs font-mono">{q}</span>
        ))}
      </div>
    </div>
  );
}

function MomentCard({
  moment,
  searchResults,
  isSearching,
  hasYouTubeKey,
  hasDownloads,
  evaluations,
  isEvaluating,
  sortByEvaluation,
  hasLlmKey,
  onSearch,
  onCustomSearch,
  onDownload,
  onPreview,
  onEvaluate,
  onToggleSort,
}: {
  moment: { id: string; script_excerpt: string; timestamp_hint: string | null; editorial_note: string | null; suggestions_json: string | null };
  searchResults: SearchResult[];
  isSearching: boolean;
  hasYouTubeKey: boolean;
  hasDownloads: boolean;
  evaluations: EvaluatedClip[];
  isEvaluating: boolean;
  sortByEvaluation: boolean;
  hasLlmKey: boolean;
  onSearch: (queries: string[]) => void;
  onCustomSearch: (query: string) => void;
  onDownload: (result: SearchResult, start: number, end: number) => void;
  onPreview: (result: SearchResult) => void;
  onEvaluate: () => void;
  onToggleSort: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [customQuery, setCustomQuery] = useState("");
  const suggestions: BRollSuggestion[] = moment.suggestions_json ? JSON.parse(moment.suggestions_json) : [];
  const typeSet = new Set(suggestions.map((s) => s.type));
  const allQueries = suggestions.flatMap((s) => s.searchQueries);
  const evalByResultId = new Map(evaluations.map((e) => [e.search_result_id, e]));
  const displayResults = sortByEvaluation && evaluations.length > 0
    ? [...searchResults].sort((a, b) => {
        const evalA = evalByResultId.get(a.id);
        const evalB = evalByResultId.get(b.id);
        if (evalA && !evalA.usable && (!evalB || evalB.usable)) return 1;
        if (evalB && !evalB.usable && (!evalA || evalA.usable)) return -1;
        const scoreA = evalA?.relevance_score ?? -1;
        const scoreB = evalB?.relevance_score ?? -1;
        return scoreB - scoreA;
      })
    : searchResults;

  return (
    <div className="bg-neutral-900 border border-neutral-800 rounded-xl overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full text-left px-5 py-4 flex items-start justify-between gap-4 hover:bg-neutral-800/30 transition-colors"
      >
        <div className="flex-1 min-w-0">
          <p className="text-sm text-neutral-200 line-clamp-2">{moment.script_excerpt}</p>
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            {moment.timestamp_hint && (
              <span className="px-2 py-0.5 rounded bg-neutral-800 text-neutral-400 text-xs font-mono">{moment.timestamp_hint}</span>
            )}
            {Array.from(typeSet).map((type) => (
              <span key={type} className={`px-2 py-0.5 rounded text-xs font-medium ${TYPE_COLORS[type] ?? ""}`}>{type}</span>
            ))}
            <span className="text-xs text-neutral-500">{suggestions.length} suggestion{suggestions.length !== 1 ? "s" : ""}</span>
            {searchResults.length > 0 && (
              <span className="text-xs text-blue-400">{searchResults.length} result{searchResults.length !== 1 ? "s" : ""}</span>
            )}
            {evaluations.length > 0 && (
              <span className="text-xs text-purple-400">{evaluations.filter((e) => e.usable).length}/{evaluations.length} usable</span>
            )}
            {hasDownloads && (
              <span className="flex items-center gap-1 text-xs text-emerald-500">
                <span className="w-2 h-2 rounded-full bg-emerald-500" />
                Clips downloaded
              </span>
            )}
          </div>
        </div>
        <ChevronDownIcon open={expanded} />
      </button>

      {expanded && (
        <div className="px-5 pb-5 border-t border-neutral-800">
          {moment.editorial_note && (
            <p className="text-sm text-neutral-400 italic mt-3 mb-4">{moment.editorial_note}</p>
          )}
          <div className="flex flex-col gap-3 mb-4">
            {suggestions.map((s, i) => (
              <SuggestionCard key={i} suggestion={s} />
            ))}
          </div>

          <div className="border-t border-neutral-800 pt-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <h4 className="text-sm font-medium text-neutral-300">Search Results</h4>
                {evaluations.length > 0 && (
                  <button
                    onClick={onToggleSort}
                    className={`px-2 py-1 rounded text-xs transition-colors ${sortByEvaluation ? "bg-purple-500/20 text-purple-400" : "bg-neutral-800 text-neutral-500 hover:text-neutral-300"}`}
                  >
                    {sortByEvaluation ? "Sorted by AI Score" : "Sort by AI Score"}
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2">
                {(isSearching || isEvaluating) && <SmallSpinner />}
                <button
                  onClick={() => onSearch(allQueries)}
                  disabled={!hasYouTubeKey || isSearching}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-blue-600 hover:bg-blue-700 disabled:bg-neutral-800 disabled:text-neutral-500 text-white transition-colors"
                >
                  <SearchIcon />
                  {searchResults.length > 0 ? "Search Again" : "Search"}
                </button>
                <button
                  onClick={onEvaluate}
                  disabled={!hasLlmKey || isEvaluating || searchResults.length === 0}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-purple-600 hover:bg-purple-700 disabled:bg-neutral-800 disabled:text-neutral-500 text-white transition-colors"
                  title={`Evaluate ${searchResults.length} results (~${estimateEvaluationTokens(searchResults.length)} tokens)`}
                >
                  <SparkleIcon />
                  {evaluations.length > 0 ? "Re-evaluate" : "Evaluate"}
                </button>
              </div>
            </div>

            <div className="flex gap-2 mb-3">
              <input
                type="text"
                value={customQuery}
                onChange={(e) => setCustomQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && customQuery.trim()) {
                    onCustomSearch(customQuery.trim());
                    setCustomQuery("");
                  }
                }}
                placeholder="Custom search query..."
                className="flex-1 px-3 py-1.5 rounded-lg bg-neutral-800 border border-neutral-700 text-neutral-200 placeholder-neutral-600 text-xs focus:outline-none focus:border-blue-500 transition-colors"
              />
              <button
                onClick={() => { if (customQuery.trim()) { onCustomSearch(customQuery.trim()); setCustomQuery(""); } }}
                disabled={!hasYouTubeKey || !customQuery.trim() || isSearching}
                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-neutral-800 hover:bg-neutral-700 disabled:text-neutral-600 text-neutral-300 transition-colors"
              >
                Search
              </button>
            </div>

            {searchResults.length > 0 ? (
              <div className="flex flex-col gap-1">
                {displayResults.map((r) => (
                  <VideoResultCard key={r.id} result={r} evaluation={evalByResultId.get(r.id)} onDownload={onDownload} onPreview={() => onPreview(r)} />
                ))}
              </div>
            ) : (
              <p className="text-xs text-neutral-600">
                {hasYouTubeKey ? "Click Search to find clips." : "Add your YouTube API key in Settings."}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function DownloadQueueItem({ item }: { item: DownloadItem }) {
  const cancelDownload = useDownloadStore((s) => s.cancelDownload);
  const retryDownload = useDownloadStore((s) => s.retryDownload);
  const lastLine = item.progressLines[item.progressLines.length - 1] ?? "";
  const percentMatch = lastLine.match(/(\d+\.?\d*)%/);
  const percent = percentMatch ? parseFloat(percentMatch[1]) : 0;

  return (
    <div className="flex items-center gap-3 py-2">
      <div className="flex-1 min-w-0">
        <p className="text-xs text-neutral-300 truncate">{item.videoTitle}</p>
        <div className="flex items-center gap-2 mt-1">
          {item.status === "downloading" && (
            <>
              <div className="flex-1 h-1.5 bg-neutral-800 rounded-full overflow-hidden">
                <div className="h-full bg-blue-500 rounded-full transition-all" style={{ width: `${percent}%` }} />
              </div>
              <span className="text-xs text-neutral-500 font-mono w-10 text-right">{percent.toFixed(0)}%</span>
            </>
          )}
          {item.status === "pending" && <span className="text-xs text-neutral-500">Queued</span>}
          {item.status === "complete" && <span className="text-xs text-emerald-500">Complete</span>}
          {item.status === "error" && <span className="text-xs text-red-400 truncate">{item.error}</span>}
          {item.status === "cancelled" && <span className="text-xs text-neutral-600">Cancelled</span>}
        </div>
      </div>
      {(item.status === "downloading" || item.status === "pending") && (
        <button onClick={() => cancelDownload(item.id)} className="p-1 rounded text-neutral-600 hover:text-red-400 transition-colors" title="Cancel">
          <XIcon />
        </button>
      )}
      {item.status === "error" && (
        <button onClick={() => retryDownload(item.id)} className="px-2 py-1 rounded text-xs text-blue-400 hover:bg-blue-500/10 transition-colors">
          Retry
        </button>
      )}
    </div>
  );
}

function DownloadQueuePanel() {
  const queue = useDownloadStore((s) => s.queue);
  const clearCompleted = useDownloadStore((s) => s.clearCompleted);

  if (queue.length === 0) {
    return (
      <section className="bg-neutral-900 border border-neutral-800 rounded-xl p-5 mb-12">
        <h2 className="text-lg font-semibold text-neutral-200 mb-3">Downloads</h2>
        <p className="text-sm text-neutral-600">No downloads yet. Click the download icon on a search result to start.</p>
      </section>
    );
  }

  const active = queue.filter((d) => d.status === "downloading" || d.status === "pending");
  const completed = queue.filter((d) => d.status === "complete");
  const cancelled = queue.filter((d) => d.status === "cancelled");
  const hasFinished = completed.length > 0 || cancelled.length > 0;

  return (
    <section className="bg-neutral-900 border border-neutral-800 rounded-xl p-5 mb-12">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold text-neutral-200">
          Downloads
          {active.length > 0 && <span className="ml-2 text-sm font-normal text-blue-400">({active.length} active)</span>}
        </h2>
        {hasFinished && (
          <button onClick={clearCompleted} className="text-xs text-neutral-500 hover:text-neutral-300 transition-colors">
            Clear finished
          </button>
        )}
      </div>
      <div className="divide-y divide-neutral-800">
        {queue.map((item) => (
          <DownloadQueueItem key={item.id} item={item} />
        ))}
      </div>
    </section>
  );
}

export default function ProjectView() {
  const { id } = useParams();
  const navigate = useNavigate();
  const currentProject = useProjectStore((s) => s.currentProject);
  const loadProject = useProjectStore((s) => s.loadProject);
  const updateProject = useProjectStore((s) => s.updateProject);
  const deleteProject = useProjectStore((s) => s.deleteProject);

  const moments = useMomentStore((s) => s.moments);
  const loadMoments = useMomentStore((s) => s.loadMoments);
  const saveMoments = useMomentStore((s) => s.saveMoments);

  const searchResults = useSearchStore((s) => s.results);
  const searchingMoments = useSearchStore((s) => s.searchingMoments);
  const searchError = useSearchStore((s) => s.error);
  const loadResults = useSearchStore((s) => s.loadResults);
  const searchForMoment = useSearchStore((s) => s.searchForMoment);
  const searchCustom = useSearchStore((s) => s.searchCustom);

  const addToQueue = useDownloadStore((s) => s.addToQueue);
  const downloadedMomentIds = useDownloadStore((s) => s.downloadedMomentIds);
  const loadDownloadedMoments = useDownloadStore((s) => s.loadDownloadedMoments);

  const evaluationMap = useEvaluationStore((s) => s.evaluations);
  const evaluatingMoments = useEvaluationStore((s) => s.evaluatingMoments);
  const sortByEvaluation = useEvaluationStore((s) => s.sortByEvaluation);
  const evaluationError = useEvaluationStore((s) => s.error);
  const loadEvaluations = useEvaluationStore((s) => s.loadEvaluations);
  const evaluateMoment = useEvaluationStore((s) => s.evaluateMoment);
  const toggleSort = useEvaluationStore((s) => s.toggleSort);

  const [scriptText, setScriptText] = useState("");
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState("");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showReanalyzeConfirm, setShowReanalyzeConfirm] = useState(false);

  const [analyzing, setAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [streamText, setStreamText] = useState("");
  const [streamExpanded, setStreamExpanded] = useState(true);
  const streamRef = useRef<HTMLPreElement>(null);
  const [hasApiKey, setHasApiKey] = useState(false);
  const [hasYouTubeKey, setHasYouTubeKey] = useState(false);
  const [youtubeApiKey, setYoutubeApiKey] = useState("");
  const [scriptChangedSinceAnalysis, setScriptChangedSinceAnalysis] = useState(false);
  const [searchingAll, setSearchingAll] = useState(false);
  const [evaluatingAll, setEvaluatingAll] = useState(false);
  const [outputDir, setOutputDir] = useState<string | null>(null);
  const [previewState, setPreviewState] = useState<{ result: SearchResult; momentId: string; momentIndex: number; evaluation?: EvaluatedClip } | null>(null);
  const [pipelineStep, setPipelineStep] = useState<"idle" | "confirming" | "analyzing" | "searching" | "evaluating" | "complete">("idle");
  const [pipelineProgress, setPipelineProgress] = useState({ current: 0, total: 0, detail: "" });
  const pipelineCancelledRef = useRef(false);

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const elapsedRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const analysisScriptRef = useRef<string>("");

  useEffect(() => {
    if (id) {
      loadProject(id);
      loadMoments(id);
    }
  }, [id, loadProject, loadMoments]);

  useEffect(() => {
    if (moments.length > 0) {
      loadResults(moments.map((m) => m.id));
      loadDownloadedMoments(moments.map((m) => m.id));
      loadEvaluations(moments.map((m) => m.id));
    }
  }, [moments, loadResults, loadDownloadedMoments, loadEvaluations]);

  useEffect(() => {
    (async () => {
      const db = await getDb();
      const modelRows = await db.select<{ value: string }[]>("SELECT value FROM settings WHERE key = $1", ["llm_model"]);
      setHasApiKey(modelRows.length > 0 && modelRows[0].value.length > 0);
      const ytRows = await db.select<{ value: string }[]>("SELECT value FROM settings WHERE key = $1", ["youtube_api_key"]);
      if (ytRows.length > 0 && ytRows[0].value.length > 0) {
        setHasYouTubeKey(true);
        setYoutubeApiKey(ytRows[0].value);
      }
    })();
  }, []);

  useEffect(() => {
    if (currentProject) {
      setScriptText(currentProject.script_text ?? "");
      setNameValue(currentProject.name);
      analysisScriptRef.current = currentProject.script_text ?? "";

      (async () => {
        let dir = currentProject.output_directory;
        if (!dir) {
          const downloads = await downloadDir();
          const base = downloads.endsWith("/") ? downloads : downloads + "/";
          dir = `${base}ai-broll/${sanitizeForFilename(currentProject.name)}`;
        }
        await ensureOutputDir(dir);
        setOutputDir(dir);
        if (!currentProject.output_directory && id) {
          const db = await getDb();
          await db.execute("UPDATE projects SET output_directory = $1 WHERE id = $2", [dir, id]);
        }
      })();
    }
  }, [currentProject, id]);

  useEffect(() => {
    if (moments.length > 0 && scriptText !== analysisScriptRef.current) {
      setScriptChangedSinceAnalysis(true);
    } else {
      setScriptChangedSinceAnalysis(false);
    }
  }, [scriptText, moments.length]);

  useEffect(() => {
    if (streamRef.current) {
      streamRef.current.scrollTop = streamRef.current.scrollHeight;
    }
  }, [streamText]);

  const saveScript = useCallback(
    async (text: string) => {
      if (!id) return;
      setSaveStatus("saving");
      await updateProject(id, { script_text: text });
      setSaveStatus("saved");
      savedTimerRef.current = setTimeout(() => setSaveStatus("idle"), 2000);
    },
    [id, updateProject]
  );

  const handleScriptChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const text = e.target.value;
    setScriptText(text);
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    saveTimerRef.current = setTimeout(() => saveScript(text), 500);
  };

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
      if (elapsedRef.current) clearInterval(elapsedRef.current);
    };
  }, []);

  const runAnalysis = async () => {
    if (!id || !scriptText.trim()) return;
    setAnalyzing(true);
    setAnalysisError(null);
    setStreamText("");
    setElapsedSeconds(0);
    elapsedRef.current = setInterval(() => setElapsedSeconds((s) => s + 1), 1000);
    try {
      const analysisModel = await getSettingFromDb("analysis_model_override") || undefined;
      const brollMoments = await analyzeScript(scriptText, "", analysisModel, (chunk) => {
        setStreamText((prev) => prev + chunk);
      });
      await saveMoments(id, brollMoments);
      analysisScriptRef.current = scriptText;
      setScriptChangedSinceAnalysis(false);
      setStreamText("");
    } catch (err) {
      setAnalysisError(err instanceof Error ? err.message : "Analysis failed");
    } finally {
      setAnalyzing(false);
      if (elapsedRef.current) clearInterval(elapsedRef.current);
    }
  };

  const handleSearchAll = async () => {
    if (!hasYouTubeKey) return;
    setSearchingAll(true);
    for (const moment of moments) {
      const suggestions: BRollSuggestion[] = moment.suggestions_json ? JSON.parse(moment.suggestions_json) : [];
      const queries = suggestions.flatMap((s) => s.searchQueries);
      if (queries.length > 0) await searchForMoment(moment.id, queries, youtubeApiKey);
    }
    setSearchingAll(false);
  };

  const handleDownload = (momentId: string, momentIndex: number, result: SearchResult, startTime: number, endTime: number) => {
    if (!outputDir) return;
    const filename = `${String(momentIndex + 1).padStart(2, "0")}_${sanitizeForFilename(result.video_title ?? "clip")}_${Math.floor(startTime)}-${Math.floor(endTime)}.mp4`;
    const outputPath = `${outputDir}/${filename}`;
    addToQueue({
      momentId,
      videoId: result.video_id,
      videoTitle: result.video_title ?? "Untitled",
      startTime,
      endTime,
      outputPath,
    });
  };

  const handleDownloadAll = () => {
    if (!outputDir) return;
    moments.forEach((moment, index) => {
      if (downloadedMomentIds.has(moment.id)) return;
      const results = searchResults.get(moment.id);
      if (!results || results.length === 0) return;
      const withMatches = results.find((r) => {
        const m: TranscriptMatch[] = r.transcript_matches_json ? JSON.parse(r.transcript_matches_json) : [];
        return m.length > 0;
      });
      const best = withMatches ?? results[0];
      const matches: TranscriptMatch[] = best.transcript_matches_json ? JSON.parse(best.transcript_matches_json) : [];
      const start = matches.length > 0 ? Math.floor(matches[0].startTime) : 0;
      const end = matches.length > 0 ? Math.ceil(matches[0].endTime) : 10;
      handleDownload(moment.id, index, best, start, end);
    });
  };

  const handleEvaluateMoment = async (momentId: string) => {
    const moment = moments.find((m) => m.id === momentId);
    if (!moment) return;
    const results = searchResults.get(momentId);
    if (!results || results.length === 0) return;
    const suggestions: BRollSuggestion[] = moment.suggestions_json ? JSON.parse(moment.suggestions_json) : [];
    const evalModel = await getSettingFromDb("evaluation_model_override") || undefined;
    await evaluateMoment(momentId, moment.script_excerpt, moment.editorial_note ?? "", suggestions.map((s) => s.description), results, "", evalModel);
  };

  const handlePreview = (result: SearchResult, momentId: string, momentIndex: number) => {
    const momentEvals = evaluationMap.get(momentId) ?? [];
    const evaluation = momentEvals.find((e) => e.search_result_id === result.id);
    setPreviewState({ result, momentId, momentIndex, evaluation });
  };

  const handleEvaluateAll = async () => {
    if (!hasApiKey) return;
    setEvaluatingAll(true);
    for (const moment of moments) {
      const results = searchResults.get(moment.id);
      if (!results || results.length === 0) continue;
      const suggestions: BRollSuggestion[] = moment.suggestions_json ? JSON.parse(moment.suggestions_json) : [];
      await evaluateMoment(moment.id, moment.script_excerpt, moment.editorial_note ?? "", suggestions.map((s) => s.description), results, "");
    }
    setEvaluatingAll(false);
  };

  const runPipeline = async () => {
    if (!id || !scriptText.trim()) return;
    pipelineCancelledRef.current = false;

    const db = await getDb();

    try {
      setPipelineStep("analyzing");
      setPipelineProgress({ current: 0, total: 1, detail: "Analyzing script..." });
      const pipelineAnalysisModel = await getSettingFromDb("analysis_model_override") || undefined;
      const brollMoments = await analyzeScript(scriptText, "", pipelineAnalysisModel);
      await saveMoments(id, brollMoments);
      analysisScriptRef.current = scriptText;
      setScriptChangedSinceAnalysis(false);

      if (pipelineCancelledRef.current) { setPipelineStep("idle"); return; }

      await loadMoments(id);
      const latestMoments = useMomentStore.getState().moments;
      if (latestMoments.length === 0) { setPipelineStep("complete"); setTimeout(() => setPipelineStep("idle"), 3000); return; }

      const ytRows = await db.select<{ value: string }[]>("SELECT value FROM settings WHERE key = $1", ["youtube_api_key"]);
      if (ytRows.length > 0 && ytRows[0].value) {
        setPipelineStep("searching");
        const ytKey = ytRows[0].value;
        for (let i = 0; i < latestMoments.length; i++) {
          if (pipelineCancelledRef.current) { setPipelineStep("idle"); return; }
          const m = latestMoments[i];
          setPipelineProgress({ current: i + 1, total: latestMoments.length, detail: `Searching moment ${i + 1} of ${latestMoments.length}...` });
          const suggestions: BRollSuggestion[] = m.suggestions_json ? JSON.parse(m.suggestions_json) : [];
          const queries = suggestions.flatMap((s) => s.searchQueries);
          if (queries.length > 0) await searchForMoment(m.id, queries, ytKey);
        }
      }

      if (pipelineCancelledRef.current) { setPipelineStep("idle"); return; }

      setPipelineStep("evaluating");
      const pipelineEvalModel = await getSettingFromDb("evaluation_model_override") || undefined;
      const latestSearch = useSearchStore.getState().results;
      const momentsWithResults = latestMoments.filter((m) => (latestSearch.get(m.id) ?? []).length > 0);
      for (let i = 0; i < momentsWithResults.length; i++) {
        if (pipelineCancelledRef.current) { setPipelineStep("idle"); return; }
        const m = momentsWithResults[i];
        const results = useSearchStore.getState().results.get(m.id);
        if (!results || results.length === 0) continue;
        setPipelineProgress({ current: i + 1, total: momentsWithResults.length, detail: `Evaluating moment ${i + 1} of ${momentsWithResults.length}...` });
        const suggestions: BRollSuggestion[] = m.suggestions_json ? JSON.parse(m.suggestions_json) : [];
        await evaluateMoment(m.id, m.script_excerpt, m.editorial_note ?? "", suggestions.map((s) => s.description), results, "", pipelineEvalModel);
      }

      setPipelineStep("complete");
      setTimeout(() => setPipelineStep("idle"), 3000);
    } catch (err) {
      setAnalysisError(err instanceof Error ? err.message : "Pipeline failed");
      setPipelineStep("idle");
    }
  };

  const cancelPipeline = () => {
    pipelineCancelledRef.current = true;
  };

  const handleOpenFolder = async () => {
    if (!outputDir) return;
    try {
      await revealItemInDir(outputDir);
    } catch (_) {
    }
  };

  const pipelineRunning = pipelineStep === "analyzing" || pipelineStep === "searching" || pipelineStep === "evaluating";
  const searchedCount = moments.filter((m) => (searchResults.get(m.id) ?? []).length > 0).length;
  const evaluatedCount = moments.filter((m) => (evaluationMap.get(m.id) ?? []).length > 0).length;
  const downloadedCount = moments.filter((m) => downloadedMomentIds.has(m.id)).length;
  const downloadableCount = moments.filter((m) => {
    const results = searchResults.get(m.id);
    return results && results.length > 0 && !downloadedMomentIds.has(m.id);
  }).length;

  const handleNameBlur = async () => {
    setEditingName(false);
    const trimmed = nameValue.trim();
    if (trimmed.length > 0 && id && trimmed !== currentProject?.name) await updateProject(id, { name: trimmed });
    else if (currentProject) setNameValue(currentProject.name);
  };

  const handleNameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") nameInputRef.current?.blur();
    if (e.key === "Escape") { setNameValue(currentProject?.name ?? ""); setEditingName(false); }
  };

  const handleDelete = async () => { if (!id) return; await deleteProject(id); navigate("/"); };

  if (!currentProject) {
    return (
      <div className="p-6">
        <div className="flex items-center gap-3 text-neutral-500"><SpinnerIcon /> Loading project...</div>
      </div>
    );
  }

  const canAnalyze = hasApiKey && scriptText.trim().length > 0 && !analyzing;

  return (
    <div className="p-6 max-w-4xl">
      <button onClick={() => navigate("/")} className="flex items-center gap-1.5 text-sm text-neutral-500 hover:text-neutral-300 transition-colors mb-4">
        <ArrowLeftIcon /> Back to projects
      </button>

      <div className="mb-6">
        {editingName ? (
          <input ref={nameInputRef} type="text" value={nameValue} onChange={(e) => setNameValue(e.target.value)} onBlur={handleNameBlur} onKeyDown={handleNameKeyDown} autoFocus className="text-2xl font-semibold text-neutral-100 bg-transparent border-b-2 border-blue-500 outline-none pb-1 w-full max-w-lg" />
        ) : (
          <button onClick={() => { setEditingName(true); setTimeout(() => nameInputRef.current?.focus(), 50); }} className="text-2xl font-semibold text-neutral-100 hover:text-white transition-colors text-left">{currentProject.name}</button>
        )}
      </div>

      <section className="mb-8">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-neutral-200">Script</h2>
          <span className={`flex items-center gap-1.5 text-xs transition-opacity ${saveStatus === "idle" ? "opacity-0" : "opacity-100"} ${saveStatus === "saved" ? "text-emerald-500" : "text-neutral-500"}`}>
            {saveStatus === "saving" && "Saving..."}
            {saveStatus === "saved" && (<><CheckIcon /> Saved</>)}
          </span>
        </div>
        <textarea value={scriptText} onChange={handleScriptChange} placeholder="Paste or type your script here..." className="w-full min-h-[300px] px-4 py-3 rounded-lg bg-neutral-900 border border-neutral-700 text-neutral-200 placeholder-neutral-600 focus:outline-none focus:border-blue-500 transition-colors resize-y text-sm leading-relaxed font-mono" />
      </section>

      <section className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold text-neutral-200">Analysis</h2>
            {moments.length > 0 && <span className="px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-400 text-xs font-medium">{moments.length} moment{moments.length !== 1 ? "s" : ""}</span>}
            {moments.length > 0 && (
              <div className="flex items-center gap-2 text-xs text-neutral-500">
                <span>{searchedCount}/{moments.length} searched</span>
                <span className="text-neutral-700">·</span>
                <span>{evaluatedCount}/{moments.length} evaluated</span>
                <span className="text-neutral-700">·</span>
                <span>{downloadedCount}/{moments.length} with clips</span>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            {scriptChangedSinceAnalysis && <span className="text-xs text-amber-500">Script changed since last analysis</span>}
            {moments.length > 0 && !analyzing && !pipelineRunning && (
              <>
                <button onClick={handleSearchAll} disabled={!hasYouTubeKey || searchingAll} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-emerald-400 hover:bg-emerald-500/10 disabled:text-neutral-600 disabled:hover:bg-transparent transition-colors">
                  {searchingAll ? <SmallSpinner /> : <SearchIcon />} Search All
                </button>
                <button onClick={handleEvaluateAll} disabled={!hasApiKey || evaluatingAll || searchedCount === 0} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-purple-400 hover:bg-purple-500/10 disabled:text-neutral-600 disabled:hover:bg-transparent transition-colors">
                  {evaluatingAll ? <SmallSpinner /> : <SparkleIcon />} Evaluate All
                </button>
                <button onClick={handleDownloadAll} disabled={downloadableCount === 0} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-blue-400 hover:bg-blue-500/10 disabled:text-neutral-600 disabled:hover:bg-transparent transition-colors">
                  <DownloadIcon /> Download All
                </button>
                {showReanalyzeConfirm ? (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-neutral-400">Replace results?</span>
                    <button onClick={() => { setShowReanalyzeConfirm(false); runAnalysis(); }} className="px-3 py-1.5 rounded-lg text-xs font-medium bg-blue-600 hover:bg-blue-700 text-white transition-colors">Yes</button>
                    <button onClick={() => setShowReanalyzeConfirm(false)} className="px-3 py-1.5 rounded-lg text-xs font-medium text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800 transition-colors">Cancel</button>
                  </div>
                ) : (
                  <button onClick={() => setShowReanalyzeConfirm(true)} disabled={!canAnalyze} className="px-4 py-2 rounded-lg text-sm font-medium text-blue-400 hover:bg-blue-500/10 disabled:text-neutral-600 disabled:hover:bg-transparent transition-colors">Re-analyze</button>
                )}
              </>
            )}
            {moments.length === 0 && !analyzing && !pipelineRunning && (
              <>
                <button onClick={runAnalysis} disabled={!canAnalyze} className="px-4 py-2 rounded-lg text-sm font-medium bg-blue-600 hover:bg-blue-700 disabled:bg-neutral-800 disabled:text-neutral-500 text-white transition-colors">Analyze Script</button>
                {pipelineStep === "confirming" ? (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-neutral-400">Run full pipeline?</span>
                    <button onClick={() => { setPipelineStep("idle"); runPipeline(); }} disabled={!canAnalyze || !hasYouTubeKey} className="px-3 py-1.5 rounded-lg text-xs font-medium bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white transition-colors">Start</button>
                    <button onClick={() => setPipelineStep("idle")} className="px-3 py-1.5 rounded-lg text-xs font-medium text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800 transition-colors">Cancel</button>
                  </div>
                ) : (
                  <button onClick={() => setPipelineStep("confirming")} disabled={!canAnalyze || !hasYouTubeKey} className="px-4 py-2 rounded-lg text-sm font-medium bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 disabled:bg-neutral-800 disabled:text-neutral-500 disabled:bg-none text-white transition-colors">Auto-Analyze</button>
                )}
              </>
            )}
          </div>
        </div>

        {analyzing && (
          <div className="bg-neutral-900 border border-neutral-800 rounded-xl overflow-hidden">
            <div className="flex items-center gap-3 p-4">
              <SpinnerIcon />
              <span className="text-sm text-neutral-400">Analyzing script... {elapsedSeconds}s</span>
              {streamText && (
                <button onClick={() => setStreamExpanded(!streamExpanded)} className="ml-auto text-xs text-neutral-500 hover:text-neutral-300 transition-colors">
                  {streamExpanded ? "Hide" : "Show"} output
                </button>
              )}
            </div>
            {streamExpanded && streamText && (
              <pre ref={streamRef} className="px-4 pb-4 text-xs text-neutral-500 font-mono max-h-64 overflow-y-auto whitespace-pre-wrap break-all border-t border-neutral-800 pt-3">
                {streamText}
              </pre>
            )}
          </div>
        )}
        {pipelineRunning && (
          <div className="p-4 bg-neutral-900 border border-neutral-800 rounded-xl mb-4">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <SpinnerIcon />
                <span className="text-sm font-medium text-neutral-200">
                  {pipelineStep === "analyzing" && "Step 1/3: Analyzing Script"}
                  {pipelineStep === "searching" && "Step 2/3: Searching YouTube"}
                  {pipelineStep === "evaluating" && "Step 3/3: Evaluating Results"}
                </span>
              </div>
              <button onClick={cancelPipeline} className="px-3 py-1 rounded-lg text-xs font-medium text-red-400 hover:bg-red-500/10 transition-colors">Cancel</button>
            </div>
            <p className="text-xs text-neutral-400 mb-2">{pipelineProgress.detail}</p>
            {pipelineProgress.total > 0 && (
              <div className="h-1.5 bg-neutral-800 rounded-full overflow-hidden">
                <div className="h-full bg-gradient-to-r from-blue-500 to-purple-500 rounded-full transition-all" style={{ width: `${(pipelineProgress.current / pipelineProgress.total) * 100}%` }} />
              </div>
            )}
          </div>
        )}
        {pipelineStep === "complete" && (
          <div className="p-3 bg-emerald-950/30 border border-emerald-900/50 rounded-xl mb-4">
            <p className="text-sm text-emerald-400">Pipeline complete — script analyzed, clips searched, and results evaluated.</p>
          </div>
        )}
        {analysisError && (
          <div className="p-4 bg-red-950/30 border border-red-900/50 rounded-xl mb-4">
            <p className="text-sm text-red-400">{analysisError}</p>
            <button onClick={runAnalysis} disabled={!canAnalyze} className="mt-2 px-3 py-1.5 rounded-lg text-xs font-medium bg-red-600 hover:bg-red-700 text-white transition-colors">Retry</button>
            {streamText && (
              <details className="mt-3">
                <summary className="text-xs text-neutral-500 cursor-pointer hover:text-neutral-400 transition-colors">Show raw LLM output</summary>
                <pre className="mt-2 text-xs text-neutral-600 font-mono max-h-48 overflow-y-auto whitespace-pre-wrap break-all">{streamText}</pre>
              </details>
            )}
          </div>
        )}
        {searchError && <div className="p-3 bg-red-950/30 border border-red-900/50 rounded-xl mb-4"><p className="text-sm text-red-400">{searchError}</p></div>}
        {evaluationError && <div className="p-3 bg-red-950/30 border border-red-900/50 rounded-xl mb-4"><p className="text-sm text-red-400">{evaluationError}</p></div>}
        {!analyzing && moments.length === 0 && !analysisError && <p className="text-sm text-neutral-600">{hasApiKey ? "Click \"Analyze Script\" to find B-Roll opportunities." : "Select a model and configure an API key in Settings to get started."}</p>}

        {moments.length > 0 && (
          <div className="flex flex-col gap-3">
            {moments.map((moment, index) => (
              <MomentCard
                key={moment.id}
                moment={moment}
                searchResults={searchResults.get(moment.id) ?? []}
                isSearching={searchingMoments.has(moment.id)}
                hasYouTubeKey={hasYouTubeKey}
                hasDownloads={downloadedMomentIds.has(moment.id)}
                evaluations={evaluationMap.get(moment.id) ?? []}
                isEvaluating={evaluatingMoments.has(moment.id)}
                sortByEvaluation={sortByEvaluation}
                hasLlmKey={hasApiKey}
                onSearch={(queries) => searchForMoment(moment.id, queries, youtubeApiKey)}
                onCustomSearch={(query) => searchCustom(moment.id, query, youtubeApiKey)}
                onDownload={(result, start, end) => handleDownload(moment.id, index, result, start, end)}
                onPreview={(result) => handlePreview(result, moment.id, index)}
                onEvaluate={() => handleEvaluateMoment(moment.id)}
                onToggleSort={toggleSort}
              />
            ))}
          </div>
        )}
      </section>

      <DownloadQueuePanel />

      {outputDir && (
        <button
          onClick={handleOpenFolder}
          className="flex items-center gap-2 mb-6 px-4 py-2 rounded-lg text-sm font-medium text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800 transition-colors"
        >
          <FolderIcon /> Open Project Folder
        </button>
      )}

      {previewState && (
        <PreviewModal
          result={previewState.result}
          evaluation={previewState.evaluation}
          onDownload={(start, end) => {
            handleDownload(previewState.momentId, previewState.momentIndex, previewState.result, start, end);
          }}
          onClose={() => setPreviewState(null)}
        />
      )}

      <div className="border-t border-neutral-800 pt-6">
        {showDeleteConfirm ? (
          <div className="flex items-center gap-3">
            <span className="text-sm text-neutral-400">Delete this project permanently?</span>
            <button onClick={handleDelete} className="px-4 py-2 rounded-lg text-sm font-medium bg-red-600 hover:bg-red-700 text-white transition-colors">Yes, delete</button>
            <button onClick={() => setShowDeleteConfirm(false)} className="px-4 py-2 rounded-lg text-sm font-medium text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800 transition-colors">Cancel</button>
          </div>
        ) : (
          <button onClick={() => setShowDeleteConfirm(true)} className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-red-500 hover:bg-red-950/30 transition-colors">
            <TrashIcon /> Delete project
          </button>
        )}
      </div>
    </div>
  );
}
