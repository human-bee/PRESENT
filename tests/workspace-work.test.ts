import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { agentModels } from '../server/agents/contract';
import type { WireMessage } from '../server/agents/codex-wire';
import { createRunWorkspaceWork, type WorkspaceWire } from '../server/agents/workspace-work';
import type { WorkExecutionState } from '../shared/work-execution';

const ID = 'a'.repeat(32), THREAD = 'thread-work', TURN = 'turn-work';
const artifact = JSON.stringify({ title: 'Source prepared', format: 'markdown', body: 'The source is ready.' });
const ready = (): WorkExecutionState => ({ workspaceId: ID, threadId: null, turnId: null, dispatchId: null, phase: 'ready', commands: [] });
type Options = { pending?: boolean; failed?: boolean; commands?: boolean; output?: string; permission?: 'missing' | 'wrong'; recovery?: object[]; configured?: boolean };
type Call = { method: string; params: Record<string, unknown> };
function fixture(options: Options = {}) {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'present-workspace-runner-'))), calls: Call[] = [], wires: FakeWire[] = [];
  let latest = ready(), started: () => void = () => {};
  const turnStarted = new Promise<void>(resolve => { started = resolve; });
  class FakeWire implements WorkspaceWire {
    closed = false; listeners = new Set<(message: WireMessage) => void>(); stopped = Promise.resolve();
    constructor(readonly options: { cwd: string; config: Record<string, unknown> }) {}
    send(_message: WireMessage) {}
    close() { this.closed = true; }
    emit(method: string, params: unknown) { for (const listener of this.listeners) listener({ method, params }); }
    async request<T>(method: string, raw: unknown): Promise<T> {
      const params = raw as Record<string, unknown>; calls.push({ method, params });
      let result: unknown = {};
      if (method === 'account/read') result = { account: { type: 'chatgpt' } };
      if (method === 'model/list') result = { data: Object.values(agentModels).map(model => ({ model, supportedReasoningEfforts: [{ reasoningEffort: 'low' }] })), nextCursor: null };
      if (method === 'thread/start' || method === 'thread/resume') result = { thread: { id: THREAD }, model: agentModels.spark, cwd: this.options.cwd, runtimeWorkspaceRoots: [this.options.cwd], ...(options.permission === 'missing' ? {} : { activePermissionProfile: { id: options.permission === 'wrong' ? 'host-unrestricted' : 'present-work' } }) };
      if (method === 'thread/read') result = { thread: { id: THREAD, turns: options.recovery ?? [] } };
      if (method === 'turn/start') {
        result = { turn: { id: TURN } }; started();
        if (!options.pending) setImmediate(() => {
          if (this.closed) return;
          if (options.commands) {
            const item = { type: 'commandExecution', id: 'command-one', command: 'node --check source.js', status: 'completed', exitCode: 0, aggregatedOutput: 'not copied into public receipts' };
            this.emit('item/completed', { threadId: 'unrelated-thread', turnId: TURN, item: { ...item, id: 'wrong-thread' } });
            this.emit('item/completed', { threadId: THREAD, turnId: 'unrelated-turn', item: { ...item, id: 'wrong-turn' } });
            this.emit('item/completed', { threadId: THREAD, turnId: TURN, item });
          }
          this.emit('item/completed', { threadId: THREAD, turnId: TURN, item: { id: 'answer', type: 'agentMessage', phase: 'final_answer', text: options.output ?? artifact } });
          this.emit('turn/completed', { threadId: THREAD, turn: { id: TURN, status: options.failed ? 'failed' : 'completed', error: options.failed ? { message: 'private backend detail' } : null } });
        });
      }
      return result as T;
    }
  }
  const run = createRunWorkspaceWork({ directory, configured: () => options.configured !== false, wire: config => { const wire = new FakeWire(config); wires.push(wire); return wire; } });
  return { directory, calls, wires, turnStarted, get latest() { return latest; },
    execute: (state = ready(), signal = AbortSignal.timeout(2000), jobId = ID) => run({ prompt: 'Prepare the source.', provider: 'spark', jobId, attempt: 1, state, onCheckpoint: state => { latest = structuredClone(state); } }, signal),
    close: () => { for (const wire of wires) wire.close(); rmSync(directory, { recursive: true, force: true }); },
  };
}

