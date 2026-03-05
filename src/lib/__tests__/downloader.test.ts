import { describe, it, expect, vi, beforeEach } from "vitest";
import { downloadClip, cancelDownload, ensureOutputDir } from "../downloader";

describe("downloadClip", () => {
  let mockInvoke: ReturnType<typeof vi.fn>;
  let mockListen: ReturnType<typeof vi.fn>;
  let mockUnlisten: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    const core = await import("@tauri-apps/api/core");
    const event = await import("@tauri-apps/api/event");
    mockInvoke = core.invoke as ReturnType<typeof vi.fn>;
    mockListen = event.listen as ReturnType<typeof vi.fn>;
    mockUnlisten = vi.fn();
    vi.clearAllMocks();
    mockInvoke.mockResolvedValue("/output/clip.mp4");
    mockListen.mockResolvedValue(mockUnlisten);
  });

  it("calls invoke with correct command and params", async () => {
    await downloadClip("clip-1", "https://youtube.com/watch?v=abc", 10, 20, "/out/clip.mp4");

    expect(mockInvoke).toHaveBeenCalledWith("download_clip", {
      clip_id: "clip-1",
      video_url: "https://youtube.com/watch?v=abc",
      start_time: 10,
      end_time: 20,
      output_path: "/out/clip.mp4",
    });
  });

  it("sets up event listener for download-progress events", async () => {
    const onProgress = vi.fn();
    await downloadClip("clip-1", "url", 0, 10, "/out", onProgress);

    expect(mockListen).toHaveBeenCalledWith("download-progress", expect.any(Function));
  });

  it("does not set up listener when onProgress is not provided", async () => {
    await downloadClip("clip-1", "url", 0, 10, "/out");
    expect(mockListen).not.toHaveBeenCalled();
  });

  it("filters progress events by clip_id", async () => {
    const onProgress = vi.fn();
    let capturedHandler: (event: { payload: { clip_id: string; line: string } }) => void;

    mockListen.mockImplementation((_eventName: string, handler: typeof capturedHandler) => {
      capturedHandler = handler;
      return Promise.resolve(mockUnlisten);
    });

    const promise = downloadClip("clip-1", "url", 0, 10, "/out", onProgress);

    capturedHandler!({ payload: { clip_id: "clip-1", line: "progress 50%" } });
    capturedHandler!({ payload: { clip_id: "clip-2", line: "other progress" } });
    capturedHandler!({ payload: { clip_id: "clip-1", line: "progress 100%" } });

    await promise;

    expect(onProgress).toHaveBeenCalledTimes(2);
    expect(onProgress).toHaveBeenCalledWith("progress 50%");
    expect(onProgress).toHaveBeenCalledWith("progress 100%");
  });

  it("cleans up listener on success", async () => {
    const onProgress = vi.fn();
    await downloadClip("clip-1", "url", 0, 10, "/out", onProgress);
    expect(mockUnlisten).toHaveBeenCalledTimes(1);
  });

  it("cleans up listener on error", async () => {
    const onProgress = vi.fn();
    mockInvoke.mockRejectedValue(new Error("download failed"));

    await expect(downloadClip("clip-1", "url", 0, 10, "/out", onProgress)).rejects.toThrow("download failed");
    expect(mockUnlisten).toHaveBeenCalledTimes(1);
  });

  it("returns the result from invoke", async () => {
    mockInvoke.mockResolvedValue("/path/to/downloaded.mp4");
    const result = await downloadClip("clip-1", "url", 0, 10, "/out");
    expect(result).toBe("/path/to/downloaded.mp4");
  });
});

describe("cancelDownload", () => {
  let mockInvoke: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    const core = await import("@tauri-apps/api/core");
    mockInvoke = core.invoke as ReturnType<typeof vi.fn>;
    vi.clearAllMocks();
    mockInvoke.mockResolvedValue(undefined);
  });

  it("calls invoke with cancel_download and clip_id", async () => {
    await cancelDownload("clip-42");
    expect(mockInvoke).toHaveBeenCalledWith("cancel_download", { clip_id: "clip-42" });
  });
});

describe("ensureOutputDir", () => {
  let mockInvoke: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    const core = await import("@tauri-apps/api/core");
    mockInvoke = core.invoke as ReturnType<typeof vi.fn>;
    vi.clearAllMocks();
    mockInvoke.mockResolvedValue("/resolved/path");
  });

  it("calls invoke with ensure_output_dir and path", async () => {
    await ensureOutputDir("/my/output/dir");
    expect(mockInvoke).toHaveBeenCalledWith("ensure_output_dir", { path: "/my/output/dir" });
  });

  it("returns the resolved path", async () => {
    mockInvoke.mockResolvedValue("/expanded/path");
    const result = await ensureOutputDir("~/output");
    expect(result).toBe("/expanded/path");
  });
});
