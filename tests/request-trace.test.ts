import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { traceRequest, traceAbortSignal, withRequestTrace, type TraceReceipt } from '../server/agents/request-trace';
import { RoomStore } from '../server/room-store';
import { makeObject } from '../shared/room';

const roomId = 'a'.repeat(32);
test('concurrent causal traces retain only allowlisted metadata and exact provenance', async () => {
  const receipts: TraceReceipt[] = [], sink = (receipt: TraceReceipt) => { receipts.push(receipt); };
  await Promise.all(['one', 'two'].map(requestId => withRequestTrace({ roomId, requestId, provider: 'sol', sink }, async () => {
    traceRequest('planning'); await delay(requestId === 'one' ? 5 : 1);
    traceRequest('provider_dispatch', { model: 'gpt-6.1-sol', modelSource: 'requested', transport: 'openai' });
    traceRequest('provider_result', { model: 'gpt-6.1-sol-2026-09-08', modelSource: 'confirmed', transport: 'openai', prompt: 'private prompt', error: 'Bearer private-key', pixels: 'private pixels' } as never);
    traceRequest('validated'); traceRequest('scene_committed', { nodes: 2, tracks: 1 });
  })));
  for (const id of ['one', 'two']) {
    const events = receipts.filter(r => r.requestId === id);
    assert.deepEqual(events.map(e => e.stage), ['accepted', 'planning', 'provider_dispatch', 'provider_result', 'validated', 'scene_committed', 'completed']);
    assert.deepEqual(events.map(e => e.sequence), [1, 2, 3, 4, 5, 6, 7]);
    assert.ok(events.every((e, i) => e.roomHash.length === 64 && e.elapsedMs >= (events[i - 1]?.elapsedMs ?? 0) && e.sincePreviousMs >= 0));
    assert.equal(events[3].model, 'gpt-6.1-sol-2026-09-08'); assert.equal(events[3].modelSource, 'confirmed');
  }
  assert.doesNotMatch(JSON.stringify(receipts), /private|Bearer|pixels|prompt|aaaaaaaa/);
});

test('caller abort, deadline and terminal validation failure remain distinguishable without error text', async () => {
  for (const name of ['AbortError', 'TimeoutError', 'Error']) {
    const events: TraceReceipt[] = [], controller = new AbortController();
    await assert.rejects(withRequestTrace({ roomId, requestId: name, provider: 'sol', sink: r => events.push(r) }, async () => {
      traceAbortSignal(controller.signal); traceRequest('validation_failed', { errorCode: 'validation' });
      if (name !== 'Error') controller.abort(new DOMException('private raw response', name));
      throw new Error('private prompt and key');
    }));
    assert.equal(events.at(-1)?.stage, name === 'AbortError' ? 'aborted' : name === 'TimeoutError' ? 'timed_out' : 'failed');
    assert.equal(events.at(-1)?.errorCode, 'validation');
    assert.doesNotMatch(JSON.stringify(events), /private|key|prompt/);
  }
});

test('transaction trace happens after commit, correlates revision separately, and emits no false commit on conflict', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'present-trace-')), store = new RoomStore({ directory }), events: TraceReceipt[] = [];
  try {
    const object = makeObject('note', 'human', { x: 1, y: 2 }, { text: 'private note' });
    await withRequestTrace({ roomId, requestId: 'causal', provider: 'sol', sink: r => events.push(r) }, async () => {
      store.applyOperation(roomId, { type: 'put', object }, 'agent:sol', { requestId: 'revision', causalRequestId: 'causal' });
      assert.equal(store.getRoom(roomId).objects[0].id, object.id);
      store.applyOperation(roomId, { type: 'put', object }, 'agent:sol', { requestId: 'revision', causalRequestId: 'causal' });
      await assert.rejects(async () => store.applyOperation(roomId, { type: 'rename', title: 'private title' }, 'agent:sol', { requestId: 'revision', causalRequestId: 'causal' }), /different operation/);
      store.applyOperation(roomId, { type: 'rename', title: 'unrelated' }, 'human', { requestId: 'unrelated' });
    });
    const commits = events.filter(e => e.stage === 'transaction_committed');
    assert.equal(commits.length, 2); assert.equal(commits[0].requestId, 'causal'); assert.equal(commits[0].transactionId, 'revision');
    assert.equal(commits[0].replayed, false); assert.equal(commits[1].replayed, true); assert.equal(commits[0].clock, commits[1].clock);
    assert.doesNotMatch(JSON.stringify(events), /private|unrelated/);
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('diagnostic sink failure never changes a successful request result', async () => {
  assert.equal(await withRequestTrace({ roomId, requestId: 'sink', provider: 'sol', sink: () => { throw new Error('disk unavailable'); } }, async () => { traceRequest('validated'); return 42; }), 42);
});
