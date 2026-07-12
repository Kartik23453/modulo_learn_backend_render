import youtubedl from "youtube-dl-exec";

interface ChapterData {
  start_time: number;
  end_time: number;
  title: string;
}

export interface VideoInfo {
  title: string;
  description: string;
  duration: number;
  thumbnail: string;
  url: string;
  chapters: { start_seconds: number; title: string }[] | null;
  subtitles: Record<string, { ext: string; url: string }[]>;
  automatic_captions: Record<string, { ext: string; url: string }[]>;
}

export async function getVideoInfo(url: string): Promise<VideoInfo> {
  const data: any = await youtubedl(url, {
    dumpSingleJson: true,
    noDownload: true,
    extractorArgs: "youtube:player_client=web;skip=webpage",
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  } as any);

  return {
    title: data.title,
    description: data.description || "",
    duration: data.duration || 0,
    thumbnail: data.thumbnail || "",
    url: data.webpage_url,
    chapters: data.chapters?.length
      ? data.chapters.map((ch: ChapterData) => ({
          start_seconds: Math.floor(ch.start_time),
          title: ch.title,
        }))
      : null,
    subtitles: data.subtitles || {},
    automatic_captions: data.automatic_captions || {},
  };
}

export async function getPlaylistVideos(url: string): Promise<{
  title: string;
  videos: VideoInfo[];
}> {
  const data: any = await youtubedl(url, {
    dumpSingleJson: true,
    noDownload: true,
    extractorArgs: "youtube:player_client=web;skip=webpage",
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  } as any);

  const videos: VideoInfo[] = data.entries.map((entry: any) => ({
    title: entry.title,
    description: entry.description || "",
    duration: entry.duration || 0,
    thumbnail: entry.thumbnail || "",
    url: entry.webpage_url,
    chapters: entry.chapters?.length
      ? entry.chapters.map((ch: ChapterData) => ({
          start_seconds: Math.floor(ch.start_time),
          title: ch.title,
        }))
      : null,
    subtitles: entry.subtitles || {},
    automatic_captions: entry.automatic_captions || {},
  }));

  return { title: data.title || "Untitled Playlist", videos };
}

export async function getTranscript(info: VideoInfo): Promise<string | null> {
  const subSource = info.subtitles?.en || info.automatic_captions?.en;
  if (!subSource?.length) return null;

  const vttSource = subSource.find((s) => s.ext === "vtt") || subSource[0];
  if (!vttSource?.url) return null;

  try {
    const response = await fetch(vttSource.url);
    const vtt = await response.text();
    return parseVtt(vtt);
  } catch {
    return null;
  }
}

function parseVtt(vtt: string): string {
  return vtt
    .replace(/WEBVTT.*?\n\n/, "")
    .replace(/\d{2}:\d{2}:\d{2}\.\d{3} --> \d{2}:\d{2}:\d{2}\.\d{3}.*/g, "")
    .replace(/<\/?[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/\n{3,}/g, "\n")
    .trim();
}

export function isPlaylistUrl(url: string): boolean {
  return /[?&]list=/i.test(url) || /youtube\.com\/playlist\?/i.test(url);
}
