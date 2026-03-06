import { YTNodes, Utils } from "youtubei.js";
import { getInnertube } from "./innertube";

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
  maxResults = 5
): Promise<YouTubeResult[]> {
  try {
    const yt = await getInnertube();
    const results = await yt.search(query, { type: "video" });

    const videos = results.results
      .filterType(YTNodes.Video)
      .slice(0, maxResults);

    return videos.map((v) => ({
      videoId: v.video_id,
      title: v.title.toString(),
      channelName: v.author.name,
      thumbnailUrl: v.best_thumbnail?.url ?? "",
      duration: v.duration.seconds,
      publishDate: v.published?.toString() ?? "",
      captionsAvailable: v.has_captions,
      sourceQuery: query,
    }));
  } catch (err) {
    if (err instanceof Utils.InnertubeError) {
      throw new Error(`YouTube search failed: ${err.message}`);
    }
    throw err;
  }
}
