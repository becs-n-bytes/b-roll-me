import { fetch } from "@tauri-apps/plugin-http";

interface YouTubeSearchItem {
  id: { videoId: string };
  snippet: {
    title: string;
    channelTitle: string;
    publishedAt: string;
    thumbnails: { medium?: { url: string } };
  };
}

interface YouTubeVideoItem {
  id: string;
  contentDetails: {
    duration: string;
    caption: string;
  };
}

function parseDuration(iso8601: string): number {
  const match = iso8601.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return 0;
  const hours = parseInt(match[1] ?? "0");
  const minutes = parseInt(match[2] ?? "0");
  const seconds = parseInt(match[3] ?? "0");
  return hours * 3600 + minutes * 60 + seconds;
}

export interface YouTubeResult {
  videoId: string;
  title: string;
  channelName: string;
  thumbnailUrl: string;
  duration: number;
  publishDate: string;
  captionsAvailable: boolean;
  sourceQuery: string;
}

export async function searchYouTube(
  query: string,
  apiKey: string,
  maxResults = 5
): Promise<YouTubeResult[]> {
  const key = apiKey.trim();
  if (!key) throw new Error("YouTube API key is not configured. Add it in Settings.");
  const searchUrl = new URL("https://www.googleapis.com/youtube/v3/search");
  searchUrl.searchParams.set("part", "snippet");
  searchUrl.searchParams.set("type", "video");
  searchUrl.searchParams.set("q", query);
  searchUrl.searchParams.set("maxResults", String(maxResults));
  searchUrl.searchParams.set("key", key);

  const searchResponse = await fetch(searchUrl.toString());

  if (searchResponse.status === 403) {
    const body = await searchResponse.text();
    if (body.includes("quotaExceeded")) {
      throw new Error("YouTube API quota exceeded. Try again tomorrow or use a different API key.");
    }
    throw new Error("YouTube API access denied. Check your API key permissions.");
  }
  if (searchResponse.status === 400) {
    throw new Error("Invalid YouTube API key. Check your key in Settings.");
  }
  if (!searchResponse.ok) {
    throw new Error(`YouTube API error (${searchResponse.status})`);
  }

  const searchData = (await searchResponse.json()) as { items: YouTubeSearchItem[] };
  if (!searchData.items?.length) return [];

  const videoIds = searchData.items.map((item) => item.id.videoId).join(",");

  const detailsUrl = new URL("https://www.googleapis.com/youtube/v3/videos");
  detailsUrl.searchParams.set("part", "contentDetails");
  detailsUrl.searchParams.set("id", videoIds);
  detailsUrl.searchParams.set("key", key);

  const detailsResponse = await fetch(detailsUrl.toString());
  const detailsData = detailsResponse.ok
    ? ((await detailsResponse.json()) as { items: YouTubeVideoItem[] })
    : { items: [] as YouTubeVideoItem[] };

  const detailsMap = new Map(detailsData.items.map((v) => [v.id, v]));

  return searchData.items.map((item) => {
    const details = detailsMap.get(item.id.videoId);
    return {
      videoId: item.id.videoId,
      title: item.snippet.title,
      channelName: item.snippet.channelTitle,
      thumbnailUrl: item.snippet.thumbnails.medium?.url ?? "",
      duration: details ? parseDuration(details.contentDetails.duration) : 0,
      publishDate: item.snippet.publishedAt,
      captionsAvailable: details?.contentDetails.caption === "true",
      sourceQuery: query,
    };
  });
}
