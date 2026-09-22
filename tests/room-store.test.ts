import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { RoomStore } from '../server/room-store.js';
import { MAX_SHAPES } from '../server/tldraw-storage.js';
import type { RoomObject } from '../shared/room.js';

const roomA = 'a'.repeat(32);
const roomB = 'b'.repeat(32);
const makeNote = (id = 'note-one'): RoomObject => ({ id, kind: 'note', x: 0, y: 0, w: 300, h: 200, title: 'A thought', data: { text: 'Hello', color: 'mint' }, pinned: false, createdAt: 1, createdBy: 'forged-client', expiresAt: null });
function setup(now?: () => number) {
  const directory = mkdtempSync(join(tmpdir(), 'present-room-'));
  const store = new RoomStore({ directory, now, debounceMs: 100_000 });
  return { directory, store, cleanup: () => { store.close(); rmSync(directory, { recursive: true, force: true }); } };
}
test('serial operations preserve unrelated fields and assign server identity', () => {
  const { store, cleanup } = setup(() => 100);
  try {
    store.applyOperation(roomA, { type: 'put', object: makeNote() }, 'human-a');
    store.applyOperation(roomA, { type: 'patch', id: 'note-one', patch: { data: { text: 'Edited by A' } } }, 'human-a');
    store.applyOperation(roomA, { type: 'patch', id: 'note-one', patch: { x: 80, data: { color: 'violet' } } }, 'human-b');
    const state = store.getRoom(roomA);
    assert.equal(state.revision, 3);
    assert.equal(state.objects[0].createdBy, 'human-a');
    assert.equal(state.objects[0].createdAt, 100);
    assert.deepEqual(state.objects[0].data, { text: 'Edited by A', color: 'violet' });
    assert.equal(state.objects[0].x, 80);
    store.applyOperation(roomA, { type: 'patch', id: 'note-one', patch: { pinned: true, expiresAt: 500 } }, 'human-a');
    store.applyOperation(roomA, { type: 'patch', id: 'note-one', patch: { x: 90 } }, 'human-b');
    assert.equal(store.getRoom(roomA).objects[0].pinned, true);
    assert.equal(store.getRoom(roomA).objects[0].expiresAt, 500);
    state.objects[0].data.text = 'Cannot mutate stored state';
    assert.equal(store.getRoom(roomA).objects[0].data.text, 'Edited by A');
  } finally { cleanup(); }
});
test('malformed operations, duplicate puts and missing targets fail without changing state', () => {
  const { store, cleanup } = setup();
  try {
    assert.throws(() => store.applyOperation('../escape', { type: 'rename', title: 'bad' }, 'human'));
    assert.throws(() => store.applyOperation(roomA, { type: 'put', object: { ...makeNote(), x: Infinity } }, 'human'));
    assert.throws(() => store.applyOperation(roomA, { type: 'put', object: { ...makeNote(), data: { invalid: () => 1 } } }, 'human'), /JSON/);
    assert.throws(() => store.applyOperation(roomA, { type: 'put', object: { ...makeNote(), data: { invalid: NaN } } }, 'human'), /JSON/);
    store.applyOperation(roomA, { type: 'put', object: makeNote() }, 'human');
    assert.throws(() => store.applyOperation(roomA, { type: 'put', object: makeNote() }, 'human'), /already exists/);
    assert.throws(() => store.applyOperation(roomA, { type: 'patch', id: 'missing', patch: { x: 1 } }, 'human'), /no longer exists/);
    assert.throws(() => store.applyOperation(roomA, { type: 'remove', id: 'missing' }, 'human'), /no longer exists/);
    assert.throws(() => store.applyOperation(roomA, { type: 'patch', id: 'note-one', patch: {} }, 'human'), /empty/);
    assert.throws(() => store.applyOperation(roomA, { type: 'patch', id: 'note-one', patch: { data: { text: 'a'.repeat(40_000) } } }, 'human'), /too large/);
    assert.equal(store.getRoom(roomA).revision, 1);
  } finally { cleanup(); }
});
test('room isolation, subscriptions and removal are authoritative', () => {
  const { store, cleanup } = setup();
  try {
    const revisions: number[] = [];
    const unsubscribe = store.subscribeRoom(roomA, (state) => revisions.push(state.revision));
    store.applyOperation(roomB, { type: 'put', object: makeNote() }, 'human-b');
    assert.equal(store.getRoom(roomA).objects.length, 0);
    assert.deepEqual(revisions, []);
    store.applyOperation(roomA, { type: 'put', object: makeNote() }, 'human-a');
    store.applyOperation(roomA, { type: 'remove', id: 'note-one' }, 'human-a');
    assert.deepEqual(revisions, [1, 2]);
    unsubscribe();
    store.applyOperation(roomA, { type: 'rename', title: 'Quiet' }, 'human-a');
    assert.deepEqual(revisions, [1, 2]);
    assert.equal(store.getRoom(roomB).objects.length, 1);
  } finally { cleanup(); }
});
test('atomic persistence survives restart, including request deduplication and removals', () => {
  const { store, directory, cleanup } = setup();
  let restored: RoomStore | undefined;
  try {
    const operation = { type: 'put', object: makeNote() };
    const first = store.applyOperation(roomA, operation, 'human-a', { requestId: 'request-one' });
    const again = store.applyOperation(roomA, operation, 'human-a', { requestId: 'request-one' });
    assert.equal(first.revision, again.revision);
    assert.throws(() => store.applyOperation(roomA, { type: 'rename', title: 'collision' }, 'human-a', { requestId: 'request-one' }), /different operation/);
    store.flush();
    restored = new RoomStore({ directory, debounceMs: 100_000 });
    assert.deepEqual(restored.getRoom(roomA), first);
    assert.equal(restored.applyOperation(roomA, operation, 'reconnected-human', { requestId: 'request-one' }).revision, first.revision);
    restored.applyOperation(roomA, { type: 'remove', id: 'note-one' }, 'human-a');
    restored.flush();
    const restarted = new RoomStore({ directory });
    assert.equal(restarted.getRoom(roomA).objects.length, 0);
    restarted.close();
  } finally { restored?.close(); cleanup(); }
});
test('expiry removes unpinned objects and pinning preserves them across restart', () => {
  let now = 100;
  const { store, directory, cleanup } = setup(() => now);
  try {
    store.applyOperation(roomA, { type: 'put', object: { ...makeNote('ephemeral'), expiresAt: 150 } }, 'human');
    store.applyOperation(roomA, { type: 'put', object: { ...makeNote('pinned'), pinned: true, expiresAt: 150 } }, 'human');
    now = 200;
    store.sweepExpired();
    assert.deepEqual(store.getRoom(roomA).objects.map((object) => object.id), ['pinned']);
    assert.equal(store.getRoom(roomA).revision, 3);
    store.flush();
    const restored = new RoomStore({ directory, now: () => 300 });
    assert.deepEqual(restored.getRoom(roomA).objects.map((object) => object.id), ['pinned']);
    restored.close();
  } finally { cleanup(); }
});
test('repeated room reads stay detached and refresh at the next expiry or mutation', () => {
  let now = 100;
  const { store, cleanup } = setup(() => now);
  try {
    store.applyOperation(roomA, { type: 'put', object: makeNote() }, 'human');
    const exposed = store.getRoom(roomA);
    exposed.objects[0].data.text = 'Changed outside the store';
    assert.equal(store.getRoom(roomA).objects[0].data.text, 'Hello');
    store.applyOperation(roomA, { type: 'patch', id: 'note-one', patch: { data: { text: 'Saved edit' }, expiresAt: 150 } }, 'human');
    assert.equal(store.getRoom(roomA).objects[0].data.text, 'Saved edit');
    now = 149; assert.equal(store.getRoom(roomA).objects.length, 1);
    now = 150; assert.equal(store.getRoom(roomA).objects.length, 0);
  } finally { cleanup(); }
});
test('object and room caps bound storage', () => {
  const { store, directory, cleanup } = setup();
  try {
    store.applyOperation(roomA, { type: 'put', object: makeNote('seed') }, 'human');
    const seed = store.getCanvasRecords(roomA).find(record => record.typeName === 'shape')!;
    for (let start = 1; start < MAX_SHAPES; start += 100) {
      store.mutateCanvas(roomA, { creates: Array.from({ length: Math.min(100, MAX_SHAPES - start) }, (_, i) => ({ ...seed, id: `shape:capacity-${start + i}` as typeof seed.id })) }, 'human');
    }
    const before = store.getCanvasRecords(roomA);
    assert.throws(() => store.applyOperation(roomA, { type: 'put', object: makeNote('too-many') }, 'human'), /object limit/);
    assert.deepEqual(store.getCanvasRecords(roomA), before, 'rejected writes are atomic');
    store.flush();
    const restored = new RoomStore({ directory });
    assert.equal(restored.getCanvasRecords(roomA).filter(record => record.typeName === 'shape').length, MAX_SHAPES);
    restored.close();
    const limited = new RoomStore({ directory, maxRooms: 1 });
    assert.throws(() => limited.getRoom(roomB), /room limit/);
    limited.close();
  } finally { cleanup(); }
});

