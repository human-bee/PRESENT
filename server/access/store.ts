import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { roleAllows, type RoomGrant, type RoomInvite, type RoomPermission } from '../../shared/room-access';

const id = () => randomBytes(24).toString('hex');
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const key = z.string().regex(/^[a-f0-9]{48}$/);
const member = z.object({ role: z.enum(['owner', 'editor', 'viewer']), inviteId: key.optional(), revoked: z.boolean() });
const schema = z.object({ version: z.literal(1), sessions: z.record(key, z.object({ expiresAt: z.number().int(), revoked: z.boolean() })), rooms: z.record(key, z.object({ members: z.record(key, member), invites: z.record(key, z.object({ digest: z.string(), role: z.enum(['editor', 'viewer']), expiresAt: z.number().int(), maxUses: z.number().int().min(1).max(10), uses: z.number().int(), revoked: z.boolean() })) })) });
type State = z.infer<typeof schema>;
export class AccessError extends Error { constructor(message = 'Room access denied.', public status = 403) { super(message); } }
export type AccessOptions = { directory: string; secret: string; now?: () => number; sessionTtlMs?: number };
/** Single-process alpha store. All mutations are synchronous, durable before publication. */
export class RoomAccess {
  private state: State;
  private now: () => number;
  private secret: string;
  private ttl: number;
  private closed = false;
  private released = false;
  private listeners = new Set<() => void>();
  constructor(private options: AccessOptions) {
    if (Buffer.byteLength(options.secret) < 32) throw new Error('PRESENT_ACCESS_SECRET must contain at least 32 bytes supplied by the operator.');
    this.secret = options.secret; this.now = options.now ?? Date.now; this.ttl = options.sessionTtlMs ?? 7 * 86400_000;
    if (!Number.isSafeInteger(this.ttl) || this.ttl < 1000 || this.ttl > 30 * 86400_000) throw new Error('Invalid session lifetime.');
    mkdirSync(options.directory, { recursive: true, mode: 0o700 });
    const lock = openSync(join(options.directory, 'access.lock'), 'wx', 0o600);
    closeSync(lock);
    try { this.state = existsSync(this.path) ? schema.parse(JSON.parse(readFileSync(this.path, 'utf8'))) : { version: 1, sessions: {}, rooms: {} }; }
    catch (error) { unlinkSync(join(options.directory, 'access.lock')); throw error; }
  }
  private get path() { return join(this.options.directory, 'access.json'); }
  private commit(change: (draft: State) => void) {
    if (this.closed) throw new AccessError('Access store unavailable.', 503);
    const draft = structuredClone(this.state); change(draft);
    const temp = `${this.path}.${id()}.tmp`;
    let renamed = false;
    try {
      const fd = openSync(temp, 'wx', 0o600);
      try { writeFileSync(fd, JSON.stringify(draft)); fsyncSync(fd); } finally { closeSync(fd); }
      renameSync(temp, this.path); renamed = true;
      const dir = openSync(this.options.directory, 'r');
      try { fsyncSync(dir); } finally { closeSync(dir); }
      this.state = draft;
    } catch (error) {
      // A failed directory fsync has an ambiguous durable outcome: deny all access until restart.
      if (renamed) this.closed = true;
      if (existsSync(temp)) unlinkSync(temp);
      if (renamed) this.notify();
      throw error;
    }
    this.notify();
  }
  private notify() { for (const listener of this.listeners) try { listener(); } catch { /* Other subscribers must still be invalidated. */ } }
  subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  close() { if (this.released) return; this.released = true; this.closed = true; this.notify(); this.listeners.clear(); if (existsSync(join(this.options.directory, 'access.lock'))) unlinkSync(join(this.options.directory, 'access.lock')); }
  private sign(payload: string) { return createHmac('sha256', this.secret).update(`present-session-v1:${payload}`).digest('base64url'); }
  createSession() {
    const userId = id(), expiresAt = this.now() + this.ttl;
    this.commit(state => {
      for (const [sid, session] of Object.entries(state.sessions)) if (session.expiresAt <= this.now()) delete state.sessions[sid];
      if (Object.keys(state.sessions).length >= 1000) throw new AccessError('Session capacity reached.', 503);
      state.sessions[userId] = { expiresAt, revoked: false };
    });
    const payload = Buffer.from(JSON.stringify({ userId, expiresAt })).toString('base64url');
    return { userId, expiresAt, token: `${payload}.${this.sign(payload)}` };
  }
  identity(token: string): { userId: string; expiresAt: number } {
    if (this.closed) throw new AccessError('Access store unavailable.', 503);
    if (typeof token !== 'string' || token.length > 512) throw new AccessError('Session required.', 401);
    const [payload, signature, extra] = token.split('.');
    const expected = Buffer.from(this.sign(payload ?? ''));
    if (!payload || !signature || extra || Buffer.byteLength(signature) !== expected.length || !timingSafeEqual(Buffer.from(signature), expected)) throw new AccessError('Session required.', 401);
    let claims: { userId: string; expiresAt: number };
    try { claims = z.object({ userId: key, expiresAt: z.number().int() }).parse(JSON.parse(Buffer.from(payload, 'base64url').toString())); } catch { throw new AccessError('Session required.', 401); }
    const record = this.state.sessions[claims.userId];
    if (!record || record.revoked || record.expiresAt !== claims.expiresAt || claims.expiresAt <= this.now()) throw new AccessError('Session expired or revoked.', 401);
    return claims;
  }
  authorize(token: string, roomId: string, permission: RoomPermission): RoomGrant {
    const identity = this.identity(token);
    if (!/^[a-f0-9]{48}$/.test(roomId)) throw new AccessError();
    const room = this.state.rooms[roomId], membership = room?.members[identity.userId];
    if (!membership || membership.revoked || !roleAllows(membership.role, permission) || (membership.inviteId && room.invites[membership.inviteId]?.revoked !== false)) throw new AccessError();
    return { ...identity, roomId, role: membership.role };
  }
  createRoom(token: string): RoomGrant {
    const who = this.identity(token), roomId = id();
    this.commit(state => {
      if (Object.keys(state.rooms).length >= 1000) throw new AccessError('Room capacity reached.', 503);
      state.rooms[roomId] = { members: { [who.userId]: { role: 'owner', revoked: false } }, invites: {} };
    });
    return this.authorize(token, roomId, 'read');
  }
  invite(token: string, roomId: string, input: { role: 'editor' | 'viewer'; ttlMs: number; maxUses: number }): RoomInvite {
    this.authorize(token, roomId, 'invite');
    if (!['editor', 'viewer'].includes(input.role) || !Number.isInteger(input.ttlMs) || input.ttlMs < 1000 || input.ttlMs > 7 * 86400_000 || !Number.isInteger(input.maxUses) || input.maxUses < 1 || input.maxUses > 10) throw new AccessError('Invalid invite bounds.', 400);
    const inviteId = id(), secret = randomBytes(32).toString('base64url'), inviteToken = `${roomId}.${inviteId}.${secret}`, expiresAt = this.now() + input.ttlMs;
    this.commit(state => {
      if (Object.keys(state.rooms[roomId].invites).length >= 1000) throw new AccessError('Invite capacity reached.', 503);
      state.rooms[roomId].invites[inviteId] = { digest: hash(inviteToken), role: input.role, expiresAt, maxUses: input.maxUses, uses: 0, revoked: false };
    });
    return { id: inviteId, token: inviteToken, expiresAt, role: input.role, maxUses: input.maxUses };
  }
  join(token: string, inviteToken: string): RoomGrant {
    const who = this.identity(token);
    if (typeof inviteToken !== 'string' || !/^[a-f0-9]{48}\.[a-f0-9]{48}\.[A-Za-z0-9_-]{43}$/.test(inviteToken)) throw new AccessError('Invite unavailable.');
    const [roomId, inviteId] = inviteToken.split('.');
    this.commit(state => {
      const room = state.rooms[roomId], invite = room?.invites[inviteId];
      if (!invite || invite.digest !== hash(inviteToken) || invite.revoked || invite.expiresAt <= this.now()) throw new AccessError('Invite unavailable.');
      const existing = room.members[who.userId];
      if (existing?.revoked) throw new AccessError();
      if (existing) return; // Never promote an existing viewer by replaying an editor invite.
      if (invite.uses >= invite.maxUses || Object.keys(room.members).length >= 1000) throw new AccessError('Invite unavailable.');
      invite.uses++; room.members[who.userId] = { role: invite.role, inviteId, revoked: false };
    });
    return this.authorize(token, roomId, 'read');
  }
  leave(token: string, roomId: string) {
    const grant = this.authorize(token, roomId, 'read');
    if (grant.role === 'owner') throw new AccessError('The owner must retain room ownership.', 409);
    this.commit(state => { state.rooms[roomId].members[grant.userId].revoked = true; });
  }
  revokeInvite(token: string, roomId: string, inviteId: string) {
    this.authorize(token, roomId, 'revoke');
    this.commit(state => {
      const room = state.rooms[roomId], invite = room.invites[inviteId];
      if (!invite) throw new AccessError('Invite unavailable.', 404);
      invite.revoked = true;
      for (const member of Object.values(room.members)) if (member.inviteId === inviteId) member.revoked = true;
    });
  }
  revokeMember(token: string, roomId: string, userId: string) {
    this.authorize(token, roomId, 'revoke');
    this.commit(state => {
      const member = state.rooms[roomId].members[userId];
      if (!member || member.role === 'owner') throw new AccessError();
      member.revoked = true;
    });
  }
  revokeSession(token: string) {
    const who = this.identity(token); this.commit(state => { state.sessions[who.userId].revoked = true; });
  }
}
