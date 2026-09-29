import { roomAuthorization } from './access/context';
import { MediaRevocations } from './access/media';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { AccessToken, RoomServiceClient } from 'livekit-server-sdk';

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

export const mediaRevocations = new MediaRevocations(async (roomId, userId) => {
  const raw = process.env.LIVEKIT_URL || process.env.NEXT_PUBLIC_LIVEKIT_URL;
  const key = process.env.LIVEKIT_API_KEY, secret = process.env.LIVEKIT_API_SECRET;
  if (!raw || !key || !secret) throw new Error('Media removal is not configured.');
  const url = new URL(raw); url.protocol = url.protocol === 'wss:' ? 'https:' : url.protocol === 'ws:' ? 'http:' : url.protocol;
  await new RoomServiceClient(url.toString(), key, secret, { requestTimeout: 5, failover: false }).removeParticipant(roomId, userId);
});
/** In invite mode the dispatcher supplies a live signed membership. */
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
  const { roomId, identity: suppliedIdentity, name } = input as Record<string, unknown>;
  const scope = roomAuthorization();
  const identity = scope?.check('read').userId ?? suppliedIdentity;
  if (scope && roomId !== scope.roomId) throw new Error('Room scope mismatch.');
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
    const grant = scope?.check('read');
    const ttl = grant ? Math.max(1, Math.min(60, Math.floor((grant.expiresAt - Date.now()) / 1000))) : 900;
    const token = new AccessToken(key, secret, { identity, name: name.trim(), ttl });
    token.addGrant({ roomJoin: true, room: roomId, canPublish: !grant || grant.role !== 'viewer', canSubscribe: true, canPublishData: false });
    const jwt = await token.toJwt();
    scope?.check('read');
    if (scope) mediaRevocations.track(scope, Date.now() + ttl * 1000);
    reply(res, 200, { url: url.toString(), token: jwt, canPublish: !grant || grant.role !== 'viewer' });
  } catch {
    reply(res, 503, { error: 'The call could not be started. Try again shortly.' });
  }
  return true;
}
