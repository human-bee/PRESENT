import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createVoiceLifecycle, VoiceFailure, VOICE_RETRY_DELAYS } from '../src/voice/lifecycle';
import { createRealtimeEvents, VOICE_EVENT_LIMITS, type RealtimeEnvelope } from '../src/voice/realtime-events';
import { createVoiceTiming, VOICE_TIMING_LIMIT } from '../src/voice/timing';
import { createVoiceTransport, readVoiceToolResult } from '../src/voice/transport';
import { VoiceOwnership, VOICE_OWNERSHIP_LIMITS } from '../server/agents/voice-ownership';
import type { CanvasViewContext } from '../shared/canvas-commands';

const deferred = <T = void>() => { let resolve!: (value: T) => void; let reject!: (cause: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const settle = async () => { for (let i = 0; i < 60; i++) await Promise.resolve(); };
function lifecycleFixture() {
  let id = 0;
  const clocks = new Map<object, () => void>(), released: number[] = [], quiesced: number[] = [], errors: (string | null)[] = [];
  const drains = new Map<number, ReturnType<typeof deferred<void>>>(), connections = new Map<number, ReturnType<typeof deferred<void>>>();
  const life = createVoiceLifecycle({
    create: () => ++id, connect: session => { const task = deferred(); connections.set(session, task); return task.promise; },
    quiesce: session => { quiesced.push(session); }, drain: session => { const task = deferred(); drains.set(session, task); return task.promise; },
    release: async session => { released.push(session); }, status: () => {}, error: value => errors.push(value),
    clock: { set: fn => { const token = {}; clocks.set(token, fn); return token; }, clear: token => { clocks.delete(token as object); } },
  });
  return { life, drains, connections, released, quiesced, errors, tick: () => { const callbacks = [...clocks.values()]; clocks.clear(); callbacks.forEach(fn => fn()); } };
}

test('stop during a pending connect and old drain cannot dispose or error a new session', async () => {
  const f = lifecycleFixture(); f.life.start(); await settle();
  const oldStop = f.life.stop(); f.life.start(); await settle();
  assert.equal(f.life.active, null); assert.deepEqual(f.quiesced, [1]);
  f.drains.get(1)!.resolve(); await oldStop; await settle();
  assert.equal(f.life.active, 2);
  f.connections.get(1)!.reject(new VoiceFailure('late failure', true)); await settle();
  assert.equal(f.life.active, 2); assert.deepEqual(f.released, [1]); assert.equal(f.life.snapshot().retryPending, false);
  const stop = f.life.stop(); f.drains.get(2)!.resolve(); await stop;
});

test('explicit stop wins before launch, during retry delay and while retry awaits retirement', async () => {
  const f = lifecycleFixture(); f.life.start(); await f.life.stop(); await settle(); assert.equal(f.life.active, null);
  f.life.start(); await settle(); f.life.fail(1, new VoiceFailure('offline', true));
  assert.equal(f.life.snapshot().retryPending, true);
  f.tick(); await settle(); // retry is waiting for the first session to retire
  const stopped = f.life.stop(); f.drains.get(1)!.resolve(); await stopped; f.tick(); await settle();
  assert.equal(f.life.active, null); assert.equal(f.life.snapshot().wanted, false); assert.deepEqual(f.released, [1]);
});

test('automatic retries have a fixed three-attempt budget and never reuse the old session', async () => {
  const f = lifecycleFixture(); f.life.start(); await settle();
  for (let id = 1; id <= 4; id++) {
    assert.equal(f.life.active, id); f.life.fail(id, new VoiceFailure('offline', true));
    f.drains.get(id)!.resolve(); await settle(); f.tick(); await settle();
  }
  assert.equal(f.life.active, null); assert.equal(f.life.snapshot().attempts, VOICE_RETRY_DELAYS.length);
  assert.equal(f.life.snapshot().wanted, false); assert.deepEqual(f.released, [1, 2, 3, 4]);
});

const wrap = (delegation: string, event: RealtimeEnvelope['event']): RealtimeEnvelope => ({ type: 'response.event', delegation_id: delegation, event });
const created = (d: string, r: string) => wrap(d, { type: 'response.created', response: { id: r } });
const completed = (d: string, r: string) => wrap(d, { type: 'response.completed', response: { id: r } });
const call = (d: string, r: string | undefined, id: string, args = '{}') => wrap(d, { type: 'response.output_item.done', ...(r ? { response: { id: r } } : {}), item: { type: 'function_call', name: 'add_note', call_id: id, arguments: args } });
function eventFixture(execute: (name: string, args: Record<string, unknown>, id: string) => Promise<unknown> = async () => ({ ok: true })) {
  const sent: any[] = [], errors: string[] = [], warnings: string[] = [], timing = createVoiceTiming();
  const events = createRealtimeEvents({ sessionId: 'session', current: () => true, mode: () => 'ambient', send: value => sent.push(value), record: () => {}, status: () => {}, error: error => errors.push(error.message), warning: warning => warnings.push(warning), execute, timing });
  return { events, sent, errors, warnings, timing };
}

test('overlapping explicit response/delegation identities return each exact call once without invented continuation fields', async () => {
  const one = deferred<unknown>(), two = deferred<unknown>(), executed: string[] = [];
  const f = eventFixture(async (_name, _args, id) => { executed.push(id); return id === 'one' ? one.promise : two.promise; });
  await f.events(created('d', 'r1')); await f.events(created('d', 'r2'));
  await f.events(call('d', 'r1', 'one')); await f.events(call('d', 'r2', 'two')); await f.events(call('d', 'r1', 'one'));
  const done1 = f.events(completed('d', 'r1')), done2 = f.events(completed('d', 'r2'));
  two.resolve({ value: 2 }); await done2; one.resolve({ value: 1 }); await done1;
  assert.deepEqual(executed, ['one', 'two']); assert.deepEqual(f.sent.map(value => value.item.call_id), ['two', 'one']);
  assert.deepEqual(f.sent.map(value => JSON.parse(value.item.output)), [{ value: 2 }, { value: 1 }]);
  assert.equal(f.warnings.length, 2); assert.deepEqual(f.errors, []);
  assert.ok(f.sent.every(value => value.type === 'response.item.create' && !('delegation_id' in value) && !('response_id' in value)));
  assert.deepEqual(f.timing.snapshot().filter(mark => mark.phase === 'tool-result').map(mark => [mark.responseId, mark.callId]), [['r2', 'two'], ['r1', 'one']]);
  f.events.close();
});

test('different delegations can share a response ID; ambiguous same-delegation calls fail before mutation', async () => {
  const f = eventFixture(); await f.events(created('a', 'r')); await f.events(created('b', 'r'));
  await f.events(call('a', undefined, 'a')); await f.events(call('b', undefined, 'b'));
  await f.events(completed('b', 'r')); await f.events(completed('a', 'r'));
  assert.deepEqual(f.sent.map(value => value.item.call_id), ['a', 'b']); assert.deepEqual(f.errors, []); f.events.close();
  let count = 0; const ambiguous = eventFixture(async () => { count++; });
  await ambiguous.events(created('d', 'r1')); await ambiguous.events(created('d', 'r2'));
  await ambiguous.events(call('d', undefined, 'uncertain'));
  assert.equal(count, 0); assert.match(ambiguous.errors[0], /ambiguous/); ambiguous.events.close();
});

test('duplicate response creation retains pending calls; conflicts and stale shapes remain tool results', async () => {
  for (const status of [409, 410]) {
    const f = eventFixture(() => readVoiceToolResult(Response.json({ error: 'Object changed; read it again.' }, { status })));
    await f.events(created('d', 'r')); await f.events(call('d', 'r', 'c')); await f.events(created('d', 'r'));
    await f.events(completed('d', 'r')); await f.events(completed('d', 'r'));
    assert.deepEqual(f.errors, []); assert.equal(f.sent.length, 2); assert.equal(f.sent[1].type, 'response.create');
    assert.match(JSON.parse(f.sent[0].item.output).error, /Object changed/); f.events.close();
  }
});

test('quiesce prevents new dispatch and suppresses late results/continuation while captions can still flush', async () => {
  const result = deferred<unknown>(); let executed = 0;
  const f = eventFixture(async () => { executed++; return result.promise; });
  await f.events(created('d', 'r')); await f.events(call('d', 'r', 'c'));
  const done = f.events(completed('d', 'r')); f.events.quiesce();
  await f.events(call('d', 'r', 'late')); result.resolve({ ok: true }); await done;
  assert.equal(executed, 1); assert.deepEqual(f.sent, []); f.events.close();
});

test('event ceilings retain replay tombstones and timing exports are bounded content-free copies', async () => {
  const f = eventFixture(); await f.events(created('d', 'r'));
  for (let i = 0; i < VOICE_EVENT_LIMITS.calls; i++) await f.events(call('d', 'r', `c${i}`));
  await f.events(call('d', 'r', 'overflow')); await f.events(call('d', 'r', 'c0')); await settle();
  assert.equal(f.events.snapshot().calls, VOICE_EVENT_LIMITS.calls); assert.equal(f.errors.length, 1);
  const marks = f.timing.snapshot(); assert.equal(marks.length, VOICE_TIMING_LIMIT); assert.ok(Object.isFrozen(marks[0]));
  assert.ok(!JSON.stringify(marks).includes('arguments')); f.events.close(); assert.equal(f.events.snapshot().calls, 0);
});

test('ownership aborts stopped work, rejects personal-session identity collision and bounds retained receipts', async () => {
  const ownership = new VoiceOwnership(), roomId = 'a'.repeat(32), sessionId = 'personal-session-123';
  ownership.begin(roomId, 'one', sessionId, 'personal'); ownership.activate(roomId, sessionId);
  assert.throws(() => ownership.begin(roomId, 'two', sessionId, 'personal'), /identity is already/);
  const request = { roomId, sessionId, actor: 'one', callId: 'c', name: 'add_note', arguments: {} };
  let signal: AbortSignal | undefined; const pending = deferred<string>();
  const execution = ownership.runTool(request, async ownerSignal => { signal = ownerSignal; return pending.promise; }); await settle();
  ownership.stop(roomId, sessionId); assert.equal(signal?.aborted, true); pending.resolve('already running'); await execution;
  assert.equal(ownership.snapshot().cachedResultBytes, 0);
  ownership.begin(roomId, 'one', sessionId, 'personal'); ownership.activate(roomId, sessionId);
  let count = 0;
  const oversized = () => { count++; return Promise.resolve('x'.repeat(VOICE_OWNERSHIP_LIMITS.resultBytes + 1)); };
  await assert.rejects(ownership.runTool(request, oversized), /Do not replay/);
  await assert.rejects(ownership.runTool(request, oversized), /Do not replay/); assert.equal(count, 1);
});

function browserFixture() {
  const globals = new Map<string, PropertyDescriptor | undefined>();
  const install = (name: string, value: unknown) => { globals.set(name, Object.getOwnPropertyDescriptor(globalThis, name)); Object.defineProperty(globalThis, name, { configurable: true, writable: true, value }); };
  class Track { readyState = 'live'; stops = 0; onended: (() => void) | null = null; constructor(readonly id: string) {} stop() { this.stops++; this.readyState = 'ended'; } }
  class Stream { constructor(readonly tracks: Track[]) {} getTracks() { return this.tracks; } getAudioTracks() { return this.tracks; } }
  const microphones: Track[] = [], outputs: Track[] = [], peers: Peer[] = [], requests: { path: string; body: any; signal?: AbortSignal | null }[] = [];
  let heartbeatStatus = 200, toolStatus = 200;
  let toolGate: ReturnType<typeof deferred<Response>> | undefined, captionGate: ReturnType<typeof deferred<Response>> | undefined, microphoneGate: ReturnType<typeof deferred<Stream>> | undefined;
  class Channel {
    readyState = 'open'; onmessage: ((event: { data: string }) => void) | null = null; onclose: (() => void) | null = null; onerror: (() => void) | null = null; onopen: (() => void) | null = null;
    sent: any[] = [];
    send(raw: string) { const value = JSON.parse(raw); this.sent.push(value); if (value.type === 'session.close') this.emit({ type: 'session.closed' }); }
    emit(value: unknown) { this.onmessage?.({ data: JSON.stringify(value) }); }
    close() { this.readyState = 'closed'; this.onclose?.(); }
  }
  class Peer {
    connectionState = 'connected'; onconnectionstatechange: (() => void) | null = null; ontrack: unknown;
    channel = new Channel(); closed = false;
    constructor() { peers.push(this); }
    createDataChannel() { return this.channel; } addTrack() {} getReceivers() { return []; }
    async createOffer() { return { type: 'offer', sdp: 'v=0' }; } async setLocalDescription() {} async setRemoteDescription() {}
    close() { this.closed = true; } state(state: string) { this.connectionState = state; this.onconnectionstatechange?.(); }
  }
  class AudioContext {
    createMediaStreamDestination() { const track = new Track('mix'); outputs.push(track); return { stream: new Stream([track]) }; }
    createMediaStreamSource() { return { connect() {}, disconnect() {} }; } async resume() {} async close() {}
  }
  const store = () => { const map = new Map<string, string>(); return { getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => map.set(key, value), removeItem: (key: string) => map.delete(key) }; };
  install('localStorage', store()); install('sessionStorage', store()); install('window', { dispatchEvent() {} });
  install('navigator', { mediaDevices: { enumerateDevices: async () => [{ kind: 'audioinput', deviceId: 'mic', label: 'Internal microphone' }], getUserMedia: async () => { const track = new Track('mic'); microphones.push(track); return microphoneGate ? microphoneGate.promise : new Stream([track]); } } });
  install('MediaStream', Stream); install('AudioContext', AudioContext); install('RTCPeerConnection', Peer);
  install('Audio', class { autoplay = false; muted = false; srcObject: unknown; async play() {} pause() {} });
  install('fetch', async (url: string, init: RequestInit) => {
    const path = String(url).split('?')[0], body = path === '/api/voice/session' ? Object.fromEntries(new URL(String(url), 'http://test').searchParams) : JSON.parse(String(init.body));
    requests.push({ path, body, signal: init.signal });
    const gate = path === '/api/voice/tool' ? toolGate : path === '/api/voice/transcript' ? captionGate : undefined;
    if (gate) return new Promise<Response>((resolve, reject) => {
      const abort = () => reject(new DOMException('aborted', 'AbortError'));
      init.signal?.addEventListener('abort', abort, { once: true });
      void gate.promise.then(resolve, reject).finally(() => init.signal?.removeEventListener('abort', abort));
    });
    if (path === '/api/voice/session') return new Response('v=0 answer');
    const status = path === '/api/voice/heartbeat' ? heartbeatStatus : path === '/api/voice/tool' ? toolStatus : 200;
    return Response.json(status === 200 ? { ok: true } : { error: path === '/api/voice/tool' ? 'Stale shape' : 'Listener lease expired' }, { status });
  });
  const errors: (string | null)[] = [], statuses: string[] = [], remote = new Track('call-owned');
  let view: CanvasViewContext = { pageId: 'page:one', selectedIds: ['shape:one'], shapes: [], viewport: { x: 1, y: 2, w: 800, h: 600 }, capturedAt: 0 };
  const transport = createVoiceTransport({ roomId: 'a'.repeat(32), selfId: 'human', capture: 'shared', name: 'Human', mode: () => 'ambient', streams: () => [new Stream([remote]) as unknown as MediaStream], context: () => ({ read: () => view }), viewport: () => ({ x: 1, y: 2 }), generation: () => ({ provider: 'luna' }), status: value => statuses.push(value), error: value => errors.push(value), record: () => {} });
  return { transport, peers, requests, microphones, outputs, remote, errors, statuses, Track, Stream,
    setView: (value: CanvasViewContext) => { view = value; }, setHeartbeat: (status: number) => { heartbeatStatus = status; }, setTool: (status: number) => { toolStatus = status; },
    blockTool: () => (toolGate = deferred<Response>()), blockCaption: () => (captionGate = deferred<Response>()), blockMicrophone: () => (microphoneGate = deferred<Stream>()),
    restore: () => { for (const [name, descriptor] of globals) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); } },
  };
}

