import { createHash } from 'node:crypto';
import { closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, unlinkSync } from 'node:fs';
import { dirname, isAbsolute } from 'node:path';
import { z } from 'zod';
import { writeDurableFile } from '../durable-file';
import { AgentError } from './contract';
import { traceIdentity, traceRequest } from './request-trace';
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const ledgerSchema = z.object({ version: z.literal(1), roomHash: digest, maxTurns: z.number().int().min(1).max(100), count: z.number().int().min(0).max(100),
  reservations: z.array(z.object({ requestHash: digest, modelMetadataHash: digest, at: z.string().datetime() }).strict()).max(100) }).strict();

/** All configuration is explicit; the fenced room permits native scenes/controls only. */
export function nativeSceneSmokeRoom(roomId: string): boolean {
  const file = process.env.PRESENT_NATIVE_SCENE_BUDGET_FILE, rawMax = process.env.PRESENT_NATIVE_SCENE_MAX_TURNS, room = process.env.PRESENT_NATIVE_SCENE_BUDGET_ROOM;
  if (!file && !rawMax && !room) return false;
  const maxTurns = Number(rawMax);
  if (!file || !isAbsolute(file) || !rawMax || !/^\d+$/.test(rawMax) || !Number.isSafeInteger(maxTurns) || maxTurns < 1 || maxTurns > 100 || !room || !/^[a-f0-9]{24,64}$/.test(room)) throw new AgentError('The native scene smoke budget is not fully configured.', 503);
  return roomId === room;
}
/** Operator-only smoke fence. Durable reservations are never refunded, including interrupted/failed sends. */
export function reserveNativeSceneTurn(model: string) {
  const identity = traceIdentity();
  if (!nativeSceneSmokeRoom(identity?.roomId ?? '') || !identity) return;
  const file = process.env.PRESENT_NATIVE_SCENE_BUDGET_FILE!, room = process.env.PRESENT_NATIVE_SCENE_BUDGET_ROOM!, maxTurns = Number(process.env.PRESENT_NATIVE_SCENE_MAX_TURNS);
  const lock = file + '.lock'; let fd: number | undefined;
  try {
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    fd = openSync(lock, 'wx', 0o600); // Concurrent or crash-retained locks fail closed; no public reset.
    let ledger: z.infer<typeof ledgerSchema> = { version: 1, roomHash: hash(room), maxTurns, count: 0, reservations: [] };
    if (existsSync(file)) {
      const stat = lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0 || stat.size > 64_000) throw new Error('Invalid private budget file');
      ledger = ledgerSchema.parse(JSON.parse(readFileSync(file, 'utf8')));
    }
    if (ledger.roomHash !== hash(room) || ledger.maxTurns !== maxTurns || ledger.count !== ledger.reservations.length) throw new AgentError('The native scene smoke budget does not match its configured scope.', 503);
    if (ledger.count >= maxTurns) throw new AgentError('The native scene smoke turn budget is exhausted. No turn was dispatched.', 429);
    ledger.count++;
    ledger.reservations.push({ requestHash: hash(identity.requestId), modelMetadataHash: hash(JSON.stringify({ provider: identity.provider, model })), at: new Date().toISOString() });
    writeDurableFile(file, JSON.stringify(ledger)); // File and directory fsync before the actual RPC.
    traceRequest('turn_reserved', { model, modelSource: 'confirmed', transport: 'codex', turnCount: ledger.count });
  } catch (error) {
    if (error instanceof AgentError) throw error;
    throw new AgentError('The native scene smoke budget could not be reserved. No turn was dispatched.', 503);
  } finally {
    if (fd !== undefined) { closeSync(fd); unlinkSync(lock); }
  }
}
