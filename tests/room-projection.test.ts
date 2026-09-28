import test from 'node:test';
import assert from 'node:assert/strict';
import { DocumentRecordType, type TLAsset, type TLShape } from '@tldraw/tlschema';
import { makeObject } from '../shared/room';
import { objectToRecords, objectToShape, recordsToRoom } from '../shared/tldraw-adapter';
import { createRoomProjection } from '../src/tldraw/room-projection';

test('projection matches the canonical view and retains unchanged objects while dragging', () => {
  const project = createRoomProjection('room');
  const document = DocumentRecordType.create({ name: 'Shared room' });
  const shapes = Array.from({ length: 20 }, (_, i) => objectToShape(makeObject('widget', 'person', { x: i * 50, y: 0 }, { state: { count: i } })));
  const assets: TLAsset[] = [];
  const first = project(shapes, assets, document);
  assert.deepEqual(first, recordsToRoom('room', [document, ...shapes]));
  assert.equal(project(shapes, assets, document), first);
  assert.equal(project([...shapes], [...assets], document), first);
  const moved = shapes.map((shape, i) => i === 3 ? { ...shape, x: 900 } : shape);
  const second = project(moved, assets, document);
  assert.deepEqual(second, recordsToRoom('room', [document, ...moved]));
  for (let i = 0; i < shapes.length; i++) assert.equal(second.objects[i] === first.objects[i], i !== 3);
  const removed = project(moved.slice(1), assets, document);
  assert.equal(removed.objects.length, 19);
  assert.equal(removed.objects[0], second.objects[1]);
  assert.equal(project(shapes, assets, document).objects[3], first.objects[3], 'undo can reuse the immutable original');
});

test('image asset replacement, deletion, document edits and shape ordering stay current', () => {
  const project = createRoomProjection('images');
  const document = DocumentRecordType.create({ name: 'Before' });
  const records = objectToRecords(makeObject('image', 'person', { x: 0, y: 0 }, { src: '/api/assets/one.png', imageWidth: 200, imageHeight: 100 }));
  const asset = records.find(r => r.typeName === 'asset') as TLAsset;
  const shape = records.find(r => r.typeName === 'shape') as TLShape;
  const a = project([shape], [asset], document);
  const replaced = { ...asset, props: { ...asset.props, src: '/api/assets/two.png' } } as TLAsset;
  const b = project([shape], [replaced], document);
  assert.equal(b.objects[0].data.src, '/api/assets/two.png');
  assert.equal(a.objects[0].data.src, '/api/assets/one.png');
  const missing = project([shape], [], { ...document, name: 'After' });
  assert.equal(missing.objects[0].data.src, undefined);
  assert.equal(missing.title, 'After');
  assert.deepEqual(missing, recordsToRoom('images', [{ ...document, name: 'After' }, shape]));
});
