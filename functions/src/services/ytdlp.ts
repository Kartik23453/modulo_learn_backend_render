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

const MAX_PROXY_ATTEMPTS = 5;

async function getSomeProxies(): Promise<string[]> {
  try {
    const res = await fetch("https://api.proxyscrape.com/v2/?request=getproxies&protocol=http&timeout=3000&country=all&ssl=all&anonymity=all", {
      signal: AbortSignal.timeout(5000),
    });
    const text = await res.text();
    return text.trim().split("\r\n").filter(Boolean).slice(0, MAX_PROXY_ATTEMPTS).map((p) => "http://" + p);
  } catch {
    return [];
  }
}

function getYtdlpOpts(proxy?: string): any {
  const opts: any = {
    dumpSingleJson: true,
    noDownload: true,
    extractorArgs: "youtube:player_client=android;skip=webpage",
    userAgent: UA,
    socketTimeout: 3,
    retries: 0,
  };
  if (proxy) opts.proxy = proxy;
  return opts;
}

async function tryYtdlpWithProxies(url: string): Promise<any> {
  const envProxies = (process.env.YOUTUBE_PROXIES || "").split(",").filter(Boolean);
  const proxies = envProxies.length > 0 ? envProxies : await getSomeProxies();

  for (const proxy of [undefined, ...proxies]) {
    try {
      return await youtubedl(url, getYtdlpOpts(proxy) as any);
    } catch {
      continue;
    }
  }
  throw new Error("All yt-dlp attempts failed");
}

async function fetchOembed(videoId: string): Promise<{ title: string; thumbnail: string }> {
  const res = await fetch(
    `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`
  );
  const data = await res.json() as any;
  return { title: data.title || videoId, thumbnail: data.thumbnail_url || "" };
}

async function fetchInnertubeCaptions(videoId: string): Promise<VideoInfo["subtitles"]> {
  try {
    const body = {
      videoId,
      context: {
        client: { clientName: "ANDROID", clientVersion: "19.09.37", androidSdkVersion: 30, hl: "en", gl: "US" },
      },
    };
    const res = await fetch("https://www.youtube.com/youtubei/v1/player?key=AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json", "User-Agent": UA },
    });
    const data = await res.json();
    const captions = data.captions?.playerCaptionsTracklistRenderer;
    if (!captions?.captionTracks) return {};
    const caps: any = {};
    for (const t of captions.captionTracks) {
      caps[t.languageCode] = [{ ext: "vtt", url: t.baseUrl + "&fmt=vtt" }];
    }
    return caps;
  } catch {
    return {};
  }
}

export async function getVideoInfo(url: string): Promise<VideoInfo> {
  const videoId = extractVideoId(url);
  if (!videoId) throw new Error("Invalid YouTube URL");

  try {
    const data: any = await tryYtdlpWithProxies(url);

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
    const [oembed, caps] = await Promise.all([
      fetchOembed(videoId),
      fetchInnertubeCaptions(videoId),
    ]);
    return {
      title: oembed.title,
      description: "",
      duration: 0,
      thumbnail: oembed.thumbnail,
      url: "https://youtu.be/" + videoId,
      chapters: null,
      subtitles: caps,
      automatic_captions: {},
    };
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