test('fake transport drains captions before releasing ownership, aborts pending tools, and preserves shared call tracks', async () => {
  const f = browserFixture();
  try {
    f.transport.start(); await settle(); const channel = f.peers[0].channel; channel.emit({ type: 'session.started' });
    const gate = f.blockTool(); channel.emit(created('d', 'r')); channel.emit(call('d', 'r', 'uncertain')); await settle();
    const captions = f.blockCaption(); channel.emit({ type: 'session.input_transcript.delta', event_id: 'caption', delta: 'saved only in fake request' });
    const stopping = f.transport.stop(); await settle();
    assert.equal(f.requests.find(request => request.path === '/api/voice/tool')?.signal?.aborted, true);
    assert.equal(f.requests.filter(request => request.path === '/api/voice/stop').length, 0);
    assert.equal(f.microphones[0].stops, 1); assert.equal(f.outputs[0].stops, 1); assert.equal(f.remote.stops, 0);
    channel.emit(call('d', 'r', 'late')); captions.resolve(Response.json({ ok: true })); gate.resolve(Response.json({ ok: true })); await stopping;
    assert.equal(f.requests.filter(request => request.path === '/api/voice/tool').length, 1);
    assert.equal(f.requests.at(-1)?.path, '/api/voice/stop'); assert.equal(f.peers[0].closed, true);
    assert.equal(channel.sent.some(value => value.type === 'response.item.create'), false);
  } finally { await f.transport.dispose(); f.restore(); }
});

