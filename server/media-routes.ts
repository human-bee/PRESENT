import type { IncomingMessage, ServerResponse } from 'node:http';
import { AccessToken } from 'livekit-server-sdk';

function reply(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    const buffer = Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > 4096) throw new Error('Request too large');
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

/** Room links are capabilities. Possession permits joining only that exact room. */
export async function handleMediaRequest(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  if (req.url?.split('?')[0] !== '/api/media/token') return false;
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    reply(res, 405, { error: 'Use POST to join a call.' });
    return true;
  }
  let input: unknown;
  try { input = await readBody(req); }
  catch { reply(res, 400, { error: 'Invalid call request.' }); return true; }
  if (!input || typeof input !== 'object') {
    reply(res, 400, { error: 'Invalid call request.' });
    return true;
  }
  const { roomId, identity, name } = input as Record<string, unknown>;
  if (typeof roomId !== 'string' || !/^[a-f0-9]{24,64}$/.test(roomId)
    || typeof identity !== 'string' || !/^[\w-]{3,80}$/.test(identity)
    || typeof name !== 'string' || !name.trim() || name.length > 60 || /\p{Cc}/u.test(name)) {
    reply(res, 400, { error: 'A valid room, identity, and display name are required.' });
    return true;
  }
  const rawUrl = process.env.LIVEKIT_URL || process.env.NEXT_PUBLIC_LIVEKIT_URL;
  const key = process.env.LIVEKIT_API_KEY;
  const secret = process.env.LIVEKIT_API_SECRET;
  let url: URL | undefined;
  try { url = rawUrl ? new URL(rawUrl) : undefined; } catch { /* Report configuration below. */ }
  if (url?.protocol === 'https:') url.protocol = 'wss:';
  if (url?.protocol === 'http:') url.protocol = 'ws:';
  if (!url || !['ws:', 'wss:'].includes(url.protocol) || !key || !secret) {
    reply(res, 503, { error: 'Calls are not configured on this server yet.' });
    return true;
  }
  try {
    const token = new AccessToken(key, secret, { identity, name: name.trim(), ttl: '15m' });
    token.addGrant({ roomJoin: true, room: roomId, canPublish: true, canSubscribe: true, canPublishData: false });
    reply(res, 200, { url: url.toString(), token: await token.toJwt() });
  } catch {
    reply(res, 503, { error: 'The call could not be started. Try again shortly.' });
  }
  return true;
}