test('stale widget updates merge canonical state keys while other nested data keeps replacement semantics', () => {
  const { store, cleanup } = setup();
  try {
    store.applyOperation(roomA, { type: 'put', object: { ...makeNote(), kind: 'widget', data: { html: '<p>Shared</p>', state: { left: 0, right: 0, nested: { old: true } }, settings: { old: true } } } }, 'human-a');
    // These independent partial updates were composed from the same revision.
    store.applyOperation(roomA, { type: 'patch', id: 'note-one', patch: { data: { state: { left: 1, 'vote:alice': 0 } } } }, 'human-a');
    store.applyOperation(roomA, { type: 'patch', id: 'note-one', patch: { data: { state: { right: 1, 'vote:bob': 2 } } } }, 'human-b');
    assert.deepEqual(store.getRoom(roomA).objects[0].data.state, { left: 1, right: 1, nested: { old: true }, 'vote:alice': 0, 'vote:bob': 2 });
    store.applyOperation(roomA, { type: 'patch', id: 'note-one', patch: { data: { state: { nested: { new: true }, 'vote:alice': 1 }, settings: { new: true } } } }, 'human-a');
    const data = store.getRoom(roomA).objects[0].data;
    assert.deepEqual(data.state, { left: 1, right: 1, nested: { new: true }, 'vote:alice': 1, 'vote:bob': 2 });
    assert.deepEqual(data.settings, { new: true });
    assert.equal(data.html, '<p>Shared</p>');
    assert.throws(() => store.applyOperation(roomA, { type: 'patch', id: 'note-one', patch: { data: { state: [] } } }, 'human-a'), /JSON object/);
  } finally { cleanup(); }
});

