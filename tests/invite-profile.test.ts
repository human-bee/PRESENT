import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, request as httpRequest } from 'node:http';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { WebSocket } from 'ws';
import { presentSchema } from '../shared/tldraw-schema';
import { makeObject } from '../shared/room';
import { objectToShape } from '../shared/tldraw-adapter';

function reader(socket: WebSocket) {
  const messages: Record<string, any>[] = [], listeners = new Set<() => void>();
  socket.on('message', raw => { const m = JSON.parse(raw.toString()); messages.push(...(m.type === 'data' ? m.data : [m])); for (const listener of listeners) listener(); });
  return (predicate: (m: Record<string, any>) => boolean) => new Promise<Record<string, any>>((resolve, reject) => {
    const timer = setTimeout(() => { listeners.delete(check); reject(new Error('Native message not received.')); }, 5000);
    function check() { const i = messages.findIndex(predicate); if (i >= 0) { clearTimeout(timer); listeners.delete(check); resolve(messages.splice(i, 1)[0]); } }
    listeners.add(check); check();
  });
}
test('invite HTTP/native sync: isolation, identity, assets, pending commits, media hook, templates and revocation', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'present-invite-contract-'));
  process.env.PRESENT_DATA_DIRECTORY = directory;
  const { RoomAccess, createAccessHandler, AccessError } = await import('../server/access');
  const { createInviteProfile } = await import('../server/access/profile');
  const { installNativeAccessGuard } = await import('../server/access/native-guard');
  const { createRoomAuthorization, withRoomAuthorization, captureRoomAuthorization } = await import('../server/access/context');
  const { MediaRevocations } = await import('../server/access/media');
  const { AccessRateLimit } = await import('../server/access/rate-limit');
  const { WorkAuthorizations } = await import('../server/access/work-authorization');
  const { bindPresence } = await import('../server/access/socket');
  const { handleRoomRequest } = await import('../server/room-routes');
  const { handleAssetRequest } = await import('../server/asset-routes');
  const { handleMediaRequest, mediaRevocations } = await import('../server/media-routes');
  const { attachRoomSocket } = await import('../server/room-socket');
  const store = await import('../server/room-store');
  const { referenceAsset } = await import('../server/access/assets');
  const access = new RoomAccess({ directory: join(directory, 'access'), secret: randomBytes(32).toString('hex') });
  const restore = installNativeAccessGuard();
  const server = createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const port = (server.address() as { port: number }).port, origin = `http://127.0.0.1:${port}`;
  const profile = createInviteProfile({ access, origin, handleRequest: createAccessHandler(access, origin) });
  server.on('request', (req, res) => { void profile(req, res, async request => {
    // Coordinator-owned handler fixture: the access profile must admit only a signed session.
    if (request.url === '/api/projects') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify([{ id: 'alpha', name: 'Alpha', description: 'Fixture' }])); return; }
    if (await handleRoomRequest(request, res) || await handleAssetRequest(request, res) || await handleMediaRequest(request, res)) return;
    res.writeHead(404); res.end();
  }).catch(error => { if (!res.headersSent) res.writeHead(error instanceof AccessError ? error.status : 500); res.end(JSON.stringify({ error: error.message })); }); });
  const closeSockets = attachRoomSocket(server, port, { getTldrawRoom: store.getTldrawRoom }, { access, origin });
  const sockets: WebSocket[] = [];
  const call = (path: string, method = 'GET', cookie = '', input?: unknown, extra: Record<string, string> = {}) => fetch(origin + path, { method, headers: { origin, cookie, 'content-type': 'application/json', ...extra }, body: input === undefined ? undefined : JSON.stringify(input) });
  const session = async () => (await call('/api/access/session', 'POST')).headers.get('set-cookie')!.split(';')[0];
  const native = async (roomId: string, cookie: string, sessionId = 'same-client-session') => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/connect?room=${roomId}&sessionId=${sessionId}`, { origin, headers: { cookie } }); sockets.push(socket);
    const read = reader(socket); await once(socket, 'open');
    socket.send(JSON.stringify({ type: 'connect', connectRequestId: randomUUID(), lastServerClock: 0, protocolVersion: 8, schema: presentSchema.serialize() }));
    const snapshot = await read(m => m.type === 'connect'); return { socket, read, snapshot };
  };
  try {
    const owner = await session(), guest = await session(), viewer = await session(), stranger = await session();
    const room = await (await call('/api/access/rooms', 'POST', owner)).json() as { roomId: string; userId: string };
    const other = await (await call('/api/access/rooms', 'POST', stranger)).json() as { roomId: string };
    const url = `/api/room/${room.roomId}`;
    assert.equal((await call(url)).status, 401);
    assert.equal((await call(url, 'GET', stranger)).status, 403);
    assert.equal((await call('/api/projects')).status, 401);
    assert.equal((await call('/api/projects', 'GET', owner)).status, 200);
    const providers = await (await call('/api/agents', 'GET', owner)).json() as { providers: { id: string; reasoning: string[]; fast: boolean }[] };
    assert.equal(providers.providers[0].id, 'cerebras');
    assert.ok(providers.providers[0].reasoning.includes('low'));
    assert.equal(providers.providers[0].fast, false);
    assert.equal((await call('/api/projects', 'POST', owner, {})).status, 403);
    assert.equal((await call('/api/work/start', 'POST', owner, { roomId: room.roomId })).status, 503);
    assert.equal((await call('/api/unknown', 'GET', owner)).status, 403);
    const badHost = await new Promise<number | undefined>(resolve => { const r = httpRequest(origin + '/api/profile', { headers: { host: 'evil.example', 'x-forwarded-host': new URL(origin).host } }, response => { response.resume(); resolve(response.statusCode); }); r.end(); });
    assert.equal(badHost, 403);
    assert.equal((await call('/api/access/rooms', 'POST', owner, undefined, { origin: 'https://evil.example' })).status, 403);
    const invite = async (role: string) => (await call(`/api/access/rooms/${room.roomId}/invites`, 'POST', owner, { role, ttlMs: 60000, maxUses: 1 })).json() as Promise<{ token: string; id: string }>;
    const edit = await invite('editor'), view = await invite('viewer');
    const guestGrant = await (await call('/api/access/join', 'POST', guest, { token: edit.token })).json() as { userId: string };
    const viewerGrant = await (await call('/api/access/join', 'POST', viewer, { token: view.token })).json() as { userId: string };
    // Local JWT signing only. No provider request: close the tracked lease before any revocation.
    const previousMedia = [process.env.LIVEKIT_URL, process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET];
    try {
      process.env.LIVEKIT_URL = 'wss://media.invalid'; process.env.LIVEKIT_API_KEY = 'offline-test'; process.env.LIVEKIT_API_SECRET = randomBytes(32).toString('hex');
      const tokenResponse = await call('/api/media/token', 'POST', viewer, { roomId: room.roomId, identity: room.userId, name: 'Viewer' });
      assert.equal(tokenResponse.status, 200);
      const minted = await tokenResponse.json() as { token: string; canPublish: boolean };
      const claims = JSON.parse(Buffer.from(minted.token.split('.')[1], 'base64url').toString('utf8'));
      assert.equal(claims.sub, viewerGrant.userId); assert.equal(minted.canPublish, false);
      assert.equal(claims.video.room, room.roomId); assert.equal(claims.video.canPublish, false); assert.equal(claims.video.canSubscribe, true);
      assert.ok(claims.exp <= Math.floor(Date.now() / 1000) + 60);
    } finally {
      mediaRevocations.close();
      for (const [i, key] of ['LIVEKIT_URL', 'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET'].entries()) { if (previousMedia[i] === undefined) delete process.env[key]; else process.env[key] = previousMedia[i]; }
    }
    const a = await native(room.roomId, owner), b = await native(room.roomId, guest), v = await native(room.roomId, viewer);
    assert.equal(a.socket.readyState, WebSocket.OPEN); // Same transport ID from different users cannot evict owner.
    const shape = objectToShape({ ...makeObject('note', 'spoofed', { x: 10, y: 20 }, { text: 'Native shared edit' }), id: 'signed-shared-note' });
    b.socket.send(JSON.stringify({ type: 'push', clientClock: 0, diff: { [shape.id]: ['put', shape] } }));
    await a.read(m => m.type === 'patch' && JSON.stringify(m.diff).includes('Native shared edit'));
    b.socket.close(); await once(b.socket, 'close');
    const reconnected = await native(room.roomId, guest); assert.ok(JSON.stringify(reconnected.snapshot.diff).includes('Native shared edit'));
    const refused = objectToShape({ ...makeObject('note', 'viewer', { x: 20, y: 30 }, { text: 'Forbidden' }), id: 'viewer-forbidden' });
    v.socket.send(JSON.stringify({ type: 'push', clientClock: 0, diff: { [refused.id]: ['put', refused] } }));
    await v.read(m => m.type === 'push_result');
    const state = await (await call(url, 'GET', owner)).json() as any;
    assert.equal(state.room.objects.some((o: any) => o.id === 'viewer-forbidden'), false);
    assert.equal((await call(url + '/operation', 'POST', viewer, { actor: room.userId, requestId: 'denied', operation: { type: 'rename', title: 'Denied' } })).status, 403);
    assert.equal((await call('/api/agents/generate', 'POST', viewer, { roomId: room.roomId, actor: room.userId })).status, 403);
    const renamed = await (await call(url + '/operation', 'POST', guest, { actor: room.userId, requestId: 'signed-rename', operation: { type: 'rename', title: 'Shared alpha' } })).json() as any;
    assert.equal(renamed.room.events.at(-1).actor, guestGrant.userId);
    const compactResponse = await call(url + '/operation', 'POST', guest, { actor: room.userId, requestId: 'compact-widget-edit', operation: { type: 'patch', id: 'signed-shared-note', patch: { data: { text: 'Compact response, native state' } } } }, { Prefer: 'return=minimal' });
    assert.equal(compactResponse.status, 200);
    assert.equal(compactResponse.headers.get('Preference-Applied'), 'return=minimal');
    const compact = await compactResponse.json() as { receipt: { status: string; revision: number; requestId: string }; room?: unknown };
    assert.equal(compact.room, undefined);
    assert.deepEqual(compact.receipt, { status: 'committed', revision: renamed.room.revision + 1, requestId: 'compact-widget-edit' });
    await a.read(m => m.type === 'patch' && JSON.stringify(m.diff).includes('Compact response, native state'));
    const compactRepeat = await (await call(url + '/operation', 'POST', guest, { actor: room.userId, requestId: 'compact-widget-edit', operation: { type: 'patch', id: 'signed-shared-note', patch: { data: { text: 'Compact response, native state' } } } }, { Prefer: 'return=minimal' })).json();
    assert.deepEqual(compactRepeat, compact, 'minimal responses preserve idempotence and canonical receipts');
    assert.equal(JSON.parse(bindPresence(JSON.stringify({ type: 'push', presence: ['put', { userId: 'owner-spoof' }] }), guestGrant.userId)).presence[1].userId, `user:${guestGrant.userId}`);
    const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489', 'hex');
    const uploaded = await fetch(`${origin}/api/assets/${room.roomId}`, { method: 'POST', headers: { origin, cookie: owner, 'content-type': 'image/png' }, body: png });
    assert.equal(uploaded.status, 201); const { src } = await uploaded.json() as { src: string };
    assert.equal((await call(src, 'HEAD', guest)).status, 200);
    assert.equal((await call(src, 'GET', guest, undefined, { range: 'bytes=0-7' })).status, 206);
    assert.equal((await call(src, 'GET', stranger)).status, 403);
    assert.equal((await call(src.replace(room.roomId, other.roomId), 'GET', stranger)).status, 404);
    assert.equal((await call(`/api/assets/${src.split('/').pop()}`, 'GET', owner)).status, 403);
    const ownerScope = createRoomAuthorization(access, owner.slice('present_session='.length), room.roomId);
    const guestScope = createRoomAuthorization(access, guest.slice('present_session='.length), room.roomId);
    assert.throws(() => withRoomAuthorization(guestScope, () => referenceAsset(src.replace(room.roomId, other.roomId), join(directory, 'assets'), room.roomId)), AccessError);
    const runOwner = withRoomAuthorization(ownerScope, captureRoomAuthorization), runGuest = withRoomAuthorization(guestScope, captureRoomAuthorization);
    const jobs = new WorkAuthorizations();
    withRoomAuthorization(ownerScope, () => jobs.capture('owner-job', room.roomId, room.userId));
    withRoomAuthorization(guestScope, () => jobs.capture('guest-job', room.roomId, guestGrant.userId));
    await withRoomAuthorization(guestScope, () => jobs.run('owner-job', room.roomId, room.userId, new AbortController(), async () => { store.getRoom(room.roomId); }));
    // Execute callbacks under an unrelated caller: each queued task must restore its own scope.
    withRoomAuthorization(guestScope, () => runOwner(() => assert.equal(store.getRoom(room.roomId).title, 'Shared alpha')));
    const saved = await (await call('/api/templates', 'POST', owner, { roomId: room.roomId, name: 'Owner private layout' })).json() as { id: string };
    assert.ok(saved.id);
    assert.equal((await call(`/api/templates/${saved.id}`, 'GET', guest)).status, 404);
    assert.equal((await call('/api/templates', 'POST', guest, { roomId: room.roomId, name: 'Unauthorized export' })).status, 400);
    const fresh = await (await call('/api/templates/builtin-focus/instantiate', 'POST', guest, {})).json() as { roomId: string };
    assert.notEqual(fresh.roomId, room.roomId); assert.match(fresh.roomId, /^[a-f0-9]{48}$/);
    assert.equal((await call(`/api/room/${fresh.roomId}`, 'GET', guest)).status, 200);
    assert.equal((await call(`/api/room/${fresh.roomId}`, 'GET', owner)).status, 403);
    let removed = 0;
    const removals = new MediaRevocations(async () => { removed++; }, 1); removals.track(guestScope);
    const lost = once(reconnected.socket, 'close');
    await call(`/api/access/rooms/${room.roomId}/invites/${edit.id}`, 'DELETE', owner);
    assert.equal((await lost)[0], 1008);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(removed, 1); assert.equal(removals.status(room.roomId)[0].state, 'removed'); removals.close();
    assert.equal((await call(url, 'GET', guest)).status, 403);
    await assert.rejects(() => jobs.run('guest-job', room.roomId, guestGrant.userId, new AbortController(), async () => store.getRoom(room.roomId)), AccessError); jobs.close();
    assert.throws(() => runGuest(() => store.applyOperation(room.roomId, { type: 'rename', title: 'Late commit' }, 'forged')), AccessError);
    runOwner(() => assert.equal(store.getRoom(room.roomId).title, 'Shared alpha'));
    assert.equal((await call('/api/access/join', 'POST', guest, { token: edit.token })).status, 403);
    const deniedSocket = new WebSocket(`ws://127.0.0.1:${port}/connect?room=${room.roomId}&sessionId=denied`, { origin, headers: { cookie: guest } });
    deniedSocket.on('error', () => {}); const rejected = await once(deniedSocket, 'unexpected-response'); assert.equal(rejected[1].statusCode, 403); deniedSocket.terminate();
    let now = 1; const limit = new AccessRateLimit(2, 1000, 1, () => now); limit.take('peer'); limit.take('peer'); assert.throws(() => limit.take('peer'), AccessError); assert.throws(() => limit.take('other'), AccessError); now = 1001; limit.take('other');
  } finally {
    for (const socket of sockets) socket.terminate(); closeSockets();
    await new Promise<void>(resolve => server.close(() => resolve()));
    restore(); store.closeRoomStore(); access.close(); rmSync(directory, { recursive: true, force: true });
  }
});
