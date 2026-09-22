import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { randomBytes } from 'node:crypto';
import { createRealtimeEvents, voiceError, type VoiceEvent, type ToolCall } from '../src/voice/realtime-events';
import { createVoiceSession } from '../server/agents/voice-session';
import { closeRoomStore } from '../server/room-store';
after(closeRoomStore);
test('Live uses completed output items, deduplicates tools, and waits for results before continuing', async () => {
  const sent: unknown[] = []; let count = 0; let release!: () => void;
  const events = createRealtimeEvents({ current: () => true, mode: () => 'ambient', send: e => sent.push(e), record: () => {}, status: () => {}, error: e => { throw e; }, execute: async () => { count++; await new Promise<void>(r => { release = r; }); return { ok: true }; } });
  const wrap = (event: VoiceEvent & { item?: ToolCall }) => ({ type: 'response.event', delegation_id: 'd1', event });
  await events(wrap({ type: 'response.created', response: { id: 'r1' } }));
  const call = wrap({ type: 'response.output_item.done', item: { type: 'function_call', call_id: 'c1', name: 'add_note', arguments: '{}' } });
  await events(call); await events(call);
  const done = wrap({ type: 'response.completed', response: { id: 'r1', output: [] } });
  const pending = events(done); assert.equal(sent.length, 0); release(); await pending; await events(done);
  assert.equal(count, 1); assert.deepEqual(sent.map(e => (e as { type: string }).type), ['response.item.create','response.create']);
});
test('Live captions preserve fragment identity and ignore duplicate delivery', async () => {
  const rows: [string, 'user' | 'assistant', string, boolean][] = [];
  const events = createRealtimeEvents({ current: () => true, mode: () => 'ambient', send: () => {}, record: (...args) => rows.push(args), status: () => {}, error: e => { throw e; }, execute: async () => ({}) });
  const event = { type: 'session.input_transcript.delta', event_id: 'e1', delta: 'hello ', start_ms: 0, end_ms: 200 };
  await events(event); await events(event); await events({ ...event, event_id: 'e2', delta: 'world' });
  events.flush();
  assert.deepEqual(rows.filter(r => r[3]).map(r => r[2]), ['hello world']);
});
test('Live WebRTC sends JSON transport and separates voice from backend tools', async () => {
  const original = fetch, key = process.env.OPENAI_API_KEY; process.env.OPENAI_API_KEY = 'test';
  globalThis.fetch = async (url, init) => {
    assert.equal(url, 'https://api.openai.com/v1/live/sessions');
    const body = JSON.parse(String(init?.body));
    assert.equal(body.session.model, 'gpt-live-1'); assert.equal(body.transport.sdp, 'v=0');
    assert.equal(body.session.delegation.type, 'responses'); assert.ok(body.session.delegation.responses.tools.some((t: { name: string }) => t.name === 'control_video'));
    assert.equal(body.session.tools, undefined);
    return Response.json({ session: { id: 'live_test' }, transport: { type: 'webrtc', sdp: 'answer' } });
  };
  try { assert.equal(await createVoiceSession('v=0', new URL(`http://localhost/api/voice/session?roomId=${randomBytes(16).toString('hex')}`), new AbortController().signal), 'answer'); }
  finally { globalThis.fetch = original; if (key === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = key; }
});

 test('voice network errors explain server connectivity without blaming microphone or model', () => {
  assert.match(voiceError(new TypeError('Failed to fetch')), /room server.*start listening again/);
  assert.equal(voiceError(new Error('A concrete tool validation error')), 'A concrete tool validation error');
});