test('fake transport recovers heartbeat lease loss with fresh IDs/context and never replays uncertain tools', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] }); const f = browserFixture();
  try {
    f.transport.start(); await settle(); const channel = f.peers[0].channel; channel.emit({ type: 'session.started' });
    f.setTool(409); channel.emit(created('d', 'r')); channel.emit(call('d', 'r', 'c')); channel.emit(completed('d', 'r')); await settle();
    assert.equal(f.transport.snapshot().active, true); assert.equal(f.peers.length, 1);
    assert.match(JSON.parse(channel.sent.find(value => value.item?.call_id === 'c').item.output).error, /Stale shape/);
    const uncertain = f.blockTool(); channel.emit(created('d', 'uncertain-response')); channel.emit(call('d', 'uncertain-response', 'uncertain-call')); await settle();
    f.setHeartbeat(410); t.mock.timers.tick(20000); await settle(); assert.equal(f.transport.snapshot().retryPending, true);
    uncertain.resolve(Response.json({ ok: true })); await settle();
    assert.equal(channel.sent.some(value => value.item?.call_id === 'uncertain-call'), false);
    f.setView({ pageId: 'page:two', selectedIds: ['shape:two'], shapes: [], viewport: { x: 5, y: 6, w: 800, h: 600 }, capturedAt: 1 });
    t.mock.timers.tick(500); await settle(); assert.equal(f.peers.length, 2);
    const sessions = f.requests.filter(request => request.path === '/api/voice/session'); assert.notEqual(sessions[0].body.sessionId, sessions[1].body.sessionId);
    f.peers[1].channel.emit({ type: 'session.started' });
    assert.match(f.peers[1].channel.sent[0].content, /page:two.*shape:two/);
    assert.equal(f.requests.filter(request => request.path === '/api/voice/tool').length, 2);
    f.peers[1].state('failed'); await settle(); const stopping = f.transport.stop(); t.mock.timers.tick(10000); await settle(); await stopping;
    assert.equal(f.peers.length, 2); assert.equal(f.remote.stops, 0);
  } finally { await f.transport.dispose(); f.restore(); t.mock.timers.reset(); }
});

