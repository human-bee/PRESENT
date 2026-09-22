import { randomInt } from 'node:crypto';
import { imageSize } from 'image-size';
import { publicFetch } from './public-fetch';
import { searchWeb } from './web-search';
import type { WebImage } from './web-images';
const candidates = new Map<number, { image: WebImage; expires: number }>();
export function cachedWebImage(id: number) {
  const item = candidates.get(id);
  return item && item.expires > Date.now() ? item.image : undefined;
}
export function imageDimensions(bytes: Uint8Array) {
  const dimensions = imageSize(bytes);
  if (!['jpg','png','webp'].includes(dimensions.type ?? '') || !dimensions.width || !dimensions.height || dimensions.width * dimensions.height > 40000000) throw new Error('Unsupported image dimensions.');
  return { width: dimensions.width, height: dimensions.height, mime: dimensions.type === 'jpg' ? 'image/jpeg' : `image/${dimensions.type}` };
}
export async function searchGeneralImages(query: string, signal?: AbortSignal): Promise<WebImage[]> {
  const result = await searchWeb(`Find photographs or reference images of: ${query}. Cite specific source pages containing relevant images.`, false, signal);
  const sources = result.sources.slice(0, 6);
  const found = await Promise.all(sources.map(async source => {
    try {
      const page = await publicFetch(source.url, 2000000, signal);
      let imageUrl = page.mime.startsWith('image/') ? page.url : '';
      if (!imageUrl && page.mime === 'text/html') {
        for (const tag of page.bytes.toString('utf8').match(/<meta\b[^>]*>/gi) ?? []) {
          const attrs = Object.fromEntries([...tag.matchAll(/([\w:-]+)\s*=\s*["']([^"']*)["']/g)].map(m => [m[1].toLowerCase(), m[2]]));
          if (['og:image','twitter:image','og:image:url'].includes(attrs.property ?? attrs.name)) { imageUrl = new URL(attrs.content.replaceAll('&amp;', '&'), page.url).href; break; }
        }
      }
      if (!imageUrl) return null;
      const fetched = imageUrl === page.url ? page : await publicFetch(imageUrl, 12 * 1024 * 1024, signal);
      const dimensions = imageDimensions(fetched.bytes);
      const id = randomInt(1000000000000, 2000000000000);
      const image: WebImage = { id, title: source.title, url: fetched.url, source: page.url, ...dimensions, author: '', license: 'Not supplied by source', description: `Image published on ${source.title}. Page preview; verify visual relevance before claiming an exact match.` };
      candidates.set(id, { image, expires: Date.now() + 1800000 });
      while (candidates.size > 256) {
        const oldest = candidates.keys().next().value;
        if (oldest === undefined) break;
        candidates.delete(oldest);
      }
      return image;
    } catch { return null; }
  }));
  return found.filter((image): image is WebImage => image !== null);
}
