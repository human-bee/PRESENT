import type { IncomingMessage, ServerResponse } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';

export function isLocalRequest(req: IncomingMessage, port: number): boolean {
  const authorities = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  const host = req.headers.host?.toLowerCase();
  if (!host || !authorities.has(host)) return false;
  const origin = req.headers.origin;
  if (origin !== undefined && origin !== `http://${host}`) return false;
  return true;
}
export function json(res: ServerResponse, status: number, value: unknown) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(value));
}
export function commonHeaders(res: ServerResponse) {
  res.setHeader('referrer-policy', 'no-referrer');
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('x-frame-options', 'SAMEORIGIN');
  res.setHeader('content-security-policy', "frame-src 'self'; object-src 'none'; base-uri 'self'");
  res.setHeader('permissions-policy', 'camera=(self), microphone=(self), display-capture=(self)');
}
const mime: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };
export function serveDist(req: IncomingMessage, res: ServerResponse, pathname: string, directory: string) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'Method not allowed.' });
  let decoded: string;
  try { decoded = decodeURIComponent(pathname); } catch { return json(res, 400, { error: 'Invalid path.' }); }
  const base = resolve(directory);
  let file = resolve(base, `.${decoded}`);
  if (file !== base && !file.startsWith(`${base}${sep}`)) return json(res, 403, { error: 'Invalid path.' });
  if (!existsSync(file) || !statSync(file).isFile()) {
    if (extname(decoded)) return json(res, 404, { error: 'Not found.' });
    file = join(base, 'index.html');
  }
  if (!existsSync(file)) return json(res, 503, { error: 'Build the app before starting production.' });
  res.writeHead(200, { 'content-type': mime[extname(file)] ?? 'application/octet-stream', 'cache-control': extname(file) === '.html' ? 'no-store' : 'public, max-age=3600' });
  if (req.method === 'HEAD') return res.end();
  createReadStream(file).on('error', () => res.destroy()).pipe(res);
}
