import assert from 'node:assert/strict';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { buildSandboxDocument, isWidgetState, MAX_STATE_BYTES, readWidgetIncrement, readWidgetPatch, readWidgetRequestId, readWidgetShortcut } from '../src/widgets/sandbox';
import { createStarter } from '../src/widgets/presets';

test('widget bridge accepts bounded JSON and rejects unsafe state trees', () => {
  assert.equal(isWidgetState({ count: 2, choices: ['yes', null, true], nested: { score: 4 } }), true);
  for (const value of [null, [], { fn: () => 1 }, { score: Infinity }, { score: NaN }, { date: new Date() }, JSON.parse('{"nested":{"__proto__":{"admin":true}}}'), { constructor: {} }, { value: 'x'.repeat(MAX_STATE_BYTES) }, { value: '🌱'.repeat(MAX_STATE_BYTES / 3) }]) {
    assert.equal(isWidgetState(value), false);
  }
  const circular: Record<string, unknown> = {}; circular.self = circular;
  assert.equal(isWidgetState(circular), false);
  let deep: unknown = 1;
  for (let index = 0; index < 12; index++) deep = { inner: deep };
  assert.equal(isWidgetState({ deep }), false);
});

test('widget patch requires both its iframe source and private channel', () => {
  const source = {} as Window;
  const data = { type: 'present:patch', channel: 'expected', patch: { count: 1 } };
  assert.deepEqual(readWidgetPatch({ source, data }, source, 'expected'), { count: 1 });
  assert.equal(readWidgetPatch({ source: {} as Window, data }, source, 'expected'), null);
  assert.equal(readWidgetPatch({ source, data }, source, 'wrong'), null);
  assert.equal(readWidgetPatch({ source: null, data }, null, 'expected'), null);
  assert.equal(readWidgetPatch({ source, data: { ...data, patch: { prototype: 1 } } }, source, 'expected'), null);
});

test('sandbox document blocks network resources and safely embeds state before authored scripts', () => {
  const document = buildSandboxDocument('<h1>Hello</h1><script>present.getState()</script>', 'private-channel', { text: '</script><script>alert(1)</script>' });
  assert.ok(document.includes("default-src 'none'"));
  assert.ok(document.includes("connect-src 'none'"));
  assert.ok(document.includes("form-action 'none'"));
  assert.equal(document.includes('navigate-to'), false);
  assert.ok(document.includes("img-src data: blob:"));
  assert.equal(document.includes("'unsafe-eval'"), false);
  assert.equal(document.includes('"text":"</script>'), false);
  assert.ok(document.indexOf('window.present=') < document.indexOf('<h1>Hello'));
});

test('widget increment bridge authenticates source and validates explicit numeric operations', () => {
  const source = {} as Window;
  const data = { type: 'present:increment', channel: 'expected', key: 'score', by: 1 };
  assert.deepEqual(readWidgetIncrement({ source, data }, source, 'expected'), { key: 'score', by: 1 });
  assert.equal(readWidgetIncrement({ source: {} as Window, data }, source, 'expected'), null);
  for (const extra of [{ channel: 'wrong' }, { key: '__proto__' }, { key: '' }, { by: '1' }, { by: Infinity }]) {
    assert.equal(readWidgetIncrement({ source, data: { ...data, ...extra } }, source, 'expected'), null);
  }
});

test('iframe API sends partial updates, exposes stable participant identity and receives canonical state events', () => {
  const source = buildSandboxDocument('', 'channel', { left: 0, right: 0 }, 'alice');
  const posted: Record<string, unknown>[] = [];
  const parent = { postMessage: (message: Record<string, unknown>) => posted.push(structuredClone(message)) };
  const handlers: Record<string, (event: unknown) => void> = {};
  let stateEvents = 0;
  const frames: Array<() => void> = [];
  const context = {
    parent, structuredClone, requestAnimationFrame: (callback: () => void) => frames.push(callback),
    CustomEvent: class { constructor(public type: string, public init: unknown) {} },
    document: { addEventListener: () => undefined },
    window: { addEventListener: (name: string, handler: (event: unknown) => void) => { handlers[name] = handler; }, dispatchEvent: () => { stateEvents++; } } as Record<string, unknown>,
  };
  const bridge = source.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(bridge, 'the sandbox includes its state bridge');
  runInNewContext(bridge, context);
  const present = context.window.present as { participantId: string; setState: (patch: unknown) => void; getState: () => unknown; increment: (key: string, by?: number) => void };
  assert.equal(present.participantId, 'alice');
  present.setState({ left: 1 });
  assert.deepEqual(posted.at(-1)?.patch, { left: 1 });
  assert.deepEqual(present.getState(), { left: 1, right: 0 });
  present.increment('score');
  assert.equal(posted.at(-1)?.type, 'present:increment');
  assert.equal(posted.at(-1)?.by, 1);
  handlers.message({ source: parent, data: { channel: 'channel', type: 'present:state', state: { left: 1, right: 2, score: 3 }, receipts: ['channel:1', 'channel:2'] } });
  assert.deepEqual(present.getState(), { left: 1, right: 2, score: 3 });
  assert.equal(stateEvents, 3);
  assert.notEqual(posted.at(-1)?.type, 'present:rendered');
  frames.shift()?.(); frames.shift()?.();
  assert.equal(posted.at(-1)?.type, 'present:rendered');
  assert.deepEqual(posted.at(-1)?.receipts, ['channel:1', 'channel:2']);
  handlers.message({ source: parent, data: { channel: 'channel', type: 'present:state', state: { left: 1, right: 2, score: 3 }, receipts: ['channel:1', 'channel:2', 'other-widget:1'] } });
  assert.equal(stateEvents, 3, 'another widget receipt must not rebuild this unchanged widget');
  frames.shift()?.(); frames.shift()?.();
  assert.deepEqual(posted.at(-1)?.receipts, ['channel:1', 'channel:2', 'other-widget:1'], 'render acknowledgement remains available');
  present.increment('score');
  assert.equal(stateEvents, 4);
  handlers.message({ source: parent, data: { channel: 'channel', type: 'present:state', state: { left: 1, right: 2, score: 4 }, receipts: ['channel:1', 'channel:2', 'channel:3'] } });
  assert.equal(stateEvents, 4, 'canonical confirmation of the optimistic view is not a visible change');
  present.increment('score');
  assert.equal(stateEvents, 5);
  handlers.message({ source: parent, data: { channel: 'channel', type: 'present:rejected', requestId: 'channel:4' } });
  assert.equal(stateEvents, 6, 'rejection must still render the rollback');
  assert.deepEqual(present.getState(), { left: 1, right: 2, score: 4 });
});

