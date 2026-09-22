import assert from 'node:assert/strict';
import test from 'node:test';
import type { TLNoteShape } from '@tldraw/tlschema';
import type { IndexKey } from '@tldraw/utils';
import { makeObject } from '../shared/room';
import { imageToRecords, objectToRecords, objectToShape, patchNativeShape, recordsToRoom, shapeToObject } from '../shared/tldraw-adapter';
import { presentSchema } from '../shared/tldraw-schema';

test('DTO geometry edits preserve native note formatting and styling', () => {
  const shape = objectToShape(makeObject('note', 'alice', { x: 0, y: 0 }, { text: 'Keep formatting' }));
  assert.equal(shape.type, 'note');
  if (shape.type !== 'note') throw new Error();
  const styled: TLNoteShape = { ...shape, rotation: .4, opacity: .7, props: { ...shape.props, font: 'serif', size: 'l', richText: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Keep formatting', marks: [{ type: 'bold' }] }] }] } } };
  presentSchema.types.shape.validate(styled);
  const moved = patchNativeShape(styled, { x: 100, pinned: true });
  assert.equal(moved.type, 'note');
  assert.deepEqual(moved.props, styled.props);
  assert.equal(moved.rotation, .4);
  assert.equal(moved.opacity, .7);
  assert.equal(shapeToObject(moved).pinned, true);
  assert.equal(shapeToObject(moved).data.text, 'Keep formatting');
});

test('freehand DTO imports use native draw paths and retain them when moved', () => {
  const shape = objectToShape(makeObject('ink', 'alice', { x: 10, y: 20 }, { points: [[0, 0], [50, 20], [80, 60]] }));
  assert.equal(shape.type, 'draw');
  const moved = patchNativeShape(shape, { x: 500 });
  assert.deepEqual(moved.props, shape.props);
  const points = shapeToObject(moved).data.points as { x: number; y: number }[];
  assert.deepEqual(points.map(point => [point.x, point.y]), [[0, 0], [50, 20], [80, 60]]);
});

test('widget state is stored once and partial updates retain unrelated native props', () => {
  const object = makeObject('widget', 'alice', { x: 0, y: 0 }, { html: '<p>shared</p>', state: { a: 1, b: 2 } });
  const shape = objectToShape(object);
  assert.equal(shape.type, 'present-widget');
  assert.deepEqual(shape.meta, {});
  const updated = patchNativeShape(shape, { data: { state: { a: 4 } } });
  assert.deepEqual(shapeToObject(updated).data, { html: '<p>shared</p>', state: { a: 4, b: 2 } });
  assert.equal(shapeToObject(updated).createdBy, 'alice');
});

test('native images keep source in reusable asset records with durable image provenance', () => {
  const image = { ...makeObject('image', 'agent:spark', { x: 0, y: 0 }, { src: 'https://example.com/generated.png', mimeType: 'image/png', imageWidth: 1024, imageHeight: 768, provenance: { model: 'test-model', prompt: 'A synthetic image' } }), kind: 'image' as const };
  const options = { index: 'a1' as IndexKey };
  const records = imageToRecords(image, options);
  assert.deepEqual(objectToRecords(image, options), records);
  assert.equal(records[0].typeName, 'asset');
  assert.equal(records[1].typeName, 'shape');
  assert.equal(JSON.stringify(records[1]).includes('https://example.com'), false);
  const projected = recordsToRoom('test', records).objects[0];
  assert.equal(projected.kind, 'image');
  assert.equal(projected.data.src, 'https://example.com/generated.png');
  assert.equal(projected.data.imageWidth, 1024);
  assert.deepEqual(projected.data.provenance, { model: 'test-model', prompt: 'A synthetic image' });
});
