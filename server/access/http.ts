import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import type { RoomPermission } from '../../shared/room-access';
import { AccessError, RoomAccess } from './store';

export function sessionToken(req: Pick<IncomingMessage, 'headers'>): string {
  const values = (req.headers.cookie ?? '').split(';').map(value => value.trim()).filter(value => value.startsWith('present_session='));
  return values.length === 1 ? values[0].slice('present_session='.length) : '';
}
/** Call in addition to existing sandbox isolation, before *any* protected route/upgrade. */
export function assertAccessOrigin(req: Pick<IncomingMessage, 'headers' | 'method'>, configuredOrigin: string, mutation = false) {
  const origin = new URL(configuredOrigin);
  if (origin.origin !== configuredOrigin || (origin.protocol !== 'https:' && !(origin.protocol === 'http:' && origin.hostname === '127.0.0.1'))) throw new Error('Use an exact HTTPS origin or the explicit HTTP loopback origin.');
  if (req.headers.host !== origin.host || (req.headers.origin !== undefined && req.headers.origin !== origin.origin) || req.headers['sec-fetch-site'] === 'cross-site' || (mutation && req.headers.origin !== origin.origin)) throw new AccessError('Same-origin request required.');
}
export function authorizeRequest(access: RoomAccess, req: Pick<IncomingMessage, 'headers'>, roomId: string, permission: RoomPermission) {
  return access.authorize(sessionToken(req), roomId, permission);
}
/** Keep this check beside each awaited operation's final read/commit, not just route entry. */
export function authorizationPath(access: RoomAccess, token: string, roomId: string, permission: RoomPermission) {
  return () => access.authorize(token, roomId, permission);
}
/** Close sockets/streams on revocation AND expiry, including idle connections. Also check each frame/send. */
export function watchAuthorization(access: RoomAccess, token: string, roomId: string, onDenied: () => void) {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let unsubscribe = () => {};
  const stop = () => { stopped = true; clearTimeout(timer); unsubscribe(); };
  const check = () => {
    if (stopped) return;
    try {
      const grant = access.authorize(token, roomId, 'read');
      clearTimeout(timer);
      timer = setTimeout(check, Math.max(1, Math.min(grant.expiresAt - Date.now(), 60_000)));
      timer.unref();
    } catch { stop(); onDenied(); }
  };
  unsubscribe = access.subscribe(check); check();
  return stop;
}
const inviteInput = z.object({ role: z.enum(['editor', 'viewer']), ttlMs: z.number().int(), maxUses: z.number().int() }).strict();
async function body(req: IncomingMessage): Promise<unknown> {
  if (req.headers['content-type']?.split(';')[0] !== 'application/json') throw new AccessError('JSON required.', 415);
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of req) { const part = Buffer.from(chunk); size += part.length; if (size > 4096) throw new AccessError('Request too large.', 413); chunks.push(part); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new AccessError('Invalid JSON.', 400); }
}
function respond(res: ServerResponse, status: number, value: unknown) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' }); res.end(JSON.stringify(value));
}
export function createAccessHandler(access: RoomAccess, origin: string) {
  // Validate configuration eagerly, before accepting traffic.
  assertAccessOrigin({ headers: { host: new URL(origin).host } }, origin);
  const cookie = (token: string, maxAge: number) => `present_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${origin.startsWith('https:') ? '; Secure' : ''}`;
  return async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
    const url = new URL(req.url ?? '/', origin);
    if (!url.pathname.startsWith('/api/access/')) return false;
    try {
      assertAccessOrigin(req, origin, req.method !== 'GET');
      const token = sessionToken(req);
      if (req.method === 'POST' && url.pathname === '/api/access/session') {
        // Never silently replace an existing invalid identity (which might own rooms).
        if (token) { respond(res, 200, access.identity(token)); return true; }
        const session = access.createSession();
        res.setHeader('set-cookie', cookie(session.token, Math.floor((session.expiresAt - Date.now()) / 1000)));
        respond(res, 201, { userId: session.userId, expiresAt: session.expiresAt }); return true;
      }
      if (req.method === 'DELETE' && url.pathname === '/api/access/session') {
        if (token) { try { access.revokeSession(token); } catch (error) { if (!(error instanceof AccessError) || error.status !== 401) throw error; } }
        res.setHeader('set-cookie', cookie('', 0)); respond(res, 200, { ok: true }); return true;
      }
      if (req.method === 'POST' && url.pathname === '/api/access/rooms') { respond(res, 201, access.createRoom(token)); return true; }
      if (req.method === 'POST' && url.pathname === '/api/access/join') {
        const input = z.object({ token: z.string().max(200) }).strict().parse(await body(req));
        respond(res, 200, access.join(token, input.token)); return true;
      }
      const match = /^\/api\/access\/rooms\/([a-f0-9]{48})(?:\/(invites|leave|members)(?:\/([a-f0-9]{48}))?)?$/.exec(url.pathname);
      if (match) {
        const [, roomId, action, target] = match;
        if (!action && req.method === 'GET') { respond(res, 200, access.authorize(token, roomId, 'read')); return true; }
        if (action === 'invites' && !target && req.method === 'POST') { respond(res, 201, access.invite(token, roomId, inviteInput.parse(await body(req)))); return true; }
        if (action === 'leave' && !target && req.method === 'POST') { access.leave(token, roomId); respond(res, 200, { ok: true }); return true; }
        if (action === 'invites' && target && req.method === 'DELETE') { access.revokeInvite(token, roomId, target); respond(res, 200, { ok: true }); return true; }
        if (action === 'members' && target && req.method === 'DELETE') { access.revokeMember(token, roomId, target); respond(res, 200, { ok: true }); return true; }
      }
      respond(res, 404, { error: 'Unknown access route.' });
    } catch (error) {
      respond(res, error instanceof AccessError ? error.status : error instanceof z.ZodError ? 400 : 500, { error: error instanceof AccessError ? error.message : error instanceof z.ZodError ? 'Invalid access request.' : 'Access service unavailable.' });
    }
    return true;
  };
}
