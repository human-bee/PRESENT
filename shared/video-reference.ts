import { makeObject, type RoomObject } from './room';

export type VideoReference = { videoId: string; startSeconds: number };
export const MAX_VIDEO_START_SECONDS = 7 * 24 * 60 * 60;
const videoIdPattern = /^[A-Za-z0-9_-]{11}$/;
const objectIdPattern = /^[A-Za-z0-9_-][A-Za-z0-9_.:-]{0,99}$/;
const youtubeHosts = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com']);
const shortHosts = new Set(['youtu.be', 'www.youtu.be']);

function parseTime(value: string): number | null {
  let seconds: number;
  if (/^\d+$/.test(value)) seconds = Number(value);
  else {
    const match = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(value);
    if (!match?.slice(1).some(Boolean)) return null;
    seconds = Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0);
  }
  return Number.isSafeInteger(seconds) && seconds >= 0 && seconds <= MAX_VIDEO_START_SECONDS ? seconds : null;
}

/** Only IDs and a bounded timestamp survive URL parsing. Query tracking data is discarded. */
export function parseVideoURL(input: unknown): VideoReference | null {
  if (typeof input !== 'string' || input.length > 2048 || input.includes('\\') || [...input].some(character => character.charCodeAt(0) < 32)) return null;
  try {
    const text = input.trim();
    const url = new URL(/^(?:www\.|m\.)?(?:youtube\.com|youtu\.be)\//i.test(text) ? `https://${text}` : text);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port) return null;
    let videoId: string | undefined;
    if (shortHosts.has(url.hostname)) videoId = /^\/([A-Za-z0-9_-]{11})\/?$/.exec(url.pathname)?.[1];
    else if (youtubeHosts.has(url.hostname)) {
      if (url.pathname === '/watch' && url.searchParams.getAll('v').length === 1) videoId = url.searchParams.get('v') ?? undefined;
      else videoId = /^\/(?:shorts|embed)\/([A-Za-z0-9_-]{11})\/?$/.exec(url.pathname)?.[1];
    }
    if (!videoId || !videoIdPattern.test(videoId)) return null;
    const supplied = ['t', 'start'].flatMap(key => url.searchParams.getAll(key));
    const fragment = new URLSearchParams(url.hash.slice(1));
    supplied.push(...fragment.getAll('t'));
    const times = supplied.map(parseTime);
    if (times.some(time => time === null) || new Set(times).size > 1) return null;
    return { videoId, startSeconds: times[0] ?? 0 };
  } catch { return null; }
}

export function readVideoReference(data: unknown): VideoReference | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const value = data as Record<string, unknown>;
  const startSeconds = value.startSeconds === undefined ? 0 : value.startSeconds;
  if (value.capability !== 'youtube' || typeof value.videoId !== 'string' || !videoIdPattern.test(value.videoId)
    || typeof startSeconds !== 'number' || !Number.isSafeInteger(startSeconds) || startSeconds < 0 || startSeconds > MAX_VIDEO_START_SECONDS) return null;
  return { videoId: value.videoId, startSeconds };
}

export function youtubeEmbedURL(reference: VideoReference): string | null {
  const valid = readVideoReference({ capability: 'youtube', ...reference });
  if (!valid) return null;
  const url = new URL(`https://www.youtube-nocookie.com/embed/${valid.videoId}`);
  url.searchParams.set('autoplay', '0');
  url.searchParams.set('controls', '1');
  url.searchParams.set('playsinline', '1');
  if (valid.startSeconds) url.searchParams.set('start', String(valid.startSeconds));
  return url.href;
}

export function videoWrapperPath(roomId: string, objectId: string): string | null {
  return /^[a-f0-9]{24,64}$/.test(roomId) && objectIdPattern.test(objectId)
    ? `/embed/${roomId}/${encodeURIComponent(objectId)}` : null;
}

export function makeVideoObject(url: string, actor: string, position: { x: number; y: number }): RoomObject {
  const reference = parseVideoURL(url);
  if (!reference) throw new Error('Use a valid YouTube video link with an optional start timestamp.');
  return { ...makeObject('widget', actor, position, { capability: 'youtube', ...reference }), title: 'YouTube video', w: 560, h: 350 };
}
