import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { withRequestTrace, type TraceReceipt } from '../server/agents/request-trace';
import { runRoomRequest } from '../server/agents/room-request';
import { closeRoomStore, getCanvasRecords } from '../server/room-store';
import { scenesInRoom } from '../server/scenes/store';
const plan = { title: 'Synthetic flow', explanation: 'Private generated output', epistemic: 'illustration', duration: 2, autoplay: false,
  nodes: [{ key: 'token', shape: 'ellipse', x: 0, y: 0, w: 54, h: 54, label: '1', color: 'blue' }],
  tracks: [{ key: 'token', waypoints: [], end: { x: 100, y: 50 } }], beats: [{ at: 0, label: 'Begin' }] };
async function fixture(run: (events: TraceReceipt[], request: (signal?: AbortSignal) => Promise<unknown>) => Promise<void>, backend?: typeof fetch) {
  const previous = { fetch: globalThis.fetch, transport: process.env.PRESENT_MODEL_TRANSPORT, key: process.env.OPENAI_API_KEY };
  const roomId = randomBytes(16).toString('hex'), requestId = 'causal-scene', events: TraceReceipt[] = [];
  process.env.PRESENT_MODEL_TRANSPORT = 'openai'; process.env.OPENAI_API_KEY = 'private-test-key';
  const fakeBackend = backend ?? (async () => Response.json({ model: 'gpt-6.1-sol-2026-09-08', status: 'completed', output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify({ result: { kind: 'scene', sceneId: null, plan } }) }] }] }));
  globalThis.fetch = async (url, init) => {
    const response = await fakeBackend(url, init);
    if (JSON.parse(String(init?.body)).stream && response.headers.get('content-type')?.includes('application/json')) {
      const body = await response.json();
      return new Response('data: ' + JSON.stringify({ type: 'response.completed', response: body }) + '\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
    }
    return response;
  };
  try {
    await run(events, signal => withRequestTrace({ roomId, requestId, provider: 'sol', signal, sink: r => events.push(r) }, async () => {
      const result = await runRoomRequest({ roomId, requestId, provider: 'sol', decisions: 'off', prompt: 'Private user prompt', position: { x: 0, y: 0 } }, signal);
      if (result.kind === 'scene') {
        assert.equal(scenesInRoom(roomId).length, 1);
        assert.ok(getCanvasRecords(roomId).some(record => record.typeName === 'shape'));
      }
      return result;
    }));
  } finally {
    globalThis.fetch = previous.fetch;
    for (const [key, value] of [['PRESENT_MODEL_TRANSPORT', previous.transport], ['OPENAI_API_KEY', previous.key]] as const) if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
}
after(() => closeRoomStore());

test('native scene trace correlates accepted through exact model validation and actual atomic scene commit', async () => {
  await fixture(async (events, request) => {
    await request();
    assert.deepEqual(events.map(e => e.stage), ['accepted', 'planning', 'provider_dispatch', 'provider_result', 'validated', 'transaction_committed', 'scene_committed', 'completed']);
    assert.ok(events.every(e => e.requestId === 'causal-scene'));
    assert.equal(events[2].model, 'gpt-6.1-sol'); assert.equal(events[2].modelSource, 'requested');
    assert.equal(events[3].model, 'gpt-6.1-sol-2026-09-08'); assert.equal(events[3].modelSource, 'confirmed');
    assert.equal(events[5].transactionId, events[6].transactionId); assert.equal(events[5].replayed, false);
    assert.doesNotMatch(JSON.stringify(events), /Private|private|user prompt|test-key|output_text/);
  });
});

test('invalid scene repair emits validation attempts and one failed terminal, never a false commit', async () => {
  await fixture(async (events, request) => {
    await assert.rejects(request(), /failed validation/);
    assert.equal(events.filter(e => e.stage === 'validation_failed').length, 2);
    assert.equal(events.filter(e => ['failed', 'completed', 'aborted', 'timed_out'].includes(e.stage)).length, 1);
    assert.equal(events.at(-1)?.stage, 'failed'); assert.equal(events.at(-1)?.errorCode, 'validation');
    assert.equal(events.filter(e => e.stage.includes('committed')).length, 0);
  }, async () => Response.json({ model: 'gpt-6.1-sol', status: 'completed', output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: '{"private malformed":"not a room intent"}' }] }] }));
});

test('route deadline during provider dispatch emits timed_out and leaves the scene uncommitted', async () => {
  await fixture(async (events, request) => {
    await assert.rejects(request(AbortSignal.timeout(10)), /cancelled or timed out/);
    assert.equal(events.at(-1)?.stage, 'timed_out');
    assert.ok(events.some(e => e.stage === 'provider_dispatch'));
    assert.ok(!events.some(e => e.stage.includes('committed')));
  }, async (_url, init) => { await delay(30); init?.signal?.throwIfAborted(); throw new Error('Expected cancelled signal'); });
});
