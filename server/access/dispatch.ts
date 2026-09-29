import { hostedWorkAuthorizationReady } from './work-authorization';
import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { AccessError, type RoomAccess } from './store';
import { sessionToken } from './http';
import { createRoomAuthorization, withRoomAuthorization, type RoomAuthorization } from './context';
import type { RoomPermission } from '../../shared/room-access';

const jsonPaths = new Set(['/api/agents/generate', '/api/agents/contribute', '/api/voice/tool', '/api/voice/transcript', '/api/voice/heartbeat', '/api/voice/stop', '/api/media/token', '/api/activity/launch', '/api/activity/action', '/api/scenes']);
const getPaths = new Set(['/api/scenes', '/api/activity/state']);
export type AccessDispatch = { request: IncomingMessage; scope: RoomAuthorization };
/** Explicit allowlist; body is bounded and identity replaced before existing handlers parse it. */
export async function prepareAccessDispatch(access: RoomAccess, request: IncomingMessage): Promise<AccessDispatch> {
  // Authenticate before buffering input, even when roomId lives in the JSON body.
  access.identity(sessionToken(request));
  const url = new URL(request.url ?? '/', 'http://localhost');
  let roomId = '', permission: RoomPermission = 'read', bytes: Buffer | undefined;
  const room = /^\/api\/room\/([a-f0-9]{48})(\/(operation|canvas|document))?$/.exec(url.pathname);
  const asset = /^\/api\/assets\/([a-f0-9]{48})(?:\/[a-f0-9]{64}\.(?:png|jpg|gif|webp|avif|mp4|webm|mov))?$/.exec(url.pathname);
  let input: Record<string, unknown> | undefined;
  const work = /^\/api\/work\/(?:[a-f0-9]{32}|start|resume|cancel)$/.test(url.pathname);
  if (work && !hostedWorkAuthorizationReady()) throw new AccessError('Project work awaits queued authorization integration.', 503);
  if (asset) {
    roomId = asset[1]; permission = request.method === 'POST' ? 'asset:write' : 'asset:read';
    if (!['GET', 'HEAD', 'POST'].includes(request.method ?? '')) throw new AccessError('Method not allowed.', 405);
  } else if (work && request.method === 'GET') { roomId = url.searchParams.get('roomId') ?? ''; }
  else if (work && request.method === 'POST') permission = 'tools';
  else if (room && ['GET', 'POST'].includes(request.method ?? '')) {
    roomId = room[1]; permission = request.method === 'POST' ? 'write' : 'read';
  } else if (getPaths.has(url.pathname) && request.method === 'GET') roomId = url.searchParams.get('roomId') ?? '';
  else if (url.pathname === '/api/voice/session' && request.method === 'POST') { roomId = url.searchParams.get('roomId') ?? ''; permission = 'tools'; }
  else if (jsonPaths.has(url.pathname) && request.method === 'POST') permission = url.pathname === '/api/media/token' ? 'read' : 'tools';
  else throw new AccessError('This API is unavailable in the invite profile.', 403);
  if (!asset && request.method === 'POST') {
    const chunks: Buffer[] = []; let size = 0;
    for await (const chunk of request) {
      const part = Buffer.from(chunk); size += part.length;
      if (size > (url.pathname === '/api/agents/generate' || url.pathname === '/api/voice/tool' ? 1_600_000 : 80_000)) throw new AccessError('Request too large.', 413);
      chunks.push(part);
    }
    bytes = Buffer.concat(chunks);
    if (url.pathname !== '/api/voice/session') {
      if (request.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') throw new AccessError('JSON required.', 415);
      try { input = JSON.parse(bytes.toString('utf8')); } catch { throw new AccessError('Invalid JSON.', 400); }
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw new AccessError('Object required.', 400);
      if (roomId && input.roomId !== undefined && input.roomId !== roomId) throw new AccessError('Room scope mismatch.');
      roomId ||= typeof input.roomId === 'string' ? input.roomId : '';
      if (room?.[3] === 'canvas' && input.name === 'read_canvas') permission = 'read';
    }
  }
  const scope = createRoomAuthorization(access, sessionToken(request), roomId);
  scope.check(permission);
  if (input) {
    input.actor = scope.userId;
    if (url.pathname === '/api/media/token') input.identity = scope.userId;
    // A transport session belongs to this signed identity, never another room participant.
    if (url.pathname.startsWith('/api/voice/') && typeof input.sessionId === 'string') input.sessionId = voiceSessionId(scope.userId, input.sessionId);
    if (url.pathname === '/api/voice/tool' && input.name === 'start_work' && !hostedWorkAuthorizationReady()) throw new AccessError('Project work awaits the coordinator’s queued authorization integration.', 503);
    bytes = Buffer.from(JSON.stringify(input));
  }
  if (url.pathname === '/api/voice/session') {
    url.searchParams.set('actor', scope.userId);
    url.searchParams.set('sessionId', voiceSessionId(scope.userId, url.searchParams.get('sessionId') ?? ''));
  }
  if (bytes) {
    const replay = Readable.from([bytes]) as unknown as IncomingMessage;
    Object.assign(replay, { method: request.method, url: `${url.pathname}${url.search}`, headers: { ...request.headers, 'content-length': String(bytes.length) }, socket: request.socket });
    return { request: replay, scope };
  }
  return { request, scope };
}
function voiceSessionId(userId: string, sessionId: string) {
  if (!/^[\w:.-]{1,200}$/.test(sessionId)) throw new AccessError('Invalid voice session.', 400);
  return createHash('sha256').update(`${userId}:${sessionId}`).digest('hex');
}
export async function dispatchAuthorized<T>(dispatch: AccessDispatch, response: ServerResponse, run: (request: IncomingMessage) => Promise<T>) {
  const stop = dispatch.scope.watch(() => response.destroy());
  try { return await withRoomAuthorization(dispatch.scope, () => run(dispatch.request)); }
  finally { stop(); }
}
