#!/usr/bin/env node
// Test-only executor: real stdio, durable remote turns, explicit file release gates.
// It uses no provider, account, credential, or network. Never install as a real CLI.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

const root = process.env.CODEX_HOME;
if (!root || !existsSync(join(root, 'CONTROLLED_TEST_ONLY'))) throw new Error('Controlled test directory required.');
const turns = join(root, 'turns'); mkdirSync(turns, { recursive: true });
const log = entry => appendFileSync(join(root, 'events.jsonl'), `${JSON.stringify({ pid: process.pid, ...entry })}\n`);
const send = message => { if (!process.stdout.destroyed) process.stdout.write(`${JSON.stringify(message)}\n`); };
const path = id => join(turns, `${id}.json`);
const read = id => JSON.parse(readFileSync(path(id), 'utf8'));
const save = state => writeFileSync(path(state.threadId), JSON.stringify(state));
const emit = (state, stale = false) => {
  const output = JSON.stringify({ title: stale ? 'Stale rejected result' : 'Recovered controlled result', format: 'markdown', body: `Result for ${state.dispatchId}${stale ? ' (stale)' : ''}.` });
  const turn = { id: state.turnId, status: 'completed', items: [{ type: 'userMessage', clientId: state.dispatchId }, { type: 'agentMessage', text: output, phase: 'final_answer' }] };
  if (!stale && state.turn.status !== 'completed') {
    writeFileSync(join(state.cwd, 'receipt.txt'), `${state.dispatchId}\n`);
    writeFileSync(join(state.cwd, 'proof.test.mjs'), "import assert from 'node:assert/strict'; import { readFileSync } from 'node:fs'; assert.match(readFileSync(new URL('./receipt.txt', import.meta.url), 'utf8'), /^present-work:/);\n");
    execFileSync(process.execPath, ['--test', 'proof.test.mjs'], { cwd: state.cwd, stdio: 'ignore' });
    turn.items.push({ type: 'commandExecution', id: `proof-${state.turnId}`, command: `${process.execPath} --test proof.test.mjs`, status: 'completed', exitCode: 0 });
    state.turn = turn; save(state);
  }
  log({ method: stale ? 'late-output' : 'released', threadId: state.threadId, turnId: state.turnId, dispatchId: state.dispatchId });
  send({ method: 'turn/completed', params: { threadId: state.threadId, turn } });
};
let active;
const poll = setInterval(() => {
  if (!active) return;
  const state = read(active);
  if (state.turn?.status === 'inProgress' && existsSync(join(root, `${state.turnId}.release`))) emit(state);
}, 20);
log({ method: 'process-start', cwd: process.cwd() });
const lines = createInterface({ input: process.stdin });
lines.on('line', line => {
  const message = JSON.parse(line), p = message.params ?? {};
  log({ method: message.method, threadId: p.threadId, dispatchId: p.clientUserMessageId, cwd: p.cwd, model: p.model });
  if (message.id === undefined) return;
  let result = {};
  if (message.method === 'initialize') result = { userAgent: 'present-controlled-test' };
  else if (message.method === 'account/read') result = { account: { type: 'chatgpt' } };
  else if (message.method === 'model/list') result = { data: ['gpt-6.1-sol', 'gpt-6-luna', 'gpt-6-astra'].map(model => ({ id: model, model, supportedReasoningEfforts: ['low', 'medium', 'high'].map(reasoningEffort => ({ reasoningEffort })), serviceTiers: [{ id: 'priority', name: 'Fast' }] })), nextCursor: null };
  else if (message.method === 'thread/start' || message.method === 'thread/resume') {
    const id = p.threadId ?? `controlled-${createHash('sha256').update(p.cwd).digest('hex').slice(0, 24)}`;
    const state = message.method === 'thread/resume' ? read(id) : { threadId: id, cwd: p.cwd, model: p.model };
    if (state.cwd !== p.cwd || state.model !== p.model) throw new Error('Resume affinity changed.');
    save(state); active = id;
    result = { thread: { id }, cwd: state.cwd, model: state.model, runtimeWorkspaceRoots: [state.cwd], activePermissionProfile: { id: 'present-work' } };
  } else if (message.method === 'turn/start') {
    const state = read(p.threadId);
    if (state.turn) throw new Error('Duplicate controlled dispatch.');
    state.turnId = `${state.threadId}-turn-1`; state.dispatchId = p.clientUserMessageId;
    state.turn = { id: state.turnId, status: 'inProgress', items: [{ type: 'userMessage', clientId: state.dispatchId }] }; save(state);
    result = { turn: { id: state.turnId } };
  } else if (message.method === 'thread/read') {
    const state = read(p.threadId); result = { thread: { id: state.threadId, model: state.model, turns: state.turn ? [state.turn] : [] } };
  } else if (message.method === 'turn/interrupt') {
    // Adversarial callback while revocation/shutdown is in flight. It does not
    // alter the retained remote turn; safe resume must reconcile that same turn.
    emit(read(p.threadId), true);
  } else throw new Error(`Unexpected controlled RPC: ${message.method}`);
  send({ id: message.id, result });
});
lines.on('close', () => { clearInterval(poll); log({ method: 'stdin-closed' }); process.exit(0); });
process.on('SIGTERM', () => { clearInterval(poll); log({ method: 'process-stopped' }); process.exit(0); });
