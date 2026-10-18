import 'server-only';
import fs from 'node:fs';
import path from 'node:path';
import { InterviewError } from '@present/kernel/interview-store';

export const maxAssetBytes = 8 * 1024 * 1024;
export function assetDirectory(briefId: string) {
  if (!/^[\da-f-]{36}$/i.test(briefId)) throw new InterviewError(404, 'Material is unavailable.');
  return path.join(process.cwd(), '.present', 'interview-assets', briefId);
}
export async function readAssetBody(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) throw new InterviewError(400, 'Choose a file to upload.');
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > maxAssetBytes) throw new InterviewError(413, 'Choose a file smaller than 8 MB.');
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  const bytes = Buffer.concat(chunks);
  if (bytes.subarray(0, 5).toString() === '%PDF-') return { bytes, mime: 'application/pdf' as const };
  if (bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return { bytes, mime: 'image/png' as const };
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return { bytes, mime: 'image/jpeg' as const };
  if (bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP') return { bytes, mime: 'image/webp' as const };
  throw new InterviewError(400, 'Choose a PDF, PNG, JPEG, or WebP file.');
}
export function writeAssetFile(briefId: string, fileId: string, bytes: Buffer) {
  const directory = assetDirectory(briefId);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(directory, fileId), bytes, { mode: 0o600, flag: 'wx' });
}
export function readAssetFile(briefId: string, fileId: string) {
  if (!/^[\da-f-]{36}$/i.test(fileId)) throw new InterviewError(404, 'Material is unavailable.');
  const file = path.join(assetDirectory(briefId), fileId);
  if (!fs.existsSync(file)) throw new InterviewError(404, 'Material is unavailable.');
  return new Uint8Array(fs.readFileSync(file));
}
