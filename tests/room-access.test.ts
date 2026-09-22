import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { RoomAccess, AccessError, assertAccessOrigin, authorizationPath, createAccessHandler, watchAuthorization } from '../server/access';
import { roleAllows } from '../shared/room-access';

const secret = randomBytes(32).toString('hex');
function fixture(now?: () => number) {
  const directory = mkdtempSync(join(tmpdir(), 'present-access-test-'));
  const access = new RoomAccess({ directory, secret, now });
  return { directory, access, cleanup: () => { access.close(); rmSync(directory, { recursive: true, force: true }); } };
}
const denied = (fn: () => unknown) => assert.throws(fn, AccessError);

test('role contract, create/join/leave/revoke, tampering and durable replay denial', () => {
  const f = fixture();
  try {
    const a = f.access, owner = a.createSession(), guest = a.createSession(), stranger = a.createSession();
    const room = a.createRoom(owner.token);
    denied(() => a.authorize(stranger.token, room.roomId, 'read'));
    denied(() => a.authorize(owner.token + 'x', room.roomId, 'read'));
    const viewer = a.invite(owner.token, room.roomId, { role: 'viewer', ttlMs: 60_000, maxUses: 1 });
    assert.equal(a.join(guest.token, viewer.token).role, 'viewer');
    for (const permission of ['read', 'asset:read'] as const) assert.equal(a.authorize(guest.token, room.roomId, permission).role, 'viewer');
    for (const permission of ['write', 'tools', 'asset:write', 'invite', 'revoke'] as const) denied(() => a.authorize(guest.token, room.roomId, permission));
    denied(() => a.join(stranger.token, viewer.token));
    denied(() => a.invite(owner.token, room.roomId, { role: 'owner' as 'editor', ttlMs: 1000, maxUses: 1 }));
    const editor = a.invite(owner.token, room.roomId, { role: 'editor', ttlMs: 60_000, maxUses: 2 });
    assert.equal(a.join(guest.token, editor.token).role, 'viewer');
    assert.equal(a.join(stranger.token, editor.token).role, 'editor');
    for (const permission of ['read', 'write', 'tools', 'asset:read', 'asset:write'] as const) a.authorize(stranger.token, room.roomId, permission);
    denied(() => a.revokeMember(stranger.token, room.roomId, guest.userId));
    assert.equal(roleAllows('owner', 'unknown' as 'read'), false);
    let closed = 0;
    const unwatch = watchAuthorization(a, guest.token, room.roomId, () => { closed++; });
    const path = authorizationPath(a, guest.token, room.roomId, 'read'); path();
    a.revokeInvite(owner.token, room.roomId, viewer.id);
    assert.equal(closed, 1); denied(path); unwatch();
    denied(() => a.join(guest.token, viewer.token));
    denied(() => a.join(guest.token, editor.token));
    a.leave(stranger.token, room.roomId);
    denied(() => a.join(stranger.token, editor.token));
    denied(() => a.leave(owner.token, room.roomId));
    denied(() => a.revokeMember(owner.token, room.roomId, owner.userId));
    assert.ok(!readFileSync(join(f.directory, 'access.json'), 'utf8').includes(editor.token));
    a.close();
    const restored = new RoomAccess({ directory: f.directory, secret });
    try { restored.authorize(owner.token, room.roomId, 'invite'); denied(() => restored.authorize(guest.token, room.roomId, 'read')); denied(() => restored.join(guest.token, viewer.token)); }
    finally { restored.close(); }
  } finally { f.cleanup(); }
});

test('expiry, revocation, exclusive writer and failed writes stay fail-closed', () => {
  let now = Date.now(); const f = fixture(() => now);
  try {
    const a = f.access, owner = a.createSession(), guest = a.createSession(), room = a.createRoom(owner.token);
    assert.throws(() => new RoomAccess({ directory: f.directory, secret }));
    const invite = a.invite(owner.token, room.roomId, { role: 'editor', ttlMs: 1000, maxUses: 1 });
    now += 1001; denied(() => a.join(guest.token, invite.token));
    const fresh = a.invite(owner.token, room.roomId, { role: 'editor', ttlMs: 1000, maxUses: 1 });
    a.join(guest.token, fresh.token); a.revokeMember(owner.token, room.roomId, guest.userId);
    denied(() => a.authorize(guest.token, room.roomId, 'read'));
    a.revokeSession(owner.token); denied(() => a.identity(owner.token));
    const short = a.createSession(); now += 8 * 86400_000; denied(() => a.identity(short.token));
    now -= 8 * 86400_000;
    // An unavailable parent makes the atomic write fail; no in-memory grant is published.
    const saved = readFileSync(join(f.directory, 'access.json'));
    rmSync(f.directory, { recursive: true }); writeFileSync(f.directory, 'blocked');
    assert.throws(() => a.createRoom(short.token));
    rmSync(f.directory); // Cleanup must also work after failed storage.
    assert.ok(saved.length);
  } finally { f.cleanup(); }
});

test('HTTP cookie identity, strict origin, actual routes, bounds and revocation', async () => {
  const f = fixture();
  const server = createServer();
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const origin = `http://127.0.0.1:${address.port}`;
  server.on('request', (req, res) => { void createAccessHandler(f.access, origin)(req, res); });
  const call = (path: string, method = 'POST', cookie = '', body?: unknown, from = origin) => fetch(`${origin}/api/access/${path}`, { method, headers: { origin: from, cookie, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  try {
    assert.equal((await call('session', 'POST', '', undefined, 'https://evil.example')).status, 403);
    denied(() => assertAccessOrigin({ headers: { host: 'evil.example', origin } }, origin));
    denied(() => assertAccessOrigin({ headers: { host: new URL(origin).host } }, origin, true));
    const response = await call('session'); assert.equal(response.status, 201);
    const cookieHeader = response.headers.get('set-cookie')!; assert.match(cookieHeader, /HttpOnly; SameSite=Strict/);
    const cookie = cookieHeader.split(';')[0];
    const room = await (await call('rooms', 'POST', cookie)).json() as { roomId: string };
    assert.equal((await call(`rooms/${room.roomId}`, 'GET')).status, 401);
    assert.equal((await call(`rooms/${room.roomId}/invites`, 'POST', cookie, { role: 'owner', ttlMs: 1000, maxUses: 1 })).status, 400);
    const invitation = await (await call(`rooms/${room.roomId}/invites`, 'POST', cookie, { role: 'viewer', ttlMs: 1000, maxUses: 1 })).json() as { token: string; id: string };
    const guest = (await call('session')).headers.get('set-cookie')!.split(';')[0];
    assert.equal((await call('join', 'POST', guest, { token: invitation.token })).status, 200);
    assert.equal((await call(`rooms/${room.roomId}/invites/${invitation.id}`, 'DELETE', cookie)).status, 200);
    assert.equal((await call(`rooms/${room.roomId}`, 'GET', guest)).status, 403);
    assert.equal((await call('join', 'POST', guest, { token: invitation.token })).status, 403);
    assert.equal((await call('session', 'DELETE', cookie)).status, 200);
    assert.equal((await call(`rooms/${room.roomId}`, 'GET', cookie)).status, 401);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); f.cleanup(); }
});
