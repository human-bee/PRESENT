import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { RoomStore } from '../server/room-store';
import { makeObject } from '../shared/room';
import { objectToShape, shapeIdForObject } from '../shared/tldraw-adapter';
import type { PresentWidgetShape } from '../shared/tldraw-schema';

const roomId = 'd'.repeat(32);
function setup() {
  const base = mkdtempSync(join(tmpdir(), 'present-tldraw-')), directory = join(base, 'native'), legacyDirectory = join(base, 'originals');
  mkdirSync(legacyDirectory);
  const store = new RoomStore({ directory, legacyDirectory, debounceMs: 100_000 });
  return { base, directory, legacyDirectory, store, close: () => { store.close(); rmSync(base, { recursive: true, force: true }); } };
}

test('native storage is the sole authority and immediate flush persists direct native writes', () => {
  const { store, directory, legacyDirectory, close } = setup();
  try {
    const native = store.getTldrawRoom(roomId);
    assert.equal(store.getTldrawRoom(roomId), native);
    const widget = makeObject('widget', 'alice', { x: 0, y: 0 }, { html: '<p>score</p>', state: { score: 0, left: 0 } });
    store.applyOperation(roomId, { type: 'put', object: widget }, 'alice'); store.flush();
    native.storage.transaction(transaction => {
      const shape = transaction.get(shapeIdForObject(widget.id)) as PresentWidgetShape;
      transaction.set(shape.id, { ...shape, x: 75, props: { ...shape.props, data: { ...shape.props.data, state: { score: 5, left: 0 } } } });
    });
    // Flush must observe the native clock before its onChange microtask runs.
    store.flush();
    const restored = new RoomStore({ directory, legacyDirectory });
    assert.equal(restored.getRoom(roomId).objects[0].x, 75);
    assert.equal((restored.getRoom(roomId).objects[0].data.state as { score: number }).score, 5);
    restored.close();
    store.applyOperation(roomId, { type: 'increment', id: widget.id, key: 'score', by: 1 }, 'agent:spark');
    const canonical = store.getCanvasRecords(roomId).find(record => record.id === shapeIdForObject(widget.id)) as PresentWidgetShape;
    assert.equal((canonical.props.data.state as { score: number }).score, 6);
    assert.equal(store.getRoom(roomId).revision, native.getCurrentDocumentClock());
    assert.equal('objects' in JSON.parse(readFileSync(join(directory, `${roomId}.json`), 'utf8')), false);
  } finally { close(); }
});

test('one-way migration preserves original bytes and writes native note, draw, widget and image records', () => {
  const { store, directory, legacyDirectory, close } = setup();
  try {
    const objects = [
      makeObject('note', 'alice', { x: 10, y: 20 }, { text: 'Keep my original thought' }),
      makeObject('ink', 'alice', { x: 30, y: 40 }, { points: [[0, 0], [80, 60]] }),
      makeObject('widget', 'alice', { x: 100, y: 100 }, { html: '<p>Shared</p>', state: { count: 2 } }),
      makeObject('image', 'alice', { x: 300, y: 100 }, { src: 'https://example.com/safe.png', mimeType: 'image/png', imageWidth: 1024, imageHeight: 768, provenance: { model: 'test', prompt: 'Synthetic test image' } }),
    ];
    const original = JSON.stringify({ state: { id: roomId, title: 'Original room', revision: 4, objects, events: [] }, requests: [] });
    const source = join(legacyDirectory, `${roomId}.json`); writeFileSync(source, original);
    assert.equal(store.getRoom(roomId).title, 'Original room');
    store.applyOperation(roomId, { type: 'patch', id: objects[0].id, patch: { data: { text: 'Native edit after import' } } }, 'agent:spark');
    store.flush();
    assert.equal(readFileSync(source, 'utf8'), original);
    const snapshot = JSON.parse(readFileSync(join(directory, `${roomId}.json`), 'utf8'));
    assert.equal('state' in snapshot, false);
    assert.deepEqual(snapshot.documents.filter((entry: { state: { typeName: string } }) => entry.state.typeName === 'shape').map((entry: { state: { type: string } }) => entry.state.type).sort(), ['draw', 'image', 'note', 'present-widget']);
    const image = store.getRoom(roomId).objects.find(object => object.kind === 'image');
    assert.ok(image);
    assert.equal(image.data.imageWidth, 1024);
    assert.deepEqual(image.data.provenance, { model: 'test', prompt: 'Synthetic test image' });
    const restored = new RoomStore({ directory, legacyDirectory });
    assert.equal(restored.getRoom(roomId).objects.find(object => object.id === objects[0].id)?.data.text, 'Native edit after import');
    restored.close();
  } finally { close(); }
});

test('native batch validation rolls back every record and command retry deduplicates before building', () => {
  const { store, close } = setup();
  try {
    const object = makeObject('widget', 'alice', { x: 0, y: 0 }, { state: { score: 1 } });
    const shape = objectToShape(object);
    const invalid = { ...shape, id: 'shape:invalid', props: { ...shape.props, w: -1 } } as typeof shape;
    assert.throws(() => store.mutateCanvas(roomId, { creates: [shape, invalid] }, 'agent:spark'), /dimensions/);
    assert.equal(store.getRoom(roomId).objects.length, 0);
    assert.equal(store.getRoom(roomId).revision, 0);
    let builds = 0;
    const build = () => { builds++; return { creates: [shape] }; };
    const receipt = store.transactCanvas(roomId, { command: 'create a score' }, 'agent:spark', build, { requestId: 'once-only' });
    const repeated = store.transactCanvas(roomId, { command: 'create a score' }, 'agent:spark', build, { requestId: 'once-only' });
    assert.equal(builds, 1);
    assert.equal(repeated.revision, receipt.revision);
    assert.equal(repeated.objects.length, 1);
  } finally { close(); }
});
