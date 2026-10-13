import { createHash } from 'node:crypto';
import { closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, unlinkSync } from 'node:fs';
import { dirname, isAbsolute } from 'node:path';
import { z } from 'zod';
import { dataPath } from '../data-path';
import { writeDurableFile } from '../durable-file';
import { storedWorkJobSchema } from '../../shared/work';
import { AgentError } from '../agents/contract';
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const ledgerSchema = z.object({ version: z.literal(1), scopeHash: z.string(), maxTurns: z.number().int().min(1).max(2), reservations: z.array(z.object({ dispatchHash: z.string(), modelHash: z.string(), at: z.string() }).strict()).max(2) }).strict();
/** Private root-run story fence, inactive unless all inputs are explicitly configured. */
export function reserveProjectStoryTurn(jobId: string, dispatchId: string, model: string) {
  const path = process.env.PRESENT_PROJECT_STORY_BUDGET_FILE, room = process.env.PRESENT_PROJECT_STORY_ROOM, card = process.env.PRESENT_PROJECT_STORY_CARD, rawMax = process.env.PRESENT_PROJECT_STORY_MAX_TURNS;
  if (!path && !room && !card && !rawMax) return;
  const max = Number(rawMax);
  if (!path || !isAbsolute(path) || !room || !/^[a-f0-9]{24,64}$/.test(room) || !card || card.length > 100 || !rawMax || !/^[12]$/.test(rawMax)) throw new AgentError('The private project story budget is incomplete.', 503);
  if (!/^[a-f0-9]{32}$/.test(jobId)) throw new AgentError('Project story job identity is invalid.', 409);
  const job = storedWorkJobSchema.parse(JSON.parse(readFileSync(dataPath('work-jobs', jobId + '.json'), 'utf8')));
  if (job.roomId !== room || job.objectId !== card) return;
  if (!job.project) throw new AgentError('The fenced project story requires a registered source.', 409);
  if (!model || model === 'unknown') throw new AgentError('Project story exact model was not confirmed.', 409);
  const scopeHash = hash(JSON.stringify([room, card, job.project.sourceFingerprint, job.project.snapshotId]));
  const lock = path + '.lock'; let fd: number | undefined;
  try {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 }); fd = openSync(lock, 'wx', 0o600);
    let ledger: z.infer<typeof ledgerSchema> = { version: 1, scopeHash, maxTurns: max, reservations: [] };
    if (existsSync(path)) { const stat = lstatSync(path); if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0 || stat.size > 8000) throw new Error(); ledger = ledgerSchema.parse(JSON.parse(readFileSync(path, 'utf8'))); }
    if (ledger.scopeHash !== scopeHash || ledger.maxTurns !== max) throw new AgentError('Project story budget scope changed. No turn started.', 409);
    if (ledger.reservations.length >= max) throw new AgentError('Project story budget exhausted. No turn started.', 429);
    ledger.reservations.push({ dispatchHash: hash(dispatchId), modelHash: hash(model), at: new Date().toISOString() });
    writeDurableFile(path, JSON.stringify(ledger));
  } catch (error) { if (error instanceof AgentError) throw error; throw new AgentError('Project story budget could not be reserved. No turn started.', 503); }
  finally { if (fd !== undefined) { closeSync(fd); unlinkSync(lock); } }
}
