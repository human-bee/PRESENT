import type { Activity } from '../../shared/activity';
import { AgentError } from '../agents/contract';
export async function searchImages(query: string, signal: AbortSignal): Promise<Activity['visuals'][number]['images']> {
  const url = new URL('https://commons.wikimedia.org/w/api.php');
  url.search = new URLSearchParams({
    action: 'query',
    generator: 'search',
    gsrsearch: query,
    gsrnamespace: '6',
    gsrlimit: '5',
    prop: 'imageinfo',
    iiprop: 'url|extmetadata',
    iiurlwidth: '800',
    format: 'json',
    origin: '*',
  }).toString();
  const response = await fetch(url, {
    signal,
    headers: {
      'User-Agent': 'PRESENT-RoomOS/0.1 (local collaborative research)',
    },
  });
  if (!response.ok) throw new AgentError('Image search is unavailable. Try a more specific subject.', 502);
  const raw = await response.json();
  const plain = (value: unknown, limit: number) =>
    String(value ?? '')
      .replace(/<[^>]*>/g, '')
      .slice(0, limit);
  const images: Activity['visuals'][number]['images'] = [];
  for (const page of Object.values(raw.query?.pages ?? {}) as {
    title: string;
    imageinfo?: {
      thumburl?: string;
      url?: string;
      descriptionurl?: string;
      extmetadata?: Record<string, { value?: string }>;
    }[];
  }[]) {
    const info = page.imageinfo?.[0];
    if (!info) continue;
    const src = info.thumburl ?? info.url,
      source = info.descriptionurl;
    if (
      !src ||
      !source ||
      !(src.startsWith('https://upload.wikimedia.org/') || src.startsWith('https://thumb.wikimedia.org/')) ||
      !source.startsWith('https://commons.wikimedia.org/')
    )
      continue;
    if (/\.(pdf|webm|ogg|tif)(?:$|\/)/i.test(info.url ?? '')) continue;
    images.push({
      title: plain(page.title.replace(/^File:/, ''), 200),
      url: src,
      sourceUrl: source,
      attribution: plain(info.extmetadata?.Artist?.value, 600),
      license: plain(info.extmetadata?.LicenseShortName?.value ?? 'See source for license', 100),
    });
    if (images.length === 2) break;
  }
  if (!images.length) throw new AgentError('No usable sourced images found. Try a more specific subject.', 404);
  return images;
}
