import { createHash, randomUUID } from 'node:crypto';
import { closeSync, constants, existsSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import { providerRequestSchema } from '../../shared/evidence';
import { makeObject } from '../../shared/room';
import { applyOperation, getCanvasRecords, getRoom } from '../room-store';
import { requireCanvasPage } from '../tldraw-operations';
import { AgentError } from './contract';

export const IMAGE_MODEL = 'gpt-image-2';
const MAX_BYTES = 25 * 1024 * 1024;
const imageResponseSchema = z.object({ data: z.array(z.object({ b64_json: z.string().min(1).max(Math.ceil(MAX_BYTES / 3) * 4) })).length(1) });
type ImageResult = { objectId: string; src: string; model: string; width: number; height: number; generatedAt: number; elapsedMs: number };
type Dependencies = { getRoom: typeof getRoom; getCanvasRecords: typeof getCanvasRecords; applyOperation: typeof applyOperation; fetch: typeof fetch; apiKey: () => string | undefined; now: () => number; assetDirectory: string; mediaDirectory: string };
type ReferenceImage = { objectId: string; src: string; sha256: string; name: string; mimeType: string; bytes: Buffer };
const defaults: Dependencies = { getRoom, getCanvasRecords, applyOperation, fetch: (...args) => fetch(...args), apiKey: () => process.env.OPENAI_API_KEY, now: Date.now, assetDirectory: join(process.cwd(), '.data', 'assets'), mediaDirectory: join(process.cwd(), 'public', 'media') };

function loadReference(objectId: string, room: ReturnType<typeof getRoom>, dependencies: Dependencies): ReferenceImage {
  const object = room.objects.find(value => value.id === objectId);
  if (object?.kind !== 'image' || typeof object.data.src !== 'string') throw new AgentError('Each image reference must be an existing native image in this room.', 400);
  const src = object.data.src;
  const asset = /^\/api\/assets\/([a-f0-9]{64}\.(png|jpg|webp))$/.exec(src);
  const media = /^\/media\/([a-zA-Z0-9][a-zA-Z0-9._-]{0,119}\.(png|jpe?g|webp))$/.exec(src);
  const match = asset ?? media;
  if (!match) throw new AgentError('Image references must be local PNG, JPEG or WebP assets.', 400);
  const name = match[1], extension = match[2];
  const directory = asset ? dependencies.assetDirectory : dependencies.mediaDirectory;
  let descriptor: number | undefined;
  try {
    if (!lstatSync(directory).isDirectory() || realpathSync(directory) !== resolve(directory)) throw new Error('Unsafe asset directory');
    descriptor = openSync(join(directory, name), constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = fstatSync(descriptor);
    if (!stat.isFile() || stat.size < 12 || stat.size > MAX_BYTES) throw new Error('Invalid image size');
    const bytes = readFileSync(descriptor);
    const valid = extension === 'png' ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) : extension === 'webp' ? bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP' : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
    if (!valid || bytes.length > MAX_BYTES) throw new Error('Invalid image bytes');
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    if (asset && name.split('.')[0] !== sha256) throw new Error('Asset content changed');
    return { objectId, src, sha256, name, mimeType: extension === 'png' ? 'image/png' : extension === 'webp' ? 'image/webp' : 'image/jpeg', bytes };
  } catch { throw new AgentError('A reference image is unavailable or is not a safe local image file.', 400); }
  finally { if (descriptor !== undefined) closeSync(descriptor); }
}

function imageRequest(prompt: string, references: ReferenceImage[], apiKey: string, signal: AbortSignal): [string, RequestInit] {
  const options = { model: IMAGE_MODEL, prompt, n: '1', size: '1024x1024', quality: 'low', output_format: 'png' };
  const headers = { Authorization: `Bearer ${apiKey}` };
  if (!references.length) return ['https://api.openai.com/v1/images/generations', { method: 'POST', signal, headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ ...options, n: 1 }) }];
  const body = new FormData();
  for (const [key, value] of Object.entries(options)) body.set(key, value);
  for (const reference of references) body.append('image[]', new Blob([new Uint8Array(reference.bytes)], { type: reference.mimeType }), reference.name);
  return ['https://api.openai.com/v1/images/edits', { method: 'POST', signal, headers, body }];
}

export function decodeGeneratedPng(encoded: string): { bytes: Buffer; width: number; height: number } {
  if (encoded.length > Math.ceil(MAX_BYTES / 3) * 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw new AgentError('The image provider returned an invalid PNG.');
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.length < 24 || bytes.length > MAX_BYTES || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) || bytes.toString('ascii', 12, 16) !== 'IHDR') throw new AgentError('The image provider returned an invalid PNG.');
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
  if (!width || !height || width > 4096 || height > 4096) throw new AgentError('The generated image dimensions are invalid.');
  return { bytes, width, height };
}
function storePng(bytes: Buffer, directory: string): string {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const name = `${createHash('sha256').update(bytes).digest('hex')}.png`; const file = join(directory, name);
  if (existsSync(file)) {
    if (!lstatSync(file).isFile()) throw new AgentError('The generated image could not be stored.');
    return `/api/assets/${name}`;
  }
  const files = readdirSync(directory).filter(entry => /^[a-f0-9]{64}\.(png|jpg|gif|webp|avif|mp4|webm|mov)$/.test(entry));
  if (files.length >= 1000 || files.reduce((total, entry) => total + lstatSync(join(directory, entry)).size, 0) + bytes.length > 512 * 1024 * 1024) throw new AgentError('Local asset storage is full.', 507);
  const temporary = `${file}.${randomUUID()}.tmp`;
  writeFileSync(temporary, bytes, { mode: 0o600, flag: 'wx' }); renameSync(temporary, file);
  return `/api/assets/${name}`;
}

