export interface Project {
  id: string;
  name: string;
  script_text: string | null;
  output_directory: string | null;
  created_at: string;
  updated_at: string;
}

export interface BRollSuggestion {
  rank: number;
  type: "visual" | "spoken" | "event";
  description: string;
  searchQueries: string[];
  durationHint: "short" | "medium" | "long";
}

export interface BRollMoment {
  id: string;
  scriptExcerpt: string;
  timestampHint: string;
  editorialNote: string;
  suggestions: BRollSuggestion[];
}

export interface Moment {
  id: string;
  project_id: string;
  script_excerpt: string;
  timestamp_hint: string | null;
  editorial_note: string | null;
  suggestions_json: string | null;
  sort_order: number;
  created_at: string;
}

export interface TranscriptSegment {
  text: string;
  start: number;
  duration: number;
}

export interface TranscriptMatch {
  text: string;
  startTime: number;
  endTime: number;
}

export interface SearchResult {
  id: string;
  moment_id: string;
  video_id: string;
  video_title: string | null;
  channel_name: string | null;
  thumbnail_url: string | null;
  duration: number | null;
  publish_date: string | null;
  captions_available: number;
  relevance_score: number | null;
  source_query: string | null;
  transcript_matches_json: string | null;
  created_at: string;
}

export type VideoFormat = "mp4" | "webm";
export type Resolution = "720" | "1080" | "best";
export type LlmModel = "claude-sonnet-4-20250514" | "claude-haiku-4-20250414" | "gpt-4o";

export interface AppSettings {
  anthropic_api_key: string;
  openai_api_key: string;
  youtube_api_key: string;
  default_output_dir: string;
  video_format: VideoFormat;
  resolution: Resolution;
  max_concurrent_downloads: number;
  llm_model: LlmModel;
  max_moments_per_analysis: number;
  theme: "dark" | "light";
  check_for_updates: boolean;
}

export interface EvaluatedClip {
  id: string;
  search_result_id: string;
  moment_id: string;
  relevance_score: number | null;
  relevance_reason: string | null;
  suggested_start_time: number | null;
  suggested_end_time: number | null;
  clip_description: string | null;
  usable: number;
  created_at: string;
}
