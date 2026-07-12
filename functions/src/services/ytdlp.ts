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

function extractVideoId(url: string): string | null {
  const m = url.match(/(?:v=|youtu\.be\/)([\w-]{11})/);
  return m ? m[1] : null;
}

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";
const INNERTUBE_KEY = "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8";
const INNERTUBE_API = "https://www.youtube.com/youtubei/v1/player";

const CLIENTS = [
  { name: "ANDROID", version: "19.09.37", sdk: 30 },
  { name: "WEB", version: "2.20240101.00.00" },
  { name: "IOS", version: "19.09.37" },
];

async function fetchInnertube(videoId: string, clientIdx = 0): Promise<any> {
  if (clientIdx >= CLIENTS.length) throw new Error("All InnerTube clients failed");
  const client = CLIENTS[clientIdx];
  const body: any = {
    videoId,
    context: {
      client: {
        clientName: client.name,
        clientVersion: client.version,
        hl: "en",
        gl: "US",
      },
    },
  };
  if (client.sdk) body.context.client.androidSdkVersion = client.sdk;

  const res = await fetch(`${INNERTUBE_API}?key=${INNERTUBE_KEY}`, {
    method: "POST",
    body: JSON.stringify(body),
    headers: {
      "Content-Type": "application/json",
      "User-Agent": UA,
      "X-YouTube-Client-Name": client.name,
      "X-YouTube-Client-Version": client.version,
    },
  });
  const data = await res.json();
  if (data.error || data.playabilityStatus?.status === "UNPLAYABLE") {
    return fetchInnertube(videoId, clientIdx + 1);
  }
  if (!data.videoDetails) {
    throw new Error("InnerTube: no videoDetails - " + JSON.stringify(Object.keys(data)));
  }
  const vd = data.videoDetails;
  if (!vd.title) {
    throw new Error("InnerTube: no title - keys: " + JSON.stringify(Object.keys(vd)));
  }
  return data;
}

function parseInnertube(data: any): VideoInfo {
  const vd = data.videoDetails || {};
  const captions = data.captions?.playerCaptionsTracklistRenderer;
  const makeCaps = (tracks: any[]) =>
    tracks?.reduce((acc: any, t: any) => {
      acc[t.languageCode] = [{ ext: "vtt", url: t.baseUrl + "&fmt=vtt" }];
      return acc;
    }, {}) || {};

  return {
    title: vd.title || "",
    description: vd.shortDescription || "",
    duration: parseInt(vd.lengthSeconds || "0"),
    thumbnail: (vd.thumbnail?.thumbnails?.slice(-1)?.[0]?.url || "").replace(/^\/\//, "https://"),
    url: "https://youtu.be/" + vd.videoId,
    chapters: null,
    subtitles: makeCaps(captions?.captionTracks),
    automatic_captions: makeCaps(
      captions?.audioTracks
        ?.map((a: any) =>
          a.captionTrackIndices
            ?.map((i: number) => captions.captionTracks[i])
        )
        .flat()
        .filter(Boolean)
    ),
  };
}

export async function getVideoInfo(url: string): Promise<VideoInfo> {
  try {
    const data: any = await youtubedl(url, {
      dumpSingleJson: true,
      noDownload: true,
      extractorArgs: "youtube:player_client=android;skip=webpage",
      userAgent: UA,
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
  } catch {
    const videoId = extractVideoId(url);
    if (!videoId) throw new Error("Invalid YouTube URL");
    const player = await fetchInnertube(videoId);
    return parseInnertube(player);
  }
}

export async function getPlaylistVideos(url: string): Promise<{
  title: string;
  videos: VideoInfo[];
}> {
  const data: any = await youtubedl(url, {
    dumpSingleJson: true,
    noDownload: true,
    extractorArgs: "youtube:player_client=android;skip=webpage",
    userAgent: UA,
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
