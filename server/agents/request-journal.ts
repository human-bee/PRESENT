import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { dataPath } from '../data-path';
import { AgentError } from './contract';

export const requestIdSchema = z.string().regex(/^[a-zA-Z0-9:_.-]{1,120}$/);
const identitySchema = z.object({
  roomId: z.string().regex(/^[a-f0-9]{24,64}$/), actor: z.string().min(1).max(100), requestId: requestIdSchema,
});
type Identity = z.infer<typeof identitySchema>;
const receiptSchema = z.object({
  fingerprint: z.string(), status: z.enum(['running', 'completed', 'failed']), at: z.number(),
  result: z.record(z.string(), z.unknown()).optional(),
});
type Receipt = z.infer<typeof receiptSchema>;
type Options = { directory?: string; maxEntries?: number };

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)]));
  return value;
}
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');

/** Completed requests survive disconnect/restart. Uncertain attempts never silently run again. */
export class RequestJournal {
  private active = new Map<string, { fingerprint: string; result: Promise<object> }>();
  constructor(private options: Options = {}) {}

  async run<T extends object>(identity: Identity, input: unknown, execute: () => Promise<T>): Promise<T & { requestId: string; replayed: boolean }> {
    identity = identitySchema.parse(identity);
    const key = digest(identity), fingerprint = digest(input), dir = this.options.directory ?? dataPath('agent-requests');
    const file = join(dir, `${key}.json`), pending = this.active.get(key);
    const conflict = () => new AgentError('This request identity belongs to different content. Start a new request for the changed instruction.', 409);
    if (pending) {
      if (pending.fingerprint !== fingerprint) throw conflict();
      return { ...await pending.result as T, requestId: identity.requestId, replayed: true };
    }
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    if (existsSync(file)) {
      let saved: Receipt;
      try { saved = receiptSchema.parse(JSON.parse(readFileSync(file, 'utf8'))); }
      catch { throw new AgentError('This request receipt could not be read. Check the room before starting another request.', 409); }
      if (saved.fingerprint !== fingerprint) throw conflict();
      if (saved.status === 'completed' && saved.result) return { ...saved.result as T, requestId: identity.requestId, replayed: true };
      throw new AgentError('The earlier attempt did not record a completed result. Check the room, then start a new request if needed.', 409);
    }
    if (readdirSync(dir).filter(name => name.endsWith('.json')).length >= (this.options.maxEntries ?? 2000)) {
      throw new AgentError('The server request history is full. Existing results can still be recovered.', 429);
    }
    const save = (receipt: Receipt) => {
      const bytes = JSON.stringify(receipt);
      if (Buffer.byteLength(bytes) > 256_000) throw new AgentError('The request result is too large to save for recovery. Check the room before retrying.', 413);
      const temporary = `${file}.${randomUUID()}.tmp`;
      writeFileSync(temporary, bytes, { mode: 0o600 }); renameSync(temporary, file);
    };
    save({ fingerprint, status: 'running', at: Date.now() });
    const result = Promise.resolve().then(execute).then(value => {
      save({ fingerprint, status: 'completed', at: Date.now(), result: JSON.parse(JSON.stringify(value)) });
      return value;
    }).catch(error => {
      // A failure can follow a partial commit. Retain its identity rather than redispatching blindly.
      save({ fingerprint, status: 'failed', at: Date.now() });
      throw error;
    }).finally(() => this.active.delete(key));
    this.active.set(key, { fingerprint, result });
    return { ...await result, requestId: identity.requestId, replayed: false };
  }
}

export const requestJournal = new RequestJournal();
