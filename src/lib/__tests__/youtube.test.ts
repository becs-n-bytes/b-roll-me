import { describe, it, expect, vi, beforeEach } from "vitest";
import { searchYouTube } from "../youtube";

describe("searchYouTube", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    const http = await import("@tauri-apps/plugin-http");
    mockFetch = http.fetch as ReturnType<typeof vi.fn>;
    vi.clearAllMocks();
  });

  const makeSearchResponse = (items: Array<{ videoId: string; title: string }>) => ({
    items: items.map((i) => ({
      id: { videoId: i.videoId },
      snippet: {
        title: i.title,
        channelTitle: "TestChannel",
        publishedAt: "2024-01-01T00:00:00Z",
        thumbnails: { medium: { url: `https://img.youtube.com/${i.videoId}` } },
      },
    })),
  });

  const makeDetailsResponse = (items: Array<{ id: string; duration: string; caption: string }>) => ({
    items: items.map((i) => ({
      id: i.id,
      contentDetails: { duration: i.duration, caption: i.caption },
    })),
  });

  it("constructs correct API URLs", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(makeSearchResponse([{ videoId: "v1", title: "Test" }])),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(makeDetailsResponse([{ id: "v1", duration: "PT5M", caption: "true" }])),
      });

    await searchYouTube("cats", "API_KEY", 3);

    const searchUrl = mockFetch.mock.calls[0][0] as string;
    expect(searchUrl).toContain("youtube/v3/search");
    expect(searchUrl).toContain("q=cats");
    expect(searchUrl).toContain("maxResults=3");
    expect(searchUrl).toContain("key=API_KEY");
    expect(searchUrl).toContain("part=snippet");
    expect(searchUrl).toContain("type=video");

    const detailsUrl = mockFetch.mock.calls[1][0] as string;
    expect(detailsUrl).toContain("youtube/v3/videos");
    expect(detailsUrl).toContain("part=contentDetails");
    expect(detailsUrl).toContain("id=v1");
    expect(detailsUrl).toContain("key=API_KEY");
  });

  it("parses search results and merges with video details", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve(
            makeSearchResponse([
              { videoId: "v1", title: "Video One" },
              { videoId: "v2", title: "Video Two" },
            ]),
          ),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve(
            makeDetailsResponse([
              { id: "v1", duration: "PT1H2M3S", caption: "true" },
              { id: "v2", duration: "PT30S", caption: "false" },
            ]),
          ),
      });

    const results = await searchYouTube("test", "key123");
    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({
      videoId: "v1",
      title: "Video One",
      channelName: "TestChannel",
      thumbnailUrl: "https://img.youtube.com/v1",
      duration: 3723,
      publishDate: "2024-01-01T00:00:00Z",
      captionsAvailable: true,
      sourceQuery: "test",
    });
    expect(results[1].duration).toBe(30);
    expect(results[1].captionsAvailable).toBe(false);
  });

  it("parseDuration: PT1H2M3S → 3723", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(makeSearchResponse([{ videoId: "v1", title: "T" }])),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(makeDetailsResponse([{ id: "v1", duration: "PT1H2M3S", caption: "false" }])),
      });

    const results = await searchYouTube("q", "k");
    expect(results[0].duration).toBe(3723);
  });

  it("parseDuration: PT5M → 300", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(makeSearchResponse([{ videoId: "v1", title: "T" }])),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(makeDetailsResponse([{ id: "v1", duration: "PT5M", caption: "false" }])),
      });

    const results = await searchYouTube("q", "k");
    expect(results[0].duration).toBe(300);
  });

  it("parseDuration: PT30S → 30", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(makeSearchResponse([{ videoId: "v1", title: "T" }])),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(makeDetailsResponse([{ id: "v1", duration: "PT30S", caption: "false" }])),
      });

    const results = await searchYouTube("q", "k");
    expect(results[0].duration).toBe(30);
  });

  it("parseDuration: returns 0 when details missing", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(makeSearchResponse([{ videoId: "v1", title: "T" }])),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ items: [] }),
      });

    const results = await searchYouTube("q", "k");
    expect(results[0].duration).toBe(0);
    expect(results[0].captionsAvailable).toBe(false);
  });

  it("handles 403 quota exceeded error", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      text: () => Promise.resolve("quotaExceeded something"),
    });

    await expect(searchYouTube("q", "k")).rejects.toThrow("quota exceeded");
  });

  it("handles 403 generic error", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      text: () => Promise.resolve("forbidden"),
    });

    await expect(searchYouTube("q", "k")).rejects.toThrow("access denied");
  });

  it("handles 400 invalid key error", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
    });

    await expect(searchYouTube("q", "k")).rejects.toThrow("Invalid YouTube API key");
  });

  it("handles other non-ok responses", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
    });

    await expect(searchYouTube("q", "k")).rejects.toThrow("YouTube API error (500)");
  });

  it("returns empty array when no items", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ items: [] }),
    });

    const results = await searchYouTube("q", "k");
    expect(results).toEqual([]);
  });

  it("returns empty array when items is undefined", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({}),
    });

    const results = await searchYouTube("q", "k");
    expect(results).toEqual([]);
  });

  it("maps captionsAvailable from details", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(makeSearchResponse([{ videoId: "v1", title: "T" }])),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(makeDetailsResponse([{ id: "v1", duration: "PT1M", caption: "true" }])),
      });

    const results = await searchYouTube("q", "k");
    expect(results[0].captionsAvailable).toBe(true);
  });

  it("handles thumbnail without medium", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            items: [
              {
                id: { videoId: "v1" },
                snippet: {
                  title: "T",
                  channelTitle: "C",
                  publishedAt: "2024-01-01T00:00:00Z",
                  thumbnails: {},
                },
              },
            ],
          }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ items: [] }),
      });

    const results = await searchYouTube("q", "k");
    expect(results[0].thumbnailUrl).toBe("");
  });

  it("handles details fetch failure gracefully", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(makeSearchResponse([{ videoId: "v1", title: "T" }])),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

    const results = await searchYouTube("q", "k");
    expect(results).toHaveLength(1);
    expect(results[0].duration).toBe(0);
    expect(results[0].captionsAvailable).toBe(false);
  });

  it("preserves sourceQuery in results", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(makeSearchResponse([{ videoId: "v1", title: "T" }])),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ items: [] }),
      });

    const results = await searchYouTube("my search query", "k");
    expect(results[0].sourceQuery).toBe("my search query");
  });
});
