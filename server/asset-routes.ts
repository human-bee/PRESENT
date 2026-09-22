import { dataPath } from './data-path';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, lstatSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import { isLocalRequest, json } from './http';

const types: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime' };
const names = /^[a-f0-9]{64}\.(png|jpg|gif|webp|avif|mp4|webm|mov)$/;
const MAX_BYTES = 25 * 1024 * 1024;
class AssetError extends Error {
  constructor(message: string, public status: number) { super(message); }
}
type Options = { directory?: string; maxBytes?: number; maxStorageBytes?: number; maxFiles?: number };

function validSignature(bytes: Buffer, type: string): boolean {
  const ascii = (start: number, end: number) => bytes.toString('ascii', start, end);
  if (type === 'image/png') return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (type === 'image/jpeg') return bytes.length > 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (type === 'image/gif') return ['GIF87a', 'GIF89a'].includes(ascii(0, 6));
  if (type === 'image/webp') return ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP';
  if (type === 'image/avif') return ascii(4, 8) === 'ftyp' && /avif|avis/.test(ascii(8, Math.min(bytes.length, 64)));
  if (type === 'video/mp4' || type === 'video/quicktime') return bytes.length >= 16 && ascii(4, 8) === 'ftyp';
  return type === 'video/webm' && bytes.subarray(0, 4).equals(Buffer.from([26, 69, 223, 163])) && bytes.subarray(0, 256).includes(Buffer.from('webm'));
}
function readFileBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []; let size = 0; let settled = false;
    const cleanup = () => { req.off('data', data); req.off('end', end); req.off('aborted', aborted); };
    const fail = (cause: Error) => { if (settled) return; settled = true; cleanup(); req.resume(); reject(cause); };
    const data = (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) { fail(new AssetError('Images and videos can be up to 25 MB.', 413)); return; }
      chunks.push(chunk);
    };
    const end = () => { settled = true; cleanup(); resolve(Buffer.concat(chunks)); };
    const error = () => fail(new AssetError('The upload was interrupted.', 400));
    const aborted = () => fail(new AssetError('The upload was interrupted.', 400));
    req.on('data', data); req.once('end', end); req.once('error', error); req.once('aborted', aborted);
  });
}
function byteRange(header: string, size: number): { start: number; end: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2])) return null;
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  const end = match[1] && match[2] ? Math.min(size - 1, Number(match[2])) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size || (!match[1] && Number(match[2]) === 0)) return null;
  return { start, end };
}

export function createAssetHandler(options: Options = {}) {
  const directory = options.directory ?? dataPath('assets');
  const maxBytes = options.maxBytes ?? MAX_BYTES;
  const maxStorageBytes = options.maxStorageBytes ?? 512 * 1024 * 1024;
  const maxFiles = options.maxFiles ?? 1000;
  return async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
    const path = (req.url ?? '').split('?')[0];
    if (path !== '/api/assets' && !path.startsWith('/api/assets/')) return false;
    if (!isLocalRequest(req, req.socket.localPort ?? 0)) { json(res, 403, { error: 'Assets require a same-origin local request.' }); return true; }
    try {
      if (path === '/api/assets') {
        if (req.method !== 'POST') { json(res, 405, { error: 'Upload a file with POST.' }); return true; }
        const mime = (req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
        const extension = Object.keys(types).find(key => types[key] === mime);
        if (!extension) throw new AssetError('This image or video type is not supported.', 415);
        if (Number(req.headers['content-length'] ?? 0) > maxBytes) throw new AssetError('Images and videos can be up to 25 MB.', 413);
        const bytes = await readFileBody(req, maxBytes);
        if (!bytes.length || !validSignature(bytes, mime)) throw new AssetError('The file does not match its image or video type.', 415);
        mkdirSync(directory, { recursive: true, mode: 0o700 });
        const name = `${createHash('sha256').update(bytes).digest('hex')}.${extension}`;
        const file = join(directory, name);
        if (!existsSync(file)) {
          const files = readdirSync(directory).filter(entry => names.test(entry));
          const used = files.reduce((total, entry) => total + lstatSync(join(directory, entry)).size, 0);
          if (files.length >= maxFiles || used + bytes.length > maxStorageBytes) throw new AssetError('Local asset storage is full.', 507);
          writeFileSync(file, bytes, { flag: 'wx', mode: 0o600 });
        } else if (!lstatSync(file).isFile()) throw new AssetError('This asset cannot be stored.', 500);
        json(res, 201, { src: `/api/assets/${name}` }); return true;
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') { json(res, 405, { error: 'Method not allowed.' }); return true; }
      const name = path.slice('/api/assets/'.length);
      if (!names.test(name)) throw new AssetError('Asset not found.', 404);
      const file = join(directory, name);
      if (!existsSync(file) || !lstatSync(file).isFile()) throw new AssetError('Asset not found.', 404);
      const size = lstatSync(file).size;
      const range = req.headers.range ? byteRange(req.headers.range, size) : undefined;
      if (range === null) { res.setHeader('content-range', `bytes */${size}`); throw new AssetError('This byte range is not available.', 416); }
      res.writeHead(range ? 206 : 200, {
        'content-type': types[name.split('.').pop() ?? ''], 'content-length': range ? range.end - range.start + 1 : size,
        'accept-ranges': 'bytes', 'cache-control': 'private, max-age=31536000, immutable',
        'x-content-type-options': 'nosniff', 'cross-origin-resource-policy': 'same-origin',
        'content-security-policy': "default-src 'none'; sandbox",
        ...(range ? { 'content-range': `bytes ${range.start}-${range.end}/${size}` } : {}),
      });
      if (req.method === 'HEAD') res.end();
      else createReadStream(file, range ?? undefined).on('error', () => res.destroy()).pipe(res);
    } catch (cause) {
      req.resume();
      if (!res.headersSent && !res.destroyed) json(res, cause instanceof AssetError ? cause.status : 500, { error: cause instanceof AssetError ? cause.message : 'The asset request could not finish.' });
    }
    return true;
  };
}
export const handleAssetRequest = createAssetHandler();
