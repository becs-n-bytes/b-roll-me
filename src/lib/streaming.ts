import { fetch } from "@tauri-apps/plugin-http";

interface AnthropicStreamEvent {
  type: string;
  delta?: { type: string; text?: string };
}

interface OpenAiStreamChunk {
  choices?: { delta?: { content?: string } }[];
}

interface GeminiStreamChunk {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
}

async function readSSEStream(
  response: Response,
  extractText: (data: unknown) => string | undefined,
  onChunk: (text: string) => void,
): Promise<string> {
  if (!response.body) throw new Error("No response body received");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let fullText = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop()!;

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const payload = line.slice(6).trim();
      if (payload === "[DONE]") return fullText;

      try {
        const data = JSON.parse(payload) as unknown;
        const text = extractText(data);
        if (text) {
          fullText += text;
          onChunk(text);
        }
      } catch {
      }
    }
  }

  return fullText;
}

export async function streamAnthropic(
  apiKey: string,
  model: string,
  systemPrompt: string,
  userMessage: string,
  maxTokens: number,
  onChunk: (text: string) => void,
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
      max_tokens: maxTokens,
      stream: true,
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

  return readSSEStream(
    response,
    (data) => {
      const event = data as AnthropicStreamEvent;
      if (event.type === "content_block_delta" && event.delta?.type === "text_delta") {
        return event.delta.text;
      }
      return undefined;
    },
    onChunk,
  );
}

export async function streamOpenAiCompatible(
  url: string,
  apiKey: string,
  model: string,
  systemPrompt: string,
  userMessage: string,
  providerLabel: string,
  maxTokens: number,
  onChunk: (text: string) => void,
  extraHeaders?: Record<string, string>,
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
      max_tokens: maxTokens,
      stream: true,
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

  return readSSEStream(
    response,
    (data) => {
      const chunk = data as OpenAiStreamChunk;
      return chunk.choices?.[0]?.delta?.content ?? undefined;
    },
    onChunk,
  );
}

export async function streamGemini(
  apiKey: string,
  model: string,
  systemPrompt: string,
  userMessage: string,
  maxTokens: number,
  onChunk: (text: string) => void,
): Promise<string> {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${apiKey}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: "user", parts: [{ text: userMessage }] }],
        generationConfig: { maxOutputTokens: maxTokens },
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

  return readSSEStream(
    response,
    (data) => {
      const chunk = data as GeminiStreamChunk;
      return chunk.candidates?.[0]?.content?.parts?.[0]?.text ?? undefined;
    },
    onChunk,
  );
}
