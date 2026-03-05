import { vi } from "vitest";
import type { TranscriptSegment } from "../types";

export function getMockDb() {
  const { mockDb } = require("./setup") as { mockDb: { select: ReturnType<typeof vi.fn>; execute: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> } };
  return mockDb;
}

export function resetMockDb() {
  const db = getMockDb();
  db.select.mockReset().mockResolvedValue([]);
  db.execute.mockReset().mockResolvedValue({ rowsAffected: 0 });
}

export function mockFetch(response: { ok: boolean; status?: number; json?: () => Promise<unknown>; text?: () => Promise<string> }) {
  const { fetch } = require("@tauri-apps/plugin-http") as { fetch: ReturnType<typeof vi.fn> };
  fetch.mockResolvedValue({
    ok: response.ok,
    status: response.status ?? (response.ok ? 200 : 500),
    json: response.json ?? (() => Promise.resolve({})),
    text: response.text ?? (() => Promise.resolve("")),
  });
  return fetch;
}

export const SAMPLE_SEGMENTS: TranscriptSegment[] = [
  { text: "Welcome to this video about machine learning", start: 0, duration: 3 },
  { text: "today we will discuss neural networks", start: 3, duration: 3 },
  { text: "and how they transform modern technology", start: 6, duration: 3 },
  { text: "first let us look at deep learning", start: 9, duration: 3 },
  { text: "which is a subset of machine learning", start: 12, duration: 3 },
  { text: "neural networks are inspired by the brain", start: 15, duration: 3 },
  { text: "they consist of layers of neurons", start: 18, duration: 3 },
  { text: "training involves adjusting weights", start: 21, duration: 3 },
  { text: "backpropagation is the key algorithm", start: 24, duration: 3 },
  { text: "thank you for watching this tutorial", start: 27, duration: 3 },
];
