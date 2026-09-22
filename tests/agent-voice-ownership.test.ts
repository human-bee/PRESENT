import assert from 'node:assert/strict';
import { test } from 'node:test';
import { VoiceOwnership } from '../server/agents/voice-ownership';
import { AgentError } from '../server/agents/contract';

const roomId = 'a'.repeat(32); const sessionId = 'session-one-123456'; const second = 'session-two-123456';
const request = { roomId, sessionId, actor: 'human-1', callId: 'call_123', name: 'add_note', arguments: { text: 'Remember this.' } };
const status = (expected: number) => (error: unknown) => error instanceof AgentError && error.status === expected;

test('a pending or active room listener prevents another human from acquiring it', () => {
  const ownership = new VoiceOwnership();
  ownership.begin(roomId, 'human-1', sessionId);
  assert.throws(() => ownership.begin(roomId, 'human-2', second), status(409));
  assert.throws(() => ownership.runTool(request, async () => 'must not run'), status(409));
  assert.throws(() => ownership.heartbeat(roomId, sessionId), status(409));
  ownership.activate(roomId, sessionId);
  assert.throws(() => ownership.begin(roomId, 'human-2', second), status(409));
  assert.throws(() => ownership.runTool({ ...request, actor: 'human-2' }, async () => 'must not run'), status(409));
  assert.throws(() => ownership.runTool({ ...request, sessionId: second }, async () => 'must not run'), status(410));
});

test('concurrent tool replay shares one execution, while mismatched replay has no effect', async () => {
  const ownership = new VoiceOwnership(); ownership.begin(roomId, 'human-1', sessionId); ownership.activate(roomId, sessionId);
  let executions = 0;
  const execute = async () => { executions++; return { objectId: 'actual-object' }; };
  const first = ownership.runTool(request, execute); const duplicate = ownership.runTool(request, execute);
  assert.equal(first, duplicate);
  assert.throws(() => ownership.runTool({ ...request, arguments: { text: 'Different action' } }, execute), status(409));
  assert.deepEqual(await first, { objectId: 'actual-object' }); assert.equal(executions, 1);
  assert.deepEqual(await ownership.runTool(request, execute), { objectId: 'actual-object' }); assert.equal(executions, 1);
});

test('failed tool replay retains failure without running the mutation twice', async () => {
  const ownership = new VoiceOwnership(); ownership.begin(roomId, 'human-1', sessionId); ownership.activate(roomId, sessionId);
  let executions = 0;
  const execute = async () => { executions++; throw new Error('Provider failed'); };
  await assert.rejects(ownership.runTool(request, execute), /Provider failed/);
  await assert.rejects(ownership.runTool(request, execute), /Provider failed/);
  assert.equal(executions, 1);
});

test('heartbeat extends a live lease, expiry permits takeover, and stale stop cannot remove it', async () => {
  let now = 0; const ownership = new VoiceOwnership({ now: () => now });
  ownership.begin(roomId, 'human-1', sessionId); ownership.activate(roomId, sessionId);
  now = 80000; ownership.heartbeat(roomId, sessionId);
  now = 100000; assert.throws(() => ownership.begin(roomId, 'human-2', second), status(409));
  now = 170000; ownership.begin(roomId, 'human-2', second); ownership.activate(roomId, second);
  ownership.stop(roomId, sessionId);
  assert.throws(() => ownership.runTool(request, async () => 'old action'), status(410));
  assert.equal(await ownership.runTool({ ...request, actor: 'human-2', sessionId: second }, async () => 'new action'), 'new action');
});

test('stop releases failed setup and suppresses a queued tool before execution', async () => {
  const ownership = new VoiceOwnership(); ownership.begin(roomId, 'human-1', sessionId); ownership.stop(roomId, sessionId);
  ownership.begin(roomId, 'human-1', sessionId); ownership.activate(roomId, sessionId);
  let executions = 0;
  const pending = ownership.runTool(request, async () => { executions++; });
  ownership.stop(roomId, sessionId);
  await assert.rejects(pending, status(410)); assert.equal(executions, 0);
  ownership.begin(roomId, 'human-2', second);
});

test('ownership validates identities and bounds rooms and replay storage', async () => {
  const ownership = new VoiceOwnership({ maxRooms: 1, maxCalls: 1 });
  assert.throws(() => ownership.begin(roomId, 'human-1', ''), status(400));
  ownership.begin(roomId, 'human-1', sessionId); ownership.activate(roomId, sessionId);
  assert.throws(() => ownership.begin('b'.repeat(32), 'human-2', second), status(503));
  assert.throws(() => ownership.runTool({ ...request, callId: undefined }, async () => 'must not run'), status(400));
  await ownership.runTool(request, async () => 'first');
  assert.throws(() => ownership.runTool({ ...request, callId: 'call_456' }, async () => 'must not run'), status(409));
  assert.equal(await ownership.runTool(request, async () => 'must not run'), 'first');
});
