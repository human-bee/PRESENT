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

const SearchQuerySchema = z.object({
  q: z.string().optional(),
  maxResults: z.coerce.number().int().min(1).max(25).default(10),
  order: z.enum(['relevance', 'date', 'viewCount', 'rating']).optional().default('relevance'),
  publishedAfter: z.string().optional(),
  videoDuration: z.enum(['short', 'medium', 'long']).optional(),
  regionCode: z.string().optional(),
  trending: z.coerce.boolean().optional(),
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

export async function GET(req: NextRequest) {
  const apiKey = process.env.YOUTUBE_API_KEY?.trim();
  if (!apiKey) {
    return NextResponse.json({ error: 'Missing YOUTUBE_API_KEY' }, { status: 503 });
  }

  const { searchParams } = new URL(req.url);
  const parsed = SearchQuerySchema.safeParse({
    q: searchParams.get('q') ?? undefined,
    maxResults: searchParams.get('maxResults') ?? undefined,
    order: searchParams.get('order') ?? undefined,
    publishedAfter: searchParams.get('publishedAfter') ?? undefined,
    videoDuration: searchParams.get('videoDuration') ?? undefined,
    regionCode: searchParams.get('regionCode') ?? undefined,
    trending: searchParams.get('trending') ?? undefined,
  });

  if (!parsed.success) {
    return NextResponse.json({ error: 'Bad request' }, { status: 400 });
  }

  const { q, maxResults, order, publishedAfter, videoDuration, regionCode } = parsed.data;
  const trendingRaw = searchParams.get('trending');
  const trending = trendingRaw === '1' || trendingRaw === 'true';

  try {
    if (trending) {
      const region = (regionCode || 'US').toUpperCase().slice(0, 2);
      const url = new URL('https://www.googleapis.com/youtube/v3/videos');
      url.searchParams.set('part', 'snippet,contentDetails,statistics');
      url.searchParams.set('chart', 'mostPopular');
      url.searchParams.set('maxResults', String(maxResults));
      url.searchParams.set('regionCode', region);
      url.searchParams.set('key', apiKey);

      const json = await fetchJson(url.toString());
      const items: any[] = Array.isArray(json?.items) ? json.items : [];
      return NextResponse.json({ items: items.map(mapVideo) });
    }

    const query = (q || '').trim();
    if (!query) {
      return NextResponse.json({ items: [] });
    }

    const searchUrl = new URL('https://www.googleapis.com/youtube/v3/search');
    searchUrl.searchParams.set('part', 'snippet');
    searchUrl.searchParams.set('type', 'video');
    searchUrl.searchParams.set('q', query);
    searchUrl.searchParams.set('maxResults', String(maxResults));
    searchUrl.searchParams.set('order', order);
    if (publishedAfter) searchUrl.searchParams.set('publishedAfter', publishedAfter);
    if (videoDuration) searchUrl.searchParams.set('videoDuration', videoDuration);
    if (regionCode) searchUrl.searchParams.set('regionCode', regionCode.toUpperCase().slice(0, 2));
    searchUrl.searchParams.set('key', apiKey);

    const searchJson = await fetchJson(searchUrl.toString());
    const searchItems: any[] = Array.isArray(searchJson?.items) ? searchJson.items : [];
    const ids = searchItems
      .map((it) => it?.id?.videoId)
      .filter((id) => typeof id === 'string' && id.trim().length > 0)
      .slice(0, 50);

    if (ids.length === 0) {
      return NextResponse.json({ items: [] });
    }

    const videosUrl = new URL('https://www.googleapis.com/youtube/v3/videos');
    videosUrl.searchParams.set('part', 'snippet,contentDetails,statistics');
    videosUrl.searchParams.set('id', ids.join(','));
    videosUrl.searchParams.set('key', apiKey);

    const videosJson = await fetchJson(videosUrl.toString());
    const videos: any[] = Array.isArray(videosJson?.items) ? videosJson.items : [];

    const byId = new Map<string, any>(videos.map((it) => [String(it?.id || ''), it]));
    const ordered = ids.map((id) => byId.get(id)).filter(Boolean);

    return NextResponse.json({ items: ordered.map(mapVideo) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

