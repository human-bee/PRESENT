import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

export const runtime = 'nodejs';

type YouTubeThumbnail = { url: string; width: number; height: number };

type YouTubeVideoItem = {
  id: string;
  title: string;
  description: string;
  channelTitle: string;
  channelId: string;
  publishedAt: string;
  duration: string;
  viewCount: string;
  likeCount: string;
  commentCount: string;
  thumbnail: YouTubeThumbnail;
};

const QuerySchema = z.object({
  id: z.string().optional(),
  ids: z.string().optional(),
});

function pickBestThumb(snippet: any): YouTubeThumbnail {
  const thumbs = snippet?.thumbnails || {};
  const best = thumbs.maxres || thumbs.high || thumbs.medium || thumbs.default;
  if (best?.url) {
    return {
      url: String(best.url),
      width: Number(best.width) || 0,
      height: Number(best.height) || 0,
    };
  }
  return { url: '', width: 0, height: 0 };
}

function mapVideo(item: any): YouTubeVideoItem {
  const snippet = item?.snippet || {};
  const stats = item?.statistics || {};
  const details = item?.contentDetails || {};
  return {
    id: String(item?.id || ''),
    title: String(snippet?.title || ''),
    description: String(snippet?.description || ''),
    channelTitle: String(snippet?.channelTitle || ''),
    channelId: String(snippet?.channelId || ''),
    publishedAt: String(snippet?.publishedAt || ''),
    duration: String(details?.duration || ''),
    viewCount: String(stats?.viewCount ?? '0'),
    likeCount: String(stats?.likeCount ?? '0'),
    commentCount: String(stats?.commentCount ?? '0'),
    thumbnail: pickBestThumb(snippet),
  };
}

async function fetchJson(url: string) {
  const res = await fetch(url, { method: 'GET' });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`YouTube API error: HTTP ${res.status} - ${text.slice(0, 200)}`);
  }
  try {
    return JSON.parse(text) as any;
  } catch {
    throw new Error(`YouTube API error: invalid json - ${text.slice(0, 200)}`);
  }
}

export async function GET(req: NextRequest) {
  const apiKey = process.env.YOUTUBE_API_KEY?.trim();
  if (!apiKey) {
    return NextResponse.json({ error: 'Missing YOUTUBE_API_KEY' }, { status: 503 });
  }

  const { searchParams } = new URL(req.url);
  const parsed = QuerySchema.safeParse({
    id: searchParams.get('id') ?? undefined,
    ids: searchParams.get('ids') ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json({ error: 'Bad request' }, { status: 400 });
  }

  const rawIds = parsed.data.ids ?? parsed.data.id ?? '';
  const ids = rawIds
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean)
    .slice(0, 50);

  if (ids.length === 0) {
    return NextResponse.json({ items: [] });
  }

  try {
    const url = new URL('https://www.googleapis.com/youtube/v3/videos');
    url.searchParams.set('part', 'snippet,contentDetails,statistics');
    url.searchParams.set('id', ids.join(','));
    url.searchParams.set('key', apiKey);
    const json = await fetchJson(url.toString());
    const items: any[] = Array.isArray(json?.items) ? json.items : [];
    return NextResponse.json({ items: items.map(mapVideo) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

