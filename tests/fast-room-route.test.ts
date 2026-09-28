import test from 'node:test';
import assert from 'node:assert/strict';
import { routeFastRoom } from '../server/agents/fast-room-route';
import { objectToShape } from '../shared/tldraw-adapter';
import { makeObject } from '../shared/room';
import type { Scene } from '../shared/scenes';

const context = { request: 'Add a timer', pageId: 'page:page', shapes: [objectToShape(makeObject('note', 'a', { x: 0, y: 0 }, { text: 'Selected thought' }))] };
const scenes = [{ id: 'existing-scene' }] as Scene[];
const defer = { route: 'defer', seconds: undefined, text: undefined, modelMs: 1, confidence: null };
const create = { route: 'timer', seconds: 60, text: undefined, modelMs: 1, confidence: 1 };

test('new tools can take the fast route with an existing selection and scene; judgments start together', async () => {
  const called: string[] = [];
  let release!: () => void;
  const ready = new Promise<void>(resolve => { release = resolve; });
  const result = routeFastRoom(context, scenes, new AbortController().signal, {
    creation: async () => { called.push('create'); await ready; return create; },
    reactive: async () => { called.push('edit'); await ready; return defer; },
    playback: async () => { called.push('playback'); release(); return null; },
  });
  assert.deepEqual(called, ['create', 'edit', 'playback']);
  assert.deepEqual(await result, { kind: 'creation', decision: create });
});

test('conflicting routes defer without a mutation; cancellation wins', async () => {
  const controller = new AbortController();
  const providers = { creation: async () => create, reactive: async () => ({ ...defer, route: 'move' }), playback: async () => null };
  const conflict = await routeFastRoom(context, scenes, controller.signal, providers);
  assert.equal(conflict.kind, 'defer');
  controller.abort();
  await assert.rejects(routeFastRoom(context, scenes, controller.signal, providers), { name: 'AbortError' });
});

test('a failed competing judgment cannot authorize a partial fast-route match', async () => {
  const result = await routeFastRoom(context, scenes, new AbortController().signal, {
    creation: async () => create,
    reactive: async () => { throw new Error('Provider disconnected'); },
    playback: async () => null,
  });
  assert.equal(result.kind, 'defer');
});

test('unavailable and expired judgments retain the full-model fallback with one shared budget', async () => {
  const signals: AbortSignal[] = [];
  const wait = async (signal?: AbortSignal) => {
    assert.ok(signal); signals.push(signal);
    await new Promise<void>((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
    return defer;
  };
  // Keep Node alive while testing AbortSignal.timeout's unref'd timer.
  const keepAlive = setTimeout(() => {}, 1000);
  try {
    const result = await routeFastRoom(context, scenes, new AbortController().signal, {
      creation: (_request, _engine, signal) => wait(signal),
      reactive: (_context, _engine, signal) => wait(signal),
      playback: async () => { throw new Error('unavailable'); },
    }, 20);
    assert.equal(result.kind, 'defer');
    assert.equal(signals[0], signals[1]);
    assert.equal(signals[0].aborted, true);
  } finally { clearTimeout(keepAlive); }
});
