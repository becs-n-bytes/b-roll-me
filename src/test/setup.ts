import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

export const mockDb = {
  select: vi.fn().mockResolvedValue([]),
  execute: vi.fn().mockResolvedValue({ rowsAffected: 0 }),
  close: vi.fn(),
};

vi.mock("@tauri-apps/plugin-sql", () => ({
  default: { load: vi.fn().mockResolvedValue(mockDb) },
}));

vi.mock("@tauri-apps/plugin-http", () => ({
  fetch: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
  emit: vi.fn(),
}));

vi.mock("@tauri-apps/api/path", () => ({
  downloadDir: vi.fn().mockResolvedValue("/mock/Downloads/"),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  revealItemInDir: vi.fn(),
  open: vi.fn(),
}));
