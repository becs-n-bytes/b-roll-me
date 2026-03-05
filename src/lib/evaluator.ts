import { EVALUATION_SYSTEM_PROMPT } from "./prompts";
import { callLlm } from "./llm";
import type { LlmModel } from "../types";

interface EvaluationInput {
  videoId: string;
  videoTitle: string;
  channelName: string;
  duration: number | null;
  transcriptMatches: { text: string; startTime: number; endTime: number }[];
}

export interface ClipEvaluation {
  videoId: string;
  relevanceScore: number;
  relevanceReason: string;
  suggestedStartTime: number;
  suggestedEndTime: number;
  clipDescription: string;
  usable: boolean;
}

function extractJson(text: string): string {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("No JSON object found in response");
  }
  return text.slice(start, end + 1);
}

export function estimateEvaluationTokens(resultCount: number): number {
  return Math.ceil(resultCount * 200 + 400);
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export async function evaluateClips(
  scriptExcerpt: string,
  editorialNote: string,
  suggestionDescriptions: string[],
  results: EvaluationInput[],
  apiKey: string,
  model?: LlmModel
): Promise<ClipEvaluation[]> {
  if (results.length === 0) return [];

  const resultsText = results
    .map((r, i) => {
      const matchInfo =
        r.transcriptMatches.length > 0
          ? `\n  Transcript matches:\n${r.transcriptMatches.map((m) => `    [${m.startTime.toFixed(1)}s-${m.endTime.toFixed(1)}s] "${m.text}"`).join("\n")}`
          : "\n  No transcript matches available.";

      return `Result ${i + 1}:\n  Video ID: ${r.videoId}\n  Title: ${r.videoTitle}\n  Channel: ${r.channelName}\n  Duration: ${r.duration ? formatDuration(r.duration) : "unknown"}${matchInfo}`;
    })
    .join("\n\n");

  const userMessage = `Context:\nScript excerpt: "${scriptExcerpt}"\nEditorial note: ${editorialNote}\nWhat we're looking for: ${suggestionDescriptions.join("; ")}\n\nSearch results to evaluate:\n${resultsText}`;

  const text = await callLlm(
    EVALUATION_SYSTEM_PROMPT,
    userMessage,
    apiKey,
    model,
  );

  const jsonStr = extractJson(text);
  const parsed = JSON.parse(jsonStr) as { evaluations: ClipEvaluation[] };

  if (!parsed.evaluations || !Array.isArray(parsed.evaluations)) {
    throw new Error("Invalid response format: missing evaluations array");
  }

  return parsed.evaluations;
}
