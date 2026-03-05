import { fetch } from "@tauri-apps/plugin-http";
import { BROLL_SYSTEM_PROMPT } from "./prompts";
import type { BRollMoment, LlmModel } from "../types";
import { getSettingFromDb } from "../stores/settingsStore";
import { parseModelValue } from "./models";
import { streamAnthropic, streamOpenAiCompatible, streamGemini } from "./streaming";

interface AnthropicResponse {
  content: { type: string; text: string }[];
  error?: { type: string; message: string };
}

interface OpenAiCompatibleResponse {
  choices: { message: { content: string } }[];
  error?: { message: string };
}

interface GeminiResponse {
  candidates?: { content: { parts: { text: string }[] } }[];
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
      max_tokens: 16384,
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

async function callOpenAiCompatible(
  url: string,
  apiKey: string,
  model: string,
  systemPrompt: string,
  userMessage: string,
  providerLabel: string,
  extraHeaders?: Record<string, string>
): Promise<string> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
      ...extraHeaders,
    },
    body: JSON.stringify({
      model,
      max_tokens: 16384,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
    }),
  });

  if (response.status === 401) throw new Error(`Invalid API key. Check your ${providerLabel} API key in Settings.`);
  if (response.status === 429) throw new Error("Rate limited. Please wait a moment and try again.");
  if (response.status >= 500) throw new Error(`${providerLabel} API server error. Please try again later.`);
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`API error (${response.status}): ${errorText}`);
  }

  const data = (await response.json()) as OpenAiCompatibleResponse;
  if (data.error) throw new Error(`API error: ${data.error.message}`);

  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("No content in API response");
  return content;
}

async function callGemini(
  apiKey: string,
  model: string,
  systemPrompt: string,
  userMessage: string
): Promise<string> {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: "user", parts: [{ text: userMessage }] }],
        generationConfig: { maxOutputTokens: 16384 },
      }),
    },
  );

  if (response.status === 400) {
    const text = await response.text();
    if (text.includes("API_KEY_INVALID")) throw new Error("Invalid API key. Check your Gemini API key in Settings.");
    throw new Error(`API error (400): ${text}`);
  }
  if (response.status === 429) throw new Error("Rate limited. Please wait a moment and try again.");
  if (response.status >= 500) throw new Error("Gemini API server error. Please try again later.");
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`API error (${response.status}): ${errorText}`);
  }

  const data = (await response.json()) as GeminiResponse;
  if (data.error) throw new Error(`API error: ${data.error.message}`);

  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("No content in API response");
  return text;
}

export async function callLlm(
  systemPrompt: string,
  userMessage: string,
  apiKey: string,
  model?: LlmModel,
  onChunk?: (text: string) => void,
): Promise<string> {
  const selectedModel = model ?? await getSettingFromDb("llm_model");
  const { provider, modelId } = parseModelValue(selectedModel);

  switch (provider) {
    case "openai": {
      const key = await getSettingFromDb("openai_api_key") || apiKey;
      if (onChunk) return streamOpenAiCompatible("https://api.openai.com/v1/chat/completions", key, modelId, systemPrompt, userMessage, "OpenAI", onChunk);
      return callOpenAiCompatible(
        "https://api.openai.com/v1/chat/completions",
        key, modelId, systemPrompt, userMessage, "OpenAI",
      );
    }
    case "openrouter": {
      const key = await getSettingFromDb("openrouter_api_key");
      if (onChunk) return streamOpenAiCompatible("https://openrouter.ai/api/v1/chat/completions", key, modelId, systemPrompt, userMessage, "OpenRouter", onChunk);
      return callOpenAiCompatible(
        "https://openrouter.ai/api/v1/chat/completions",
        key, modelId, systemPrompt, userMessage, "OpenRouter",
      );
    }
    case "gemini": {
      const key = await getSettingFromDb("gemini_api_key");
      if (onChunk) return streamGemini(key, modelId, systemPrompt, userMessage, onChunk);
      return callGemini(key, modelId, systemPrompt, userMessage);
    }
    default: {
      const key = await getSettingFromDb("anthropic_api_key") || apiKey;
      if (onChunk) return streamAnthropic(key, modelId, systemPrompt, userMessage, onChunk);
      return callAnthropic(key, modelId, systemPrompt, userMessage);
    }
  }
}

export async function analyzeScript(
  scriptText: string,
  apiKey: string,
  model?: LlmModel,
  onChunk?: (text: string) => void,
): Promise<BRollMoment[]> {
  const maxMoments = Number(await getSettingFromDb("max_moments_per_analysis")) || 10;
  const systemPrompt = `${BROLL_SYSTEM_PROMPT}\n\nIdentify at most ${maxMoments} moments. Prioritize the most impactful B-Roll opportunities.`;

  const text = await callLlm(
    systemPrompt,
    `Analyze this script for B-Roll opportunities:\n\n${scriptText}`,
    apiKey,
    model,
    onChunk,
  );

  const jsonStr = extractJson(text);

  try {
    const parsed = JSON.parse(jsonStr) as { moments: Omit<BRollMoment, "id">[] };

    if (!parsed.moments || !Array.isArray(parsed.moments)) {
      throw new Error("Invalid response format: missing moments array");
    }

    return parsed.moments.map((m) => ({
      ...m,
      id: crypto.randomUUID(),
    }));
  } catch (err) {
    if (err instanceof SyntaxError) {
      throw new Error("LLM response was cut short. Try a shorter script or reduce max moments in Settings.");
    }
    throw err;
  }
}