test('explicit follow-up resumes the same private task and workspace and retains actual source files', async () => {
  const f = fixture();
  try {
    const first = await f.execute(); assert.equal(first.execution.continued, false);
    const cwd = f.wires[0].options.cwd, source = 'console.log(42);\n'; writeFileSync(join(cwd, 'source.js'), source);
    const state: WorkExecutionState = { ...f.latest, phase: 'ready', turnId: null, dispatchId: null, commands: [], output: undefined };
    const second = await f.execute(state, AbortSignal.timeout(2000), 'b'.repeat(32));
    assert.equal(second.output, artifact); assert.equal(second.execution.boundary, 'local-workspace'); assert.equal(second.execution.continued, true);
    assert.equal(f.wires[1].options.cwd, cwd); assert.equal(readFileSync(join(cwd, 'source.js'), 'utf8'), source);
    assert.deepEqual(second.execution.files, [{ path: 'source.js', bytes: Buffer.byteLength(source), sha256: createHash('sha256').update(source).digest('hex') }]);
    assert.equal(f.calls.filter(call => call.method === 'thread/start').length, 1); assert.equal(f.calls.filter(call => call.method === 'thread/resume').length, 1);
    assert.equal(f.calls.find(call => call.method === 'thread/resume')?.params.threadId, THREAD);
    for (const wire of f.wires) assert.equal((wire.options.config.projects as Record<string, { trust_level: string }> | undefined)?.[cwd]?.trust_level, 'untrusted');
    for (const call of f.calls.filter(call => ['thread/start', 'thread/resume', 'turn/start'].includes(call.method))) {
      assert.equal(call.params.permissions, 'present-work'); assert.equal(call.params.sandbox, undefined); assert.equal(call.params.sandboxPolicy, undefined);
    }
    assert.ok(f.wires.every(wire => wire.closed));
  } finally { f.close(); }
});

test('command receipts require correlated execution events and never come from artifact claims', async () => {
  const observed = fixture({ commands: true }), claimed = fixture({ output: JSON.stringify({ title: 'Claim', format: 'markdown', body: 'I ran npm test successfully and deployed the website.' }) });
  try {
    const result = await observed.execute();
    assert.deepEqual(result.execution.commands, [{ id: 'command-one', command: 'node --check source.js', status: 'completed', exitCode: 0, truncated: false, commandSha256: '3f53574beeab69d5ba5fbf278d0e68e3bed2ced6e7b1145b55bbdb6ec32a0acc' }]);
    assert.deepEqual((await claimed.execute()).execution.commands, []); assert.equal(observed.latest.phase, 'completed');
  } finally { observed.close(); claimed.close(); }
});

test('terminal failure and cancellation reject final text and close the owned worker', async () => {
  const failed = fixture({ failed: true }), cancelled = fixture({ pending: true }), controller = new AbortController();
  try {
    await assert.rejects(failed.execute()); assert.notEqual(failed.latest.phase, 'completed'); assert.equal(failed.latest.output, undefined);
    const pending = cancelled.execute(ready(), controller.signal), rejection = assert.rejects(pending);
    await cancelled.turnStarted; controller.abort(); await rejection;
    assert.equal(cancelled.calls.filter(call => call.method === 'turn/interrupt').length, 1);
    assert.notEqual(cancelled.latest.phase, 'completed'); assert.equal(cancelled.latest.output, undefined);
    assert.ok([...failed.wires, ...cancelled.wires].every(wire => wire.closed));
  } finally { failed.close(); cancelled.close(); }
});

