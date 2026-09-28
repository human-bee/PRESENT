import { createHash } from 'node:crypto';
import { z } from 'zod';
import { AgentError } from './contract';

const identity = z.object({ roomId: z.string().regex(/^[a-f0-9]{24,64}$/), sessionId: z.string().regex(/^[a-zA-Z0-9_-]{16,100}$/) });
const toolSchema = identity.extend({
  actor: z.string().min(1).max(100), callId: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/),
  name: z.string().min(1).max(64), arguments: z.record(z.string(), z.unknown()),
});
export type OwnedVoiceTool = z.infer<typeof toolSchema>;
export const VOICE_OWNERSHIP_LIMITS = Object.freeze({ resultBytes: 262144, listenerBytes: 4194304, totalBytes: 33554432 });
type Owner = {
  actor: string; capture: 'personal' | 'shared'; name: string; roomId: string; sessionId: string; expiresAt: number; active: boolean;
  resultBytes: number; abort: AbortController; calls: Map<string, { fingerprint: string; result: Promise<unknown> }>;
};
type Options = { now?: () => number; ttlMs?: number; maxRooms?: number; maxCalls?: number };

// This coordinates the trusted local room server; it is not user authentication.
export class VoiceOwnership {
  private rooms = new Map<string, Owner>();
  private cachedBytes = 0;
  private now: () => number;
  private ttlMs: number;
  private maxRooms: number;
  private maxCalls: number;
  constructor(options: Options = {}) {
    this.now = options.now ?? Date.now; this.ttlMs = options.ttlMs ?? 90000;
    this.maxRooms = options.maxRooms ?? 100; this.maxCalls = options.maxCalls ?? 1000;
  }
  private prune() {
    for (const [roomId, owner] of this.rooms) if (owner.expiresAt <= this.now()) { owner.abort.abort(); this.cachedBytes -= owner.resultBytes; this.rooms.delete(roomId); }
  }
  private owner(roomId: string, sessionId: string): Owner {
    if (!identity.safeParse({ roomId, sessionId }).success) throw new AgentError('Invalid voice session identity.', 400);
    this.prune();
    const owner = this.rooms.get(`${roomId}:${sessionId}`);
    if (!owner || owner.sessionId !== sessionId) throw new AgentError('This voice listener is no longer active. Start voice to reconnect.', 410);
    return owner;
  }
  begin(roomId: string, actor: string, sessionId: string, capture: 'personal' | 'shared' = 'shared', name = 'Participant'): void {
    if (!identity.extend({ actor: z.string().min(1).max(100) }).safeParse({ roomId, actor, sessionId }).success) throw new AgentError('Invalid voice session identity.', 400);
    this.prune();
    if (this.rooms.has(`${roomId}:${sessionId}`)) throw new AgentError('This voice session identity is already in use.', 409);
    const listeners = [...this.rooms.values()].filter(owner => owner.roomId === roomId);
    if (listeners.some(owner => capture === 'shared' || owner.capture === 'shared' || owner.actor === actor)) throw new AgentError('A conflicting listener is active. Shared microphones cannot overlap personal listeners, and each person has one personal listener.', 409);
    if (listeners.length >= 24) throw new AgentError('This room has reached its personal listener limit.', 429);
    if (this.rooms.size >= this.maxRooms) throw new AgentError('This server has reached its voice listener limit.', 503);
    this.rooms.set(`${roomId}:${sessionId}`, { actor, roomId, capture, name: name.slice(0, 80), sessionId, active: false, expiresAt: this.now() + this.ttlMs, resultBytes: 0, abort: new AbortController(), calls: new Map() });
  }
  activate(roomId: string, sessionId: string): void {
    const owner = this.owner(roomId, sessionId); owner.active = true; owner.expiresAt = this.now() + this.ttlMs;
  }
  heartbeat(roomId: string, sessionId: string): void {
    const owner = this.owner(roomId, sessionId);
    if (!owner.active) throw new AgentError('The voice connection is still starting.', 409);
    owner.expiresAt = this.now() + this.ttlMs;
  }
  stop(roomId: string, sessionId: string): void {
    if (!identity.safeParse({ roomId, sessionId }).success) throw new AgentError('Invalid voice session identity.', 400);
    this.prune();
    const owner = this.rooms.get(`${roomId}:${sessionId}`);
    if (owner) { owner.abort.abort(); this.cachedBytes -= owner.resultBytes; }
    this.rooms.delete(`${roomId}:${sessionId}`);
  }
  /** Counts only; no room identities, arguments or results are exposed. */
  snapshot() { this.prune(); return Object.freeze({ listeners: this.rooms.size, cachedResultBytes: this.cachedBytes, calls: [...this.rooms.values()].reduce((sum, owner) => sum + owner.calls.size, 0), maxListeners: this.maxRooms, maxCallsPerListener: this.maxCalls }); }
  provenance(roomId: string, sessionId: string) { const owner = this.owner(roomId, sessionId); return { actor: owner.actor, name: owner.name, capture: owner.capture }; }
  runTool<T>(raw: unknown, execute: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const parsed = toolSchema.safeParse(raw);
    if (!parsed.success) throw new AgentError('A valid voice session and Realtime call ID are required.', 400);
    const input = parsed.data;
    const owner = this.owner(input.roomId, input.sessionId);
    if (!owner.active || owner.actor !== input.actor) throw new AgentError('This voice tool does not belong to the active listener.', 409);
    let encoded: string;
    try {
      encoded = JSON.stringify({ name: input.name, arguments: input.arguments });
      if (encoded.length > 65536) throw new Error();
    } catch { throw new AgentError('The voice tool arguments are too large or invalid.', 400); }
    const fingerprint = createHash('sha256').update(encoded).digest('hex');
    const existing = owner.calls.get(input.callId);
    if (existing) {
      if (existing.fingerprint !== fingerprint) throw new AgentError('This Realtime call ID already belongs to another request.', 409);
      return existing.result as Promise<T>;
    }
    // Do not evict remembered call IDs and accidentally permit a replay.
    if (owner.calls.size >= this.maxCalls || owner.resultBytes >= VOICE_OWNERSHIP_LIMITS.listenerBytes || this.cachedBytes >= VOICE_OWNERSHIP_LIMITS.totalBytes) throw new AgentError('This voice session is full. Reconnect to keep using room tools.', 409);
    const result = Promise.resolve().then(() => {
      if (this.owner(input.roomId, input.sessionId) !== owner) throw new AgentError('This voice listener has ended.', 410);
      return execute(owner.abort.signal);
    }).then(value => {
      let bytes: number, encoded: string;
      try { encoded = JSON.stringify(value ?? null); bytes = Buffer.byteLength(encoded, 'utf8'); }
      catch { throw new AgentError('Tool finished but its result could not be encoded. Do not replay this action.', 502); }
      if (bytes > VOICE_OWNERSHIP_LIMITS.resultBytes || owner.resultBytes + bytes > VOICE_OWNERSHIP_LIMITS.listenerBytes || this.cachedBytes + bytes > VOICE_OWNERSHIP_LIMITS.totalBytes) throw new AgentError('Tool finished but its result exceeded the voice receipt limit. Do not replay this action.', 502);
      if (this.rooms.get(`${input.roomId}:${input.sessionId}`) === owner) { owner.resultBytes += bytes; this.cachedBytes += bytes; }
      // Retain a detached, immutable JSON receipt: later store mutations cannot
      // grow the cache or change the outcome of an identical replay.
      const receipt = value === undefined ? undefined : JSON.parse(encoded);
      const pending: unknown[] = [receipt];
      while (pending.length) {
        const item = pending.pop();
        if (item && typeof item === 'object') { Object.freeze(item); for (const child of Object.values(item)) pending.push(child); }
      }
      return receipt as T;
    }).catch(cause => {
      // Cache a compact failure as well; never rerun an uncertain mutation.
      throw new AgentError(cause instanceof Error ? cause.message.slice(0, 2000) : 'Voice tool failed.', cause instanceof AgentError ? cause.status : 502);
    });
    owner.calls.set(input.callId, { fingerprint, result });
    return result;
  }
}
export const voiceOwnership = new VoiceOwnership();
