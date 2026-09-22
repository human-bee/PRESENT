import { createHash } from 'node:crypto';
import type { Audience, AudienceComment } from '../../shared/audience';
import { RoomError } from '../room-store';
const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex').slice(0, 32);
type Page = {
  comments: AudienceComment[];
  cursor: string;
  nextMs: number;
  ended: boolean;
};
export async function readYouTubeChat(
  connection: NonNullable<Audience['connection']>,
  signal: AbortSignal,
): Promise<Page> {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key)
    throw new RoomError(
      'YouTube chat is not configured. Add YOUTUBE_API_KEY to the server environment, or invite the audience through this room’s link.',
      503,
    );
  const url = new URL('https://www.googleapis.com/youtube/v3/liveChat/messages');
  url.search = new URLSearchParams({
    key,
    liveChatId: connection.liveChatId,
    part: 'id,snippet,authorDetails',
    maxResults: '200',
    ...(connection.cursor ? { pageToken: connection.cursor } : {}),
  }).toString();
  const response = await fetch(url, { signal });
  if (!response.ok)
    throw new RoomError(
      response.status === 403
        ? 'YouTube denied chat access or quota. Review the connected account.'
        : 'YouTube chat is unavailable or has ended.',
      502,
    );
  const raw = await response.json();
  const comments: AudienceComment[] = [];
  for (const item of raw.items ?? []) {
    if (
      item.snippet?.type !== 'textMessageEvent' ||
      typeof item.id !== 'string' ||
      typeof item.snippet?.displayMessage !== 'string'
    )
      continue;
    comments.push({
      id: `yt-${hash(item.id)}`,
      sourceId: item.id.slice(0, 120),
      source: 'youtube',
      sourceUrl: connection.sourceUrl,
      authorId: `youtube:${String(item.authorDetails?.channelId ?? 'unknown').slice(0, 90)}`,
      authorName: String(item.authorDetails?.displayName ?? 'YouTube viewer').slice(0, 100),
      text: item.snippet.displayMessage.slice(0, 1500),
      at: Number.isFinite(Date.parse(item.snippet.publishedAt)) ? Date.parse(item.snippet.publishedAt) : Date.now(),
      receivedAt: Date.now(),
      category: item.snippet.displayMessage.includes('?') ? 'question' : 'topic',
      status: 'pending',
      votes: [],
      moderatedBy: null,
      moderationReason: '',
    });
  }
  return {
    comments,
    cursor: String(raw.nextPageToken ?? '').slice(0, 4000),
    nextMs: Math.max(5000, Math.min(60000, Number(raw.pollingIntervalMillis) || 10000)),
    ended: Boolean(raw.offlineAt),
  };
}