test('missing or mismatched permissions fail before any turn can execute', async () => {
  for (const permission of ['missing', 'wrong'] as const) {
    const f = fixture({ permission });
    try { await assert.rejects(f.execute()); assert.equal(f.calls.filter(call => call.method === 'turn/start').length, 0); assert.ok(f.wires.every(wire => wire.closed)); }
    finally { f.close(); }
  }
});

test('unknown dispatch recovery fails closed without dispatching a duplicate turn', async () => {
  const f = fixture({ recovery: [{ id: 'unrelated-turn', status: 'completed', items: [{ type: 'userMessage', id: 'user', clientId: 'different-dispatch', content: [] }, { type: 'agentMessage', id: 'answer', phase: 'final_answer', text: artifact }] }] });
  try {
    await assert.rejects(f.execute({ ...ready(), threadId: THREAD, phase: 'dispatching', dispatchId: 'unknown-dispatch' }));
    assert.equal(f.calls.filter(call => call.method === 'thread/read').length, 1); assert.equal(f.calls.filter(call => call.method === 'turn/start').length, 0);
    assert.equal(f.latest.output, undefined);
  } finally { f.close(); }
});

test('completed recovery matches the user message dispatch ID and returns only its final without a new turn', async () => {
  const dispatchId = 'recover-this-dispatch';
  const turn = (id: string, clientId: string, text: string) => ({ id, status: 'completed', items: [{ type: 'userMessage', id: `user-${id}`, clientId, content: [] }, { type: 'agentMessage', id: `answer-${id}`, phase: 'final_answer', text }] });
  const f = fixture({ recovery: [turn('wrong-turn', 'unrelated-dispatch', 'wrong output'), turn(TURN, dispatchId, artifact), turn('later-turn', 'later-dispatch', 'later output')] });
  try {
    const result = await f.execute({ ...ready(), threadId: THREAD, phase: 'dispatching', dispatchId });
    assert.equal(result.output, artifact); assert.equal(result.execution.continued, true);
    assert.equal(f.calls.filter(call => call.method === 'turn/start').length, 0); assert.equal(f.latest.phase, 'completed'); assert.equal(f.latest.turnId, TURN);
  } finally { f.close(); }
});

test('known completed turn recovery uses its exact turn ID and unavailable authentication creates no worker', async () => {
  const f = fixture({ recovery: [{ id: TURN, status: 'completed', items: [{ type: 'agentMessage', id: 'answer', phase: 'final_answer', text: artifact }] }] }), unavailable = fixture({ configured: false });
  try {
    assert.equal((await f.execute({ ...ready(), threadId: THREAD, turnId: TURN, phase: 'running', dispatchId: 'already-saved' })).output, artifact);
    assert.equal(f.calls.filter(call => call.method === 'turn/start').length, 0);
    await assert.rejects(unavailable.execute()); assert.equal(unavailable.wires.length, 0);
  } finally { f.close(); unavailable.close(); }
});

test('a redirected workspace base is rejected before worker creation', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'present-workspace-base-')));
  let workers = 0;
  try {
    const outside = join(root, 'outside'), directory = join(root, 'redirected'); mkdirSync(outside); symlinkSync(outside, directory);
    const run = createRunWorkspaceWork({ directory, configured: () => true, wire: () => { workers++; throw new Error('Worker creation was reached.'); } });
    await assert.rejects(run({ prompt: 'Prepare the source.', provider: 'spark', jobId: ID, attempt: 1, state: ready(), onCheckpoint: () => {} }, AbortSignal.timeout(2000)));
    assert.equal(workers, 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('oversized terminal output is checkpointed failed so an explicit retry can dispatch new work', async () => {
  const f = fixture({ output: JSON.stringify({ title: 'Too large', format: 'markdown', body: 'x'.repeat(24001) }) });
  try {
    await assert.rejects(f.execute(), /output limit/);
    assert.equal(f.latest.phase, 'failed'); assert.equal(f.latest.output, undefined);
    assert.ok(f.wires.every(wire => wire.closed));
  } finally { f.close(); }
});
