import { describe, it, expect, vi, beforeEach } from "vitest";
import { searchYouTube } from "../youtube";

vi.mock("../innertube");

const { getInnertube } = await import("../innertube");
const mockGetInnertube = vi.mocked(getInnertube);

function makeVideo(overrides: Record<string, unknown> = {}) {
  return {
    video_id: "vid-1",
    title: { toString: () => "Test Video" },
    author: { name: "Test Channel" },
    best_thumbnail: { url: "https://i.ytimg.com/thumb.jpg" },
    duration: { seconds: 120 },
    published: { toString: () => "2 weeks ago" },
    has_captions: true,
    type: "Video",
    ...overrides,
  };
}

function makeMockInnertube(videos: ReturnType<typeof makeVideo>[]) {
  return {
    search: vi.fn().mockResolvedValue({
      results: {
        filterType: vi.fn().mockReturnValue(videos),
      },
    }),
  };
}

describe("searchYouTube", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("maps InnerTube Video nodes to YouTubeResult", async () => {
    const yt = makeMockInnertube([makeVideo()]);
    mockGetInnertube.mockResolvedValue(yt as never);

    const results = await searchYouTube("cats");

    expect(results).toEqual([{
      videoId: "vid-1",
      title: "Test Video",
      channelName: "Test Channel",
      thumbnailUrl: "https://i.ytimg.com/thumb.jpg",
      duration: 120,
      publishDate: "2 weeks ago",
      captionsAvailable: true,
      sourceQuery: "cats",
    }]);
  });

  it("passes query and type to yt.search", async () => {
    const yt = makeMockInnertube([]);
    mockGetInnertube.mockResolvedValue(yt as never);

    await searchYouTube("drone footage");

    expect(yt.search).toHaveBeenCalledWith("drone footage", { type: "video" });
  });

  it("slices results to maxResults", async () => {
    const videos = Array.from({ length: 10 }, (_, i) =>
      makeVideo({ video_id: `v-${i}` })
    );
    const yt = makeMockInnertube(videos);
    mockGetInnertube.mockResolvedValue(yt as never);

    const results = await searchYouTube("test", 3);

    expect(results).toHaveLength(3);
    expect(results[0].videoId).toBe("v-0");
    expect(results[2].videoId).toBe("v-2");
  });

  it("uses default maxResults of 5", async () => {
    const videos = Array.from({ length: 8 }, (_, i) =>
      makeVideo({ video_id: `v-${i}` })
    );
    const yt = makeMockInnertube(videos);
    mockGetInnertube.mockResolvedValue(yt as never);

    const results = await searchYouTube("test");

    expect(results).toHaveLength(5);
  });

  it("returns empty array when no results", async () => {
    const yt = makeMockInnertube([]);
    mockGetInnertube.mockResolvedValue(yt as never);

    const results = await searchYouTube("nonexistent");

    expect(results).toEqual([]);
  });

  it("handles missing best_thumbnail", async () => {
    const yt = makeMockInnertube([makeVideo({ best_thumbnail: null })]);
    mockGetInnertube.mockResolvedValue(yt as never);

    const results = await searchYouTube("test");

    expect(results[0].thumbnailUrl).toBe("");
  });

  it("handles missing published date", async () => {
    const yt = makeMockInnertube([makeVideo({ published: null })]);
    mockGetInnertube.mockResolvedValue(yt as never);

    const results = await searchYouTube("test");

    expect(results[0].publishDate).toBe("");
  });

  it("preserves sourceQuery in results", async () => {
    const yt = makeMockInnertube([makeVideo()]);
    mockGetInnertube.mockResolvedValue(yt as never);

    const results = await searchYouTube("my search query");

    expect(results[0].sourceQuery).toBe("my search query");
  });

  it("maps has_captions false correctly", async () => {
    const yt = makeMockInnertube([makeVideo({ has_captions: false })]);
    mockGetInnertube.mockResolvedValue(yt as never);

    const results = await searchYouTube("test");

    expect(results[0].captionsAvailable).toBe(false);
  });

  it("rethrows non-InnertubeError errors", async () => {
    const yt = {
      search: vi.fn().mockRejectedValue(new Error("Network down")),
    };
    mockGetInnertube.mockResolvedValue(yt as never);

    await expect(searchYouTube("test")).rejects.toThrow("Network down");
  });

  it("maps multiple videos correctly", async () => {
    const videos = [
      makeVideo({ video_id: "a", has_captions: true }),
      makeVideo({ video_id: "b", has_captions: false }),
    ];
    const yt = makeMockInnertube(videos);
    mockGetInnertube.mockResolvedValue(yt as never);

    const results = await searchYouTube("test");

    expect(results).toHaveLength(2);
    expect(results[0].videoId).toBe("a");
    expect(results[0].captionsAvailable).toBe(true);
    expect(results[1].videoId).toBe("b");
    expect(results[1].captionsAvailable).toBe(false);
  });
});
