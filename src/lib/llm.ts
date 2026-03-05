import { fetch } from "@tauri-apps/plugin-http";
import { BROLL_SYSTEM_PROMPT } from "./prompts";
import type { BRollMoment, LlmModel } from "../types";
import { getSettingFromDb } from "../stores/settingsStore";

interface AnthropicResponse {
  content: { type: string; text: string }[];
  error?: { type: string; message: string };
}

interface OpenAiResponse {
  choices: { message: { content: string } }[];
  error?: { message: string };
}

function extractJson(text: string): string {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("No JSON object found in response");
  }
  return text.slice(start, end + 1);
}

async function callAnthropic(
  apiKey: string,
  model: string,
  systemPrompt: string,
  userMessage: string
): Promise<string> {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    }),
  });

  if (response.status === 401) throw new Error("Invalid API key. Check your Anthropic API key in Settings.");
  if (response.status === 429) throw new Error("Rate limited. Please wait a moment and try again.");
  if (response.status >= 500) throw new Error("Anthropic API server error. Please try again later.");
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`API error (${response.status}): ${errorText}`);
  }

  const data = (await response.json()) as AnthropicResponse;
  if (data.error) throw new Error(`API error: ${data.error.message}`);

  const textContent = data.content?.find((c) => c.type === "text");
  if (!textContent) throw new Error("No text content in API response");
  return textContent.text;
}

async function callOpenAi(
  apiKey: string,
  model: string,
  systemPrompt: string,
  userMessage: string
): Promise<string> {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
    }),
  });

  if (response.status === 401) throw new Error("Invalid API key. Check your OpenAI API key in Settings.");
  if (response.status === 429) throw new Error("Rate limited. Please wait a moment and try again.");
  if (response.status >= 500) throw new Error("OpenAI API server error. Please try again later.");
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`API error (${response.status}): ${errorText}`);
  }

  const data = (await response.json()) as OpenAiResponse;
  if (data.error) throw new Error(`API error: ${data.error.message}`);

  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("No content in API response");
  return content;
}

export async function callLlm(
  systemPrompt: string,
  userMessage: string,
  apiKey: string,
  model?: LlmModel
): Promise<string> {
  const selectedModel = model ?? await getSettingFromDb("llm_model");

  if (selectedModel === "gpt-4o") {
    return callOpenAi(apiKey, "gpt-4o", systemPrompt, userMessage);
  }
  return callAnthropic(apiKey, selectedModel, systemPrompt, userMessage);
}

export async function analyzeScript(
  scriptText: string,
  apiKey: string,
  model?: LlmModel
): Promise<BRollMoment[]> {
  const text = await callLlm(
    BROLL_SYSTEM_PROMPT,
    `Analyze this script for B-Roll opportunities:\n\n${scriptText}`,
    apiKey,
    model,
  );

  const jsonStr = extractJson(text);
  const parsed = JSON.parse(jsonStr) as { moments: Omit<BRollMoment, "id">[] };

  if (!parsed.moments || !Array.isArray(parsed.moments)) {
    throw new Error("Invalid response format: missing moments array");
  }

  return parsed.moments.map((m) => ({
    ...m,
    id: crypto.randomUUID(),
  }));
}
