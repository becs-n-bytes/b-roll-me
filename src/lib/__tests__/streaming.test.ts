import { describe, it, expect, vi, beforeEach } from "vitest";
import { streamAnthropic, streamOpenAiCompatible, streamGemini } from "../streaming";

function makeSSEStream(lines: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const text = lines.join("\n") + "\n";
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    },
  });
}

function makeResponse(status: number, lines?: string[]): Partial<Response> {
  if (lines) {
    return {
      ok: true,
      status,
      body: makeSSEStream(lines),
    };
  }
  return {
    ok: false,
    status,
    text: () => Promise.resolve("error body"),
  };
}

describe("streaming", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    const http = await import("@tauri-apps/plugin-http");
    mockFetch = http.fetch as ReturnType<typeof vi.fn>;
    vi.clearAllMocks();
  });

  describe("streamAnthropic", () => {
    it("extracts text from content_block_delta events", async () => {
      const chunks: string[] = [];
      mockFetch.mockResolvedValue(makeResponse(200, [
        'data: {"type":"message_start","message":{"id":"msg_1"}}',
        'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}',
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":" world"}}',
        'data: {"type":"content_block_stop","index":0}',
        'data: {"type":"message_stop"}',
      ]));

      const result = await streamAnthropic("key", "model", "system", "user", (chunk) => chunks.push(chunk));
      expect(result).toBe("Hello world");
      expect(chunks).toEqual(["Hello", " world"]);
    });

    it("sends stream: true in request body", async () => {
      mockFetch.mockResolvedValue(makeResponse(200, [
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"hi"}}',
      ]));

      await streamAnthropic("sk-key", "claude-sonnet-4-20250514", "sys", "usr", () => {});
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.stream).toBe(true);
      expect(body.max_tokens).toBe(16384);
    });

    it("throws on 401", async () => {
      mockFetch.mockResolvedValue(makeResponse(401));
      await expect(streamAnthropic("bad", "m", "s", "u", () => {})).rejects.toThrow("Invalid API key");
    });

    it("throws on 429", async () => {
      mockFetch.mockResolvedValue(makeResponse(429));
      await expect(streamAnthropic("k", "m", "s", "u", () => {})).rejects.toThrow("Rate limited");
    });

    it("ignores non-text-delta events", async () => {
      const chunks: string[] = [];
      mockFetch.mockResolvedValue(makeResponse(200, [
        'data: {"type":"ping"}',
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"only this"}}',
        'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}',
      ]));

      const result = await streamAnthropic("k", "m", "s", "u", (c) => chunks.push(c));
      expect(result).toBe("only this");
      expect(chunks).toEqual(["only this"]);
    });
  });

  describe("streamOpenAiCompatible", () => {
    it("extracts text from delta.content", async () => {
      const chunks: string[] = [];
      mockFetch.mockResolvedValue(makeResponse(200, [
        'data: {"choices":[{"delta":{"role":"assistant","content":""},"finish_reason":null}]}',
        'data: {"choices":[{"delta":{"content":"Hello"},"finish_reason":null}]}',
        'data: {"choices":[{"delta":{"content":" there"},"finish_reason":null}]}',
        'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}',
        "data: [DONE]",
      ]));

      const result = await streamOpenAiCompatible("https://api.openai.com/v1/chat/completions", "key", "gpt-4", "sys", "usr", "OpenAI", (c) => chunks.push(c));
      expect(result).toBe("Hello there");
      expect(chunks).toEqual(["Hello", " there"]);
    });

    it("stops on [DONE] marker", async () => {
      const chunks: string[] = [];
      mockFetch.mockResolvedValue(makeResponse(200, [
        'data: {"choices":[{"delta":{"content":"before"}}]}',
        "data: [DONE]",
        'data: {"choices":[{"delta":{"content":"after"}}]}',
      ]));

      const result = await streamOpenAiCompatible("url", "k", "m", "s", "u", "Test", (c) => chunks.push(c));
      expect(result).toBe("before");
    });

    it("throws on 401 with provider label", async () => {
      mockFetch.mockResolvedValue(makeResponse(401));
      await expect(streamOpenAiCompatible("url", "k", "m", "s", "u", "OpenRouter", () => {})).rejects.toThrow("Check your OpenRouter API key");
    });
  });

  describe("streamGemini", () => {
    it("extracts text from candidates", async () => {
      const chunks: string[] = [];
      mockFetch.mockResolvedValue(makeResponse(200, [
        'data: {"candidates":[{"content":{"parts":[{"text":"Hello"}],"role":"model"}}]}',
        'data: {"candidates":[{"content":{"parts":[{"text":" Gemini"}],"role":"model"}}]}',
      ]));

      const result = await streamGemini("key", "gemini-pro", "sys", "usr", (c) => chunks.push(c));
      expect(result).toBe("Hello Gemini");
      expect(chunks).toEqual(["Hello", " Gemini"]);
    });

    it("uses streamGenerateContent endpoint with alt=sse", async () => {
      mockFetch.mockResolvedValue(makeResponse(200, [
        'data: {"candidates":[{"content":{"parts":[{"text":"ok"}]}}]}',
      ]));

      await streamGemini("api-key", "gemini-pro", "s", "u", () => {});
      const url = mockFetch.mock.calls[0][0];
      expect(url).toContain(":streamGenerateContent");
      expect(url).toContain("alt=sse");
      expect(url).toContain("key=api-key");
    });

    it("throws on invalid API key (400)", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 400,
        text: () => Promise.resolve("API_KEY_INVALID"),
      });
      await expect(streamGemini("bad", "m", "s", "u", () => {})).rejects.toThrow("Invalid API key");
    });
  });
});
