import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { reserveNativeSceneTurn } from '../server/agents/native-scene-budget';
import { withRequestTrace, type TraceReceipt } from '../server/agents/request-trace';
const room = 'b'.repeat(32), keys = ['PRESENT_NATIVE_SCENE_BUDGET_FILE', 'PRESENT_NATIVE_SCENE_MAX_TURNS', 'PRESENT_NATIVE_SCENE_BUDGET_ROOM'];
async function fixture(run: (file: string) => Promise<void>) {
  const directory = mkdtempSync(join(tmpdir(), 'present-budget-')), file = join(directory, 'budget.json'), previous = keys.map(k => process.env[k]);
  process.env[keys[0]] = file; process.env[keys[1]] = '2'; process.env[keys[2]] = room;
  try { await run(file); } finally { keys.forEach((k, i) => { if (previous[i] === undefined) delete process.env[k]; else process.env[k] = previous[i]; }); rmSync(directory, { recursive: true, force: true }); }
}
const reserve = (requestId: string, sink?: (receipt: TraceReceipt) => void) => withRequestTrace({ roomId: room, requestId, provider: 'sol', sink: sink ?? (() => {}) }, async () => reserveNativeSceneTurn('gpt-6.1-sol'));
test('durable reservations survive another process and exhaustion precedes dispatch', async () => fixture(async file => {
  const events: TraceReceipt[] = []; await reserve('one', r => events.push(r));
  assert.equal(statSync(file).mode & 0o777, 0o600); assert.ok(events.some(e => e.stage === 'turn_reserved' && e.turnCount === 1));
  const helper = new URL('../server/agents/native-scene-budget.ts', import.meta.url).href, tracing = new URL('../server/agents/request-trace.ts', import.meta.url).href;
  execFileSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', `const {reserveNativeSceneTurn}=await import(${JSON.stringify(helper)}); const {withRequestTrace}=await import(${JSON.stringify(tracing)}); await withRequestTrace({roomId:${JSON.stringify(room)},requestId:'two',provider:'sol',sink:()=>{}},async()=>reserveNativeSceneTurn('gpt-6.1-sol'));`], { cwd: process.cwd(), env: process.env });
  const ledger = JSON.parse(readFileSync(file, 'utf8')); assert.equal(ledger.count, 2); assert.equal(ledger.reservations.length, 2);
  assert.doesNotMatch(JSON.stringify(ledger), /gpt-6|one|two|bbbbbbbb/);
  await assert.rejects(reserve('three'), /exhausted/); assert.equal(JSON.parse(readFileSync(file, 'utf8')).count, 2);
}));
test('budget scope/config mismatch, corruption and retained locks all fail closed', async () => fixture(async file => {
  await reserve('one'); process.env[keys[1]] = '3'; await assert.rejects(reserve('mismatch'), /does not match/);
  process.env[keys[1]] = '2'; writeFileSync(file, '{invalid', { mode: 0o600 }); await assert.rejects(reserve('corrupt'), /could not be reserved/);
  writeFileSync(file + '.lock', 'retained', { mode: 0o600 }); await assert.rejects(reserve('locked'), /could not be reserved/);
}));
test('no configuration is inert; non-smoke room and discovery context cannot consume the scoped budget', async () => fixture(async file => {
  await withRequestTrace({ roomId: 'c'.repeat(32), requestId: 'unrelated', provider: 'sol', sink: () => {} }, async () => reserveNativeSceneTurn('gpt-6.1-sol'));
  reserveNativeSceneTurn('gpt-6.1-sol'); assert.throws(() => readFileSync(file), /ENOENT/);
  keys.forEach(k => delete process.env[k]); await reserve('no-config'); assert.throws(() => readFileSync(file), /ENOENT/);
}));
