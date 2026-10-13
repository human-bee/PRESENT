import test from 'node:test';
import assert from 'node:assert/strict';
import { makeObject } from '../shared/room';
import { objectToShape, shapeToObject } from '../shared/tldraw-adapter';
import { continuityApplyRequestSchema } from '../shared/room-continuity';
import { continuityRecords, previewContinuity, selectedContinuity } from '../server/continuity/content';
const sourceRoomId = 'a'.repeat(48);
const source = [
  objectToShape({ ...makeObject('note', 'PRIVATE_ACTOR', { x: 0, y: 0 }, { text: 'Keep the reviewed decision', transcript: 'PRIVATE_TRANSCRIPT', executor: 'PRIVATE_EXECUTOR' }), id: 'decision' }),
  objectToShape({ ...makeObject('widget', 'PRIVATE_ACTOR', { x: 300, y: 0 }, { capability: 'artifact', format: 'markdown', state: { markdown: '# Reviewed source', jobId: 'PRIVATE_JOB' }, executionState: { threadId: 'PRIVATE_THREAD' } }), id: 'source' }),
  objectToShape({ ...makeObject('widget', 'PRIVATE_ACTOR', { x: 600, y: 0 }, { capability: 'artifact', format: 'html', state: { html: 'PRIVATE_HTML' } }), id: 'html' }),
  objectToShape({ ...makeObject('widget', 'PRIVATE_ACTOR', { x: 900, y: 0 }, { capability: 'work', work: { status: 'running', jobId: 'PRIVATE_JOB' } }), id: 'work' }),
];
test('selective preview allowlists visible native text and Markdown while omitting execution, HTML and ambient metadata', () => {
  const preview = previewContinuity(sourceRoomId, source);
  assert.deepEqual(preview.items.map(item => item.text), ['Keep the reviewed decision', '# Reviewed source']);
  assert.equal(preview.omitted, 2); assert.equal(JSON.stringify(preview).includes('PRIVATE_'), false);
});
test('selected corrected text becomes fresh native notes with provenance and no inherited work authority', () => {
  const before = JSON.stringify(source), preview = previewContinuity(sourceRoomId, source);
  const input = continuityApplyRequestSchema.parse({ sourceRoomId, selection: preview.items.map((item, index) => ({ sourceObjectId: item.sourceObjectId, digest: item.digest, text: index ? item.text : 'Corrected decision' })) });
  const first = continuityRecords(input, source, 1234), second = continuityRecords(input, source, 1235);
  assert.equal(first.length, 3); assert.ok(first.every(record => !source.some(old => old.id === record.id) && !second.some(other => other.id === record.id)));
  const notes = first.filter(record => record.typeName === 'shape').map(record => shapeToObject(record));
  assert.ok(notes[0].x + notes[0].w <= notes[1].x, 'carried native notes have a visible gap');
  assert.deepEqual(notes.map(note => note.data.text), ['Corrected decision', '# Reviewed source']);
  assert.ok(notes.every(note => note.kind === 'note' && note.createdBy === '' && !note.data.work && !note.data.executionState));
  assert.deepEqual(notes[0].data.continuity, { sourceRoomId, sourceObjectId: 'shape:decision', sourceDigest: preview.items[0].digest, kind: 'native-text', corrected: true, copiedAt: 1234 });
  assert.equal(JSON.stringify(first).includes('PRIVATE_'), false); assert.equal(JSON.stringify(source), before);
});
test('stale, deleted, duplicate, empty and unsupported selections fail closed', () => {
  const item = previewContinuity(sourceRoomId, source).items[0];
  const input = continuityApplyRequestSchema.parse({ sourceRoomId, selection: [{ sourceObjectId: item.sourceObjectId, digest: item.digest, text: item.text }] });
  assert.throws(() => selectedContinuity(input, source.slice(1)), /changed or is no longer/);
  assert.throws(() => selectedContinuity({ ...input, selection: [input.selection[0], input.selection[0]] }, source), /only once/);
  assert.throws(() => selectedContinuity({ ...input, selection: [{ ...input.selection[0], sourceObjectId: 'shape:html' }] }, source), /changed or is no longer/);
  assert.throws(() => continuityApplyRequestSchema.parse({ ...input, selection: [] }));
  assert.throws(() => continuityApplyRequestSchema.parse({ ...input, selection: [{ ...input.selection[0], executionState: { threadId: 'forbidden' } }] }));
});

