import { createHash } from 'node:crypto';
import { z } from 'zod';
import { AgentError } from './contract';

const identity = z.object({ roomId: z.string().regex(/^[a-f0-9]{24,64}$/), sessionId: z.string().regex(/^[a-zA-Z0-9_-]{16,100}$/) });
const toolSchema = identity.extend({
  actor: z.string().min(1).max(100), callId: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/),
  name: z.string().min(1).max(64), arguments: z.record(z.string(), z.unknown()),
});
export type OwnedVoiceTool = z.infer<typeof toolSchema>;
type Owner = {
  actor: string; sessionId: string; expiresAt: number; active: boolean;
  calls: Map<string, { fingerprint: string; result: Promise<unknown> }>;
};
type Options = { now?: () => number; ttlMs?: number; maxRooms?: number; maxCalls?: number };

// This coordinates the trusted local room server; it is not user authentication.
export class VoiceOwnership {
  private rooms = new Map<string, Owner>();
  private now: () => number;
  private ttlMs: number;
  private maxRooms: number;
  private maxCalls: number;
  constructor(options: Options = {}) {
    this.now = options.now ?? Date.now; this.ttlMs = options.ttlMs ?? 90000;
    this.maxRooms = options.maxRooms ?? 100; this.maxCalls = options.maxCalls ?? 1000;
  }
  private prune() {
    for (const [roomId, owner] of this.rooms) if (owner.expiresAt <= this.now()) this.rooms.delete(roomId);
  }
  private owner(roomId: string, sessionId: string): Owner {
    if (!identity.safeParse({ roomId, sessionId }).success) throw new AgentError('Invalid voice session identity.', 400);
    this.prune();
    const owner = this.rooms.get(roomId);
    if (!owner || owner.sessionId !== sessionId) throw new AgentError('This voice listener is no longer active. Start voice to reconnect.', 410);
    return owner;
  }
  begin(roomId: string, actor: string, sessionId: string): void {
    if (!identity.extend({ actor: z.string().min(1).max(100) }).safeParse({ roomId, actor, sessionId }).success) throw new AgentError('Invalid voice session identity.', 400);
    this.prune();
    if (this.rooms.has(roomId)) throw new AgentError('Someone in this room is already listening for PRESENT. Stop that listener before starting another.', 409);
    if (this.rooms.size >= this.maxRooms) throw new AgentError('This server has reached its voice listener limit.', 503);
    this.rooms.set(roomId, { actor, sessionId, active: false, expiresAt: this.now() + this.ttlMs, calls: new Map() });
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
    if (this.rooms.get(roomId)?.sessionId === sessionId) this.rooms.delete(roomId);
  }
  runTool<T>(raw: unknown, execute: () => Promise<T>): Promise<T> {
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
    if (owner.calls.size >= this.maxCalls) throw new AgentError('This voice session is full. Reconnect to keep using room tools.', 409);
    const result = Promise.resolve().then(() => {
      if (this.owner(input.roomId, input.sessionId) !== owner) throw new AgentError('This voice listener has ended.', 410);
      return execute();
    });
    owner.calls.set(input.callId, { fingerprint, result });
    return result;
  }
}
export const voiceOwnership = new VoiceOwnership();