test('transient peer disconnect heals inside grace; explicit stop cancels recovery and late microphone acquisition', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] }); const f = browserFixture();
  try {
    f.transport.start(); await settle(); f.peers[0].channel.emit({ type: 'session.started' });
    f.peers[0].state('disconnected'); t.mock.timers.tick(4000); f.peers[0].state('connected'); t.mock.timers.tick(5000); await settle(); assert.equal(f.peers.length, 1);
    await f.transport.stop();
    const microphone = f.blockMicrophone(); f.transport.start(); await settle(); await f.transport.stop();
    const late = new f.Track('late'); microphone.resolve(new f.Stream([late])); await settle();
    assert.equal(late.stops, 1); assert.equal(f.peers.length, 1); assert.equal(f.transport.snapshot().active, false);
  } finally { await f.transport.dispose(); f.restore(); t.mock.timers.reset(); }
});

test('a late untagged call after one overlapping response completes cannot attach to the remaining response', async () => {
  let dispatched = 0; const f = eventFixture(async () => { dispatched++; });
  await f.events(created('d', 'r1')); await f.events(created('d', 'r2')); await f.events(completed('d', 'r1'));
  await f.events(call('d', undefined, 'late'));
  assert.equal(dispatched, 0); assert.match(f.errors[0], /ambiguous/); f.events.close();
});