test('widget request receipts cannot be forged for another iframe channel', () => {
  const source = {} as Window;
  const data = { channel: 'private', requestId: 'private:12' };
  assert.equal(readWidgetRequestId({ source, data }, source, 'private'), 'private:12');
  for (const requestId of ['other:12', 'private:0', 'private:1foo', 'private:', 'private:01']) {
    assert.equal(readWidgetRequestId({ source, data: { ...data, requestId } }, source, 'private'), null);
  }
  assert.equal(readWidgetRequestId({ source: {} as Window, data }, source, 'private'), null);
});

test('widget shortcuts require the focused frame, exact source/channel and an allowlisted command', () => {
  const source = {} as Window;
  const data = { channel: 'private', type: 'present:shortcut', shortcut: 'composer' };
  assert.equal(readWidgetShortcut({ source, data }, source, 'private', true), 'composer');
  assert.equal(readWidgetShortcut({ source, data: { ...data, shortcut: 'escape' } }, source, 'private', true), 'escape');
  assert.equal(readWidgetShortcut({ source, data }, source, 'private', false), null);
  assert.equal(readWidgetShortcut({ source: {} as Window, data }, source, 'private', true), null);
  assert.equal(readWidgetShortcut({ source, data }, source, 'other', true), null);
  for (const shortcut of ['delete', 'save', 'x', { command: 'composer' }]) {
    assert.equal(readWidgetShortcut({ source, data: { ...data, shortcut } }, source, 'private', true), null);
  }
});

test('sandbox forwards only trusted app shortcuts, never ordinary typing or composition', () => {
  const posted: unknown[] = [], handlers: Record<string, (event: unknown) => void> = {};
  const bridge = buildSandboxDocument('', 'channel', {}).match(/<script>([\s\S]*?)<\/script>/)![1];
  runInNewContext(bridge, { structuredClone, parent: { postMessage: (value: unknown) => posted.push(structuredClone(value)) },
    document: { addEventListener: (name: string, handler: (event: unknown) => void) => { handlers[name] = handler; } },
    window: { addEventListener() {} },
  });
  posted.length = 0;
  const key = (extra: Record<string, unknown>) => handlers.keydown({ key: 'k', isTrusted: true, preventDefault() {}, stopImmediatePropagation() {}, ...extra });
  for (const extra of [{}, { ctrlKey: true, isTrusted: false }, { metaKey: true, isComposing: true }, { ctrlKey: true, altKey: true }, { ctrlKey: true, repeat: true }, { key: 'a' }]) key(extra);
  assert.deepEqual(posted, []);
  key({ ctrlKey: true }); key({ key: 'K', metaKey: true }); key({ key: 'Escape' });
  assert.deepEqual(posted, [
    { type: 'present:shortcut', channel: 'channel', shortcut: 'composer' },
    { type: 'present:shortcut', channel: 'channel', shortcut: 'composer' },
    { type: 'present:shortcut', channel: 'channel', shortcut: 'escape' },
  ]);
});

test('quick-add presets have independent object identities and explicit shared widget state', () => {
  const a = createStarter('dice', 'actor', { x: 10, y: 20 });
  const b = createStarter('dice', 'actor', { x: 10, y: 20 });
  assert.notEqual(a.id, b.id);
  assert.equal(a.createdBy, 'actor');
  assert.equal(a.x, 10);
  for (const kind of ['dice', 'poll', 'teleprompter', 'synth'] as const) {
    const object = createStarter(kind, 'actor', { x: 0, y: 0 });
    assert.equal(object.kind, 'widget');
    assert.equal(isWidgetState(object.data.state), true);
    assert.match(String(object.data.html), /present\.setState/);
  }
});
