import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import test from 'node:test';
import { createAwaitNativeObject } from '../server/await-native-object';
import { makeObject, type RoomState } from '../shared/room';

const roomId = 'a'.repeat(32);
const room = (id?: string): RoomState => ({ id: roomId, title: 'Native test room', revision: 0, events: [],
  objects: id ? [{ ...makeObject('widget', 'test', { x: 0, y: 0 }), id }] : [] });

function setup() {
  let state = room(), reads = 0, cleanups = 0;
  const listeners = new Set<(state: RoomState) => void>();
  const wait = createAwaitNativeObject(() => { reads++; return state; }, (_id, listener) => {
    listeners.add(listener);
    return () => { cleanups++; listeners.delete(listener); };
  });
  return { wait, listeners, reads: () => reads, cleanups: () => cleanups, state: () => state,
    publish: (id?: string) => { state = room(id); for (const listener of listeners) listener(state); } };
}

test('existing native shapes resolve immediately for object IDs and native shape IDs', async () => {
  const fixture = setup(); fixture.publish('target');
  const controller = new AbortController();
  await fixture.wait(roomId, 'target', controller.signal);
  await fixture.wait(roomId, 'shape:target', controller.signal);
  assert.equal(fixture.listeners.size, 0);
  assert.equal(fixture.cleanups(), 0);
  assert.equal(fixture.state().objects.length, 1);
});

test('a pending HTTP edit waits for its exact native shape and ignores unrelated creations', async () => {
  const fixture = setup(), controller = new AbortController();
  let settled = false;
  const pending = fixture.wait(roomId, 'target', controller.signal).then(() => { settled = true; });
  fixture.publish('another-shape'); await Promise.resolve();
  assert.equal(settled, false);
  fixture.publish('target'); await pending;
  assert.equal(settled, true);
  assert.equal(fixture.cleanups(), 1);
  assert.equal(fixture.listeners.size, 0);
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
});

test('a creation between the first read and subscription is caught by the second read', async () => {
  let reads = 0, cleanups = 0;
  const wait = createAwaitNativeObject(() => ++reads === 1 ? room() : room('target'), () => () => { cleanups++; });
  await wait(roomId, 'target', new AbortController().signal);
  assert.equal(reads, 2);
  assert.equal(cleanups, 1);
});

test('aborting cleans up the wait and an already-aborted request does not read the room', async () => {
  const fixture = setup(), controller = new AbortController();
  const pending = fixture.wait(roomId, 'target', controller.signal);
  controller.abort(); await pending;
  assert.equal(fixture.cleanups(), 1);
  assert.equal(fixture.listeners.size, 0);
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
  const before = fixture.reads();
  await fixture.wait(roomId, 'target', controller.signal);
  assert.equal(fixture.reads(), before);
  assert.deepEqual(fixture.state().objects, []);
});

test('the one-second deadline stops listening without creating a missing object', { timeout: 3000 }, async () => {
  const fixture = setup(), controller = new AbortController();
  const startedAt = performance.now();
  await fixture.wait(roomId, 'target', controller.signal);
  assert.ok(performance.now() - startedAt >= 900);
  assert.equal(fixture.cleanups(), 1);
  assert.equal(fixture.listeners.size, 0);
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
  assert.deepEqual(fixture.state().objects, []);
});

test('synchronous delivery and recheck errors each clean their subscription exactly once', async () => {
  let cleanups = 0;
  const immediate = createAwaitNativeObject(() => room(), (_id, listener) => {
    listener(room('target')); return () => { cleanups++; };
  });
  await immediate(roomId, 'target', new AbortController().signal);
  assert.equal(cleanups, 1);
  let reads = 0;
  const failure = new Error('Native room read failed.');
  const failed = createAwaitNativeObject(() => { if (++reads === 2) throw failure; return room(); }, () => () => { cleanups++; });
  const controller = new AbortController();
  await assert.rejects(failed(roomId, 'target', controller.signal), error => error === failure);
  assert.equal(cleanups, 2);
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
});