export function createGenerateRoomImage(overrides: Partial<Dependencies> = {}) {
  const dependencies = { ...defaults, ...overrides };
  const requests = new Map<string, { digest: string; result: Promise<ImageResult> }>(); let active = 0;
  return async (raw: unknown, signal?: AbortSignal): Promise<ImageResult> => {
    const parsed = providerRequestSchema.safeParse(raw);
    if (!parsed.success) throw new AgentError('Image generation needs a room, prompt, actor and unique request ID.', 400);
    const input = parsed.data; const key = `${input.roomId}:${input.requestId}`;
    const digest = createHash('sha256').update(JSON.stringify(input)).digest('hex');
    const previous = requests.get(key);
    if (previous) {
      if (previous.digest !== digest) throw new AgentError('This request ID already belongs to another image.', 409);
      const result = await previous.result;
      if (!dependencies.getRoom(input.roomId).objects.some(object => object.id === result.objectId)) throw new AgentError('That image was removed. Use a new request ID to recreate it.', 409);
      return result;
    }
    const room = dependencies.getRoom(input.roomId);
    const existing = room.objects.find(object => {
      const provenance = object.data.provenance;
      return object.kind === 'image' && provenance && typeof provenance === 'object' && 'requestId' in provenance && provenance.requestId === input.requestId;
    });
    if (existing) {
      const provenance = existing.data.provenance as Record<string, unknown>;
      if (provenance.requestDigest !== digest) throw new AgentError('This request ID already belongs to another image.', 409);
      return { objectId: existing.id, src: String(existing.data.src), model: String(provenance.model), width: Number(existing.data.imageWidth), height: Number(existing.data.imageHeight), generatedAt: Number(provenance.generatedAt), elapsedMs: Number(provenance.elapsedMs) };
    }
    if (new Set(input.selection).size !== input.selection.length) throw new AgentError('Choose each image reference only once.', 400);
    if (input.pageId) requireCanvasPage(dependencies.getCanvasRecords(input.roomId), input.pageId);
    const references = input.selection.map(objectId => loadReference(objectId, room, dependencies));
    if (references.reduce((total, reference) => total + reference.bytes.length, 0) > 50 * 1024 * 1024) throw new AgentError('Reference images must total no more than 50 MB.', 400);
    const apiKey = dependencies.apiKey(); if (!apiKey) throw new AgentError('Image generation is not configured on this server.', 503);
    if (active >= 2 || requests.size >= 500) throw new AgentError('Image generation is busy. Try again shortly.', 429);
    const timeout = AbortSignal.timeout(120000); const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    if (combined.aborted) throw new AgentError('Image generation was cancelled. Your room is unchanged.', 499);
    active++;
    const result = (async () => {
      const started = dependencies.now();
      try {
        const response = await dependencies.fetch(...imageRequest(input.prompt, references, apiKey, combined));
        if (!response.ok) throw new AgentError(response.status === 429 ? 'Image generation is busy. Try again shortly.' : 'The image provider could not complete this request.', response.status === 429 ? 429 : 502);
        const output = imageResponseSchema.parse(await response.json());
        const { bytes, width, height } = decodeGeneratedPng(output.data[0].b64_json);
        if (combined.aborted) throw new AgentError('Image generation was cancelled. Your room is unchanged.', 504);
        if (references.some(reference => !dependencies.getRoom(input.roomId).objects.some(object => object.id === reference.objectId && object.kind === 'image' && object.data.src === reference.src))) throw new AgentError('A reference image changed or was removed. Start a new image request.', 409);
        const generatedAt = dependencies.now(), elapsedMs = generatedAt - started;
        const src = storePng(bytes, dependencies.assetDirectory);
        const referenceProvenance = references.length ? { referenceIds: references.map(reference => reference.objectId), referenceImages: references.map(({ objectId, src, sha256 }) => ({ objectId, src, sha256 })) } : {};
        const object = makeObject('image', 'agent:images', input.position, { src, mimeType: 'image/png', imageWidth: width, imageHeight: height, provenance: { prompt: input.prompt, model: IMAGE_MODEL, generatedAt, elapsedMs, requestId: input.requestId, requestDigest: digest, requestedBy: input.actor, ...referenceProvenance } });
        object.title = input.prompt.slice(0, 100); const scale = 512 / Math.max(width, height); object.w = Math.max(80, Math.round(width * scale)); object.h = Math.max(60, Math.round(height * scale));
        dependencies.applyOperation(input.roomId, { type: 'put', object, ...(input.pageId ? { pageId: input.pageId } : {}) }, 'agent:images', { requestId: `image:${createHash('sha256').update(input.requestId).digest('hex')}` });
        return { objectId: object.id, src, model: IMAGE_MODEL, width, height, generatedAt, elapsedMs };
      } catch (cause) {
        if (combined.aborted) throw new AgentError('Image generation timed out or was cancelled. Your room is unchanged.', 504);
        if (cause instanceof AgentError) throw cause;
        throw new AgentError('Image generation did not return a complete image. Your room is unchanged.');
      } finally { active--; }
    })();
    requests.set(key, { digest, result }); return result;
  };
}
export const generateRoomImage = createGenerateRoomImage();
