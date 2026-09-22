import { cachedWebImage, searchGeneralImages, imageDimensions } from './general-images';
import { publicFetch } from './public-fetch';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { providerRequestSchema } from '../../shared/evidence';
import { makeObject } from '../../shared/room';
import { applyOperation, getCanvasRecords } from '../room-store';
import { requireCanvasPage } from '../tldraw-operations';
import { AgentError } from './contract';

const MAX_BYTES = 12 * 1024 * 1024;
const headers = { 'User-Agent': 'PRESENT/0.1 (https://github.com/human-bee/PRESENT; image reference import)' };
const text = (value: string = '') => value.replace(/<[^>]*>/g, '').replace(/&quot;/g, '"').replace(/&amp;/g, '&').slice(0, 1000);
const infoSchema = z.object({ url: z.string(), descriptionurl: z.string(), width: z.number().positive(), height: z.number().positive(), mime: z.string(), thumburl: z.string().optional(), thumbwidth: z.number().optional(), thumbheight: z.number().optional(), thumbmime: z.string().optional(), extmetadata: z.record(z.string(), z.object({ value: z.coerce.string() })).optional() });
const pageSchema = z.object({ pageid: z.number().int().positive(), title: z.string(), index: z.number().optional(), imageinfo: z.array(infoSchema).optional() });
export type WebImage = { id: number; title: string; url: string; source: string; width: number; height: number; mime: string; author: string; license: string; description: string };
export function allowedImageUrl(raw: string): boolean {
  try { const url = new URL(raw); return url.protocol === 'https:' && ['upload.wikimedia.org', 'thumb.wikimedia.org'].includes(url.hostname) && !url.port && !url.username && !url.password && url.pathname.startsWith('/wikipedia/commons/'); } catch { return false; }
}
async function query(parameters: Record<string, string>, signal?: AbortSignal): Promise<WebImage[]> {
  const url = new URL('https://commons.wikimedia.org/w/api.php');
  url.search = new URLSearchParams({ action: 'query', format: 'json', formatversion: '2', prop: 'imageinfo', iiprop: 'url|size|mime|extmetadata|thumbmime', iiurlwidth: '1280', ...parameters }).toString();
  const response = await fetch(url, { headers, redirect: 'error', signal });
  if (!response.ok) throw new AgentError('Image search is unavailable. Try again shortly.');
  const body = await response.json();
  if (body.error) throw new AgentError('Image search could not complete.');
  const pages = z.array(pageSchema).parse(body.query?.pages ?? []).sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  return pages.flatMap(page => {
    const info = page.imageinfo?.[0]; if (!info) return [];
    const url = info.thumburl ?? info.url, mime = info.thumbmime ?? info.mime;
    if (!allowedImageUrl(url) || !['image/jpeg', 'image/png', 'image/webp'].includes(mime)) return [];
    const source = new URL(info.descriptionurl);
    if (source.protocol !== 'https:' || source.hostname !== 'commons.wikimedia.org') return [];
    const metadata = info.extmetadata ?? {};
    return [{ id: page.pageid, title: text(page.title.replace(/^File:/, '')), url, source: source.href, mime,
      width: info.thumbwidth ?? info.width, height: info.thumbheight ?? info.height,
      author: text(metadata.Artist?.value), license: text(metadata.LicenseShortName?.value), description: text(metadata.ImageDescription?.value) }];
  });
}
export async function searchWebImages(search: string, signal?: AbortSignal) {
  const prompt = z.string().trim().min(1).max(300).parse(search);
  const general = await searchGeneralImages(prompt, signal).catch(() => []);
  if (general.length) return general;
  return query({ generator: 'search', gsrsearch: prompt, gsrnamespace: '6', gsrlimit: '6' }, signal ? AbortSignal.any([signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000));
}
export async function importWebImage(raw: unknown, imageId: number, signal?: AbortSignal) {
  const input = providerRequestSchema.parse(raw);
  const id = z.number().int().positive().parse(imageId);
  if (input.pageId) requireCanvasPage(getCanvasRecords(input.roomId), input.pageId);
  const combined = signal ? AbortSignal.any([signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000);
  const image = cachedWebImage(id) ?? (id < 1000000000000 ? (await query({ pageids: String(id) }, combined))[0] : undefined);
  if (!image || image.id !== id) throw new AgentError('That search result no longer has an importable image.');
  const { bytes } = await publicFetch(image.url, MAX_BYTES, combined);
  Object.assign(image, imageDimensions(bytes));
  const extension = image.mime === 'image/png' && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ? 'png' : image.mime === 'image/jpeg' && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 ? 'jpg' : image.mime === 'image/webp' && bytes.toString('ascii',0,4) === 'RIFF' && bytes.toString('ascii',8,12) === 'WEBP' ? 'webp' : null;
  if (!extension) throw new AgentError('The source did not return a supported image.');
  combined.throwIfAborted();
  const directory = join(process.cwd(), '.data', 'assets'); mkdirSync(directory, { recursive: true, mode: 0o700 });
  const name = `${createHash('sha256').update(bytes).digest('hex')}.${extension}`, file = join(directory, name);
  if (!existsSync(file)) {
    const files = readdirSync(directory);
    if (files.length >= 1000 || files.reduce((n, f) => n + lstatSync(join(directory, f)).size, 0) + bytes.length > 512 * 1024 * 1024) throw new AgentError('Local image storage is full.');
    writeFileSync(file, bytes, { flag: 'wx', mode: 0o600 });
  } else if (!lstatSync(file).isFile()) throw new AgentError('The image could not be stored.');
  const src = `/api/assets/${name}`;
  const object = makeObject('image', 'agent:web-images', input.position, { src, mimeType: image.mime, imageWidth: image.width, imageHeight: image.height,
    provenance: { kind: 'web-image', sourceUrl: image.source, originalUrl: image.url, author: image.author, license: image.license, retrievedAt: Date.now(), requestId: input.requestId } });
  object.title = image.title.slice(0, 100); const scale = 512 / Math.max(image.width, image.height); object.w = Math.max(80, Math.round(image.width * scale)); object.h = Math.max(60, Math.round(image.height * scale));
  const requestId = `web-image:${createHash('sha256').update(input.requestId).digest('hex')}`;
  const room = applyOperation(input.roomId, { type: 'put', object, ...(input.pageId ? { pageId: input.pageId } : {}) }, 'agent:web-images', { requestId });
  const saved = room.objects.find(o => o.kind === 'image' && (o.data.provenance as Record<string, unknown>)?.requestId === input.requestId);
  return { objectId: saved?.id ?? object.id, src, source: image.source, title: image.title, author: image.author, license: image.license, imported: true };
}
