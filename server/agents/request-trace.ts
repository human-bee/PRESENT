import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import { appendFileSync, mkdirSync, statSync, renameSync, chmodSync } from 'node:fs';
import { join } from 'node:path';

export type TraceStage = 'accepted' | 'planning' | 'turn_reserved' | 'provider_dispatch' | 'provider_result' | 'validation_failed' | 'validated' | 'transaction_committed' | 'scene_committed' | 'completed' | 'failed' | 'aborted' | 'timed_out';
export type TraceDetail = { model?: string; modelSource?: 'requested' | 'confirmed'; transport?: 'codex' | 'openai' | 'cerebras' | 'typesafe'; turnCount?: number; attempt?: number; nodes?: number; tracks?: number; clock?: number; transactionId?: string; replayed?: boolean; errorCode?: 'validation' | 'provider' | 'conflict' | 'unavailable' | 'internal'; status?: number };
export type TraceReceipt = TraceDetail & { version: 1; requestId: string; roomHash: string; provider: string; stage: TraceStage; sequence: number; at: string; elapsedMs: number; sincePreviousMs: number };
type Context = { roomId: string; requestId: string; provider: string; started: number; previous: number; sequence: number; terminal: boolean; lastStage?: TraceStage; signal?: AbortSignal; sink: (receipt: TraceReceipt) => void };
const scope = new AsyncLocalStorage<Context>();
const stages = new Set<TraceStage>(['accepted', 'planning', 'turn_reserved', 'provider_dispatch', 'provider_result', 'validation_failed', 'validated', 'transaction_committed', 'scene_committed', 'completed', 'failed', 'aborted', 'timed_out']);
const token = (value: unknown, max = 120): value is string => typeof value === 'string' && value.length <= max && /^[\w:.-]+$/.test(value);
const round = (value: number) => Math.round(value * 100) / 100;
/** Local diagnostics are bounded and allowlisted: never retain error messages, prompts, pixels, output or credentials. */
function persist(receipt: TraceReceipt) {
  const dir = join(process.cwd(), 'logs'); mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = join(dir, 'canvas-requests.jsonl');
  try { if (statSync(file).size > 5_000_000) renameSync(file, `${file}.previous`); } catch { /* No prior file. */ }
  appendFileSync(file, JSON.stringify(receipt) + '\n', { mode: 0o600 }); chmodSync(file, 0o600);
}
function safeDetail(detail: TraceDetail): TraceDetail {
  const safe: TraceDetail = {};
  if (token(detail.model, 100)) safe.model = detail.model;
  if (detail.modelSource === 'requested' || detail.modelSource === 'confirmed') safe.modelSource = detail.modelSource;
  if (['codex', 'openai', 'cerebras', 'typesafe'].includes(detail.transport ?? '')) safe.transport = detail.transport;
  for (const field of ['turnCount', 'attempt', 'nodes', 'tracks', 'clock', 'status'] as const) if (typeof detail[field] === 'number' && Number.isSafeInteger(detail[field]) && detail[field]! >= 0) safe[field] = detail[field];
  if (token(detail.transactionId)) safe.transactionId = detail.transactionId;
  if (typeof detail.replayed === 'boolean') safe.replayed = detail.replayed;
  if (['validation', 'provider', 'conflict', 'unavailable', 'internal'].includes(detail.errorCode ?? '')) safe.errorCode = detail.errorCode;
  return safe;
}
export function traceRequest(stage: TraceStage, detail: TraceDetail = {}, roomId?: string, requestId?: string) {
  const context = scope.getStore();
  if (!context || context.terminal || !stages.has(stage) || (roomId !== undefined && roomId !== context.roomId) || (requestId !== undefined && requestId !== context.requestId)) return;
  const now = performance.now();
  const terminal = ['completed', 'failed', 'aborted', 'timed_out'].includes(stage);
  const receipt: TraceReceipt = { ...safeDetail(detail), version: 1, requestId: context.requestId,
    roomHash: createHash('sha256').update(context.roomId).digest('hex'), provider: context.provider, stage,
    sequence: ++context.sequence, at: new Date().toISOString(), elapsedMs: round(now - context.started), sincePreviousMs: round(now - context.previous) };
  context.lastStage = stage; context.previous = now; if (terminal) context.terminal = true;
  try { context.sink(receipt); } catch { /* Diagnostics cannot fail or roll back canvas work. */ }
}
export function traceIdentity(): { roomId: string; requestId: string; provider: string } | undefined {
  const context = scope.getStore(); return context ? { roomId: context.roomId, requestId: context.requestId, provider: context.provider } : undefined;
}
export function traceAbortSignal(signal: AbortSignal) { const context = scope.getStore(); if (context) context.signal = signal; }
export async function withRequestTrace<T>(identity: { roomId: string; requestId: string; provider: string; signal?: AbortSignal; sink?: (receipt: TraceReceipt) => void }, run: () => Promise<T>): Promise<T> {
  const existing = scope.getStore();
  if (existing?.requestId === identity.requestId && existing.roomId === identity.roomId) return run();
  const now = performance.now();
  const context: Context = { ...identity, started: now, previous: now, sequence: 0, terminal: false, sink: identity.sink ?? persist };
  return scope.run(context, async () => {
    traceRequest('accepted');
    try { const result = await run(); traceRequest('completed'); return result; }
    catch (error) {
      const name = error instanceof Error ? error.name : '';
      const reason = context.signal?.aborted ? context.signal.reason : undefined;
      const reasonName = reason instanceof Error ? reason.name : '';
      const terminal = name === 'TimeoutError' || reasonName === 'TimeoutError' ? 'timed_out' : context.signal?.aborted || name === 'AbortError' ? 'aborted' : 'failed';
      const status = error && typeof error === 'object' && 'status' in error && typeof error.status === 'number' ? error.status : undefined;
      traceRequest(terminal, { status, errorCode: status === 409 ? 'conflict' : status === 503 ? 'unavailable' : context.lastStage === 'validation_failed' ? 'validation' : context.lastStage === 'provider_dispatch' ? 'provider' : 'internal' });
      throw error;
    }
  });
}