test('widget increments are atomic and request-deduplicated with numeric validation', () => {
  const { store, cleanup } = setup();
  try {
    store.applyOperation(roomA, { type: 'put', object: { ...makeNote(), kind: 'widget', data: { state: { label: 'Score', empty: null } } } }, 'human-a');
    const operation = { type: 'increment', id: 'note-one', key: 'score', by: 1 };
    store.applyOperation(roomA, operation, 'human-a', { requestId: 'alice-increment' });
    store.applyOperation(roomA, operation, 'human-b', { requestId: 'bob-increment' });
    store.applyOperation(roomA, operation, 'human-a', { requestId: 'alice-increment' });
    assert.deepEqual(store.getRoom(roomA).objects[0].data.state, { label: 'Score', empty: null, score: 2 });
    for (const key of ['label', 'empty']) assert.throws(() => store.applyOperation(roomA, { ...operation, key }, 'human-a'), /numeric/);
    assert.throws(() => store.applyOperation(roomA, { ...operation, key: '__proto__' }, 'human-a'));
    assert.throws(() => store.applyOperation(roomA, { ...operation, by: Infinity }, 'human-a'));
    store.applyOperation(roomA, { type: 'put', object: makeNote('ordinary-note') }, 'human-a');
    assert.throws(() => store.applyOperation(roomA, { ...operation, id: 'ordinary-note' }, 'human-a'), /Only widget/);
    assert.throws(() => store.applyOperation(roomA, { type: 'patch', id: 'note-one', patch: { data: { nested: JSON.parse('{"constructor":{"bad":true}}') } } }, 'human-a'), /JSON/);
  } finally { cleanup(); }
});
