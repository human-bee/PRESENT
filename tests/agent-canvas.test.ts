import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { b64Vecs, type TLShape } from '@tldraw/tlschema';
import { canvasToolSchemas } from '../shared/canvas-commands';
import { presentSchema } from '../shared/tldraw-schema';
import { buildCanvasMutation } from '../server/agents/canvas-tools';
import { RoomStore } from '../server/room-store';
import { VoiceOwnership } from '../server/agents/voice-ownership';
import { voiceTools } from '../server/agents/voice-tools';

const roomId = 'c'.repeat(32), actor = 'canvas-test';
const fixtures = () => {
  const directory = mkdtempSync(join(tmpdir(), 'present-canvas-'));
  const store = new RoomStore({ directory, legacyDirectory: join(directory, 'legacy') });
  const records = store.getCanvasRecords(roomId);
  const pageId = records.find(record => record.typeName === 'page')?.id;
  assert.ok(pageId);
  return { store, pageId, close: () => { store.close(); rmSync(directory, { recursive: true, force: true }); } };
};

test('native canvas batch creates valid selectable SDK shape records in the owning shared document', () => {
  const f = fixtures();
  try {
    const batch = canvasToolSchemas.apply_canvas.parse({ pageId: f.pageId, commands: [
      { type: 'create_geo', x: 20, y: 30, w: 180, h: 100, geo: 'ellipse', text: 'Launch' },
      { type: 'create_text', x: 250, y: 30, text: 'Research' },
      { type: 'create_arrow', x: 20, y: 160, start: { x: 0, y: 0 }, end: { x: 180, y: 20 } },
      { type: 'create_draw', x: 20, y: 200, points: [{ x: 0, y: 0 }, { x: 20, y: 30 }, { x: 40, y: 10 }] },
    ] });
    const built = buildCanvasMutation(batch, f.store.getCanvasRecords(roomId), actor, 'create-batch');
    f.store.mutateCanvas(roomId, built.mutation, actor);
    const shapes = f.store.getCanvasRecords(roomId).filter((record): record is TLShape => record.typeName === 'shape');
    assert.deepEqual(shapes.map(shape => shape.type).sort(), ['arrow', 'draw', 'geo', 'text']);
    for (const shape of shapes) { presentSchema.types.shape.validate(shape); assert.equal(shape.parentId, f.pageId); }
    const draw = shapes.find(shape => shape.type === 'draw'); assert.equal(draw?.type, 'draw');
    if (draw?.type === 'draw') assert.equal(b64Vecs.decodePoints(draw.props.segments[0].path).length, 3);
    assert.equal(f.store.getRoom(roomId).objects.length, 4);
  } finally { f.close(); }
});

test('explicit arrow bindings and typed updates preserve native identity; missing targets never become creates', () => {
  const f = fixtures();
  try {
    const initial = buildCanvasMutation(canvasToolSchemas.apply_canvas.parse({ pageId: f.pageId, commands: [{ type: 'create_geo', x: 0, y: 0, w: 100, h: 100, geo: 'rectangle' }] }), f.store.getCanvasRecords(roomId), actor, 'initial');
    f.store.mutateCanvas(roomId, initial.mutation, actor);
    const id = initial.shapeIds[0];
    const batch = canvasToolSchemas.apply_canvas.parse({ pageId: f.pageId, commands: [
      { type: 'update_shape', id, x: 100, patch: { shapeType: 'geo', props: { text: 'Launch', color: 'blue' } } },
      { type: 'create_arrow', x: 0, y: 0, start: { x: 0, y: 0 }, end: { x: 100, y: 0 }, endBinding: { toId: id } },
    ] });
    f.store.mutateCanvas(roomId, buildCanvasMutation(batch, f.store.getCanvasRecords(roomId), actor, 'bind').mutation, actor);
    const records = f.store.getCanvasRecords(roomId), target = records.find(record => record.id === id);
    assert.equal(target?.typeName, 'shape'); if (target?.typeName === 'shape') { assert.equal(target.x, 100); assert.equal(target.type, 'geo'); }
    assert.ok(records.find(record => record.typeName === 'binding' && record.toId === id));
    const revision = f.store.getRoom(roomId).revision;
    const missing = canvasToolSchemas.apply_canvas.parse({ pageId: f.pageId, commands: [{ type: 'update_shape', id: 'shape:missing', patch: { shapeType: 'geo', props: { color: 'red' } } }] });
    assert.throws(() => buildCanvasMutation(missing, records, actor), /exact target shape is missing/);
    const wrongType = canvasToolSchemas.apply_canvas.parse({ pageId: f.pageId, commands: [{ type: 'update_shape', id, patch: { shapeType: 'text', props: { text: 'Wrong' } } }] });
    assert.throws(() => buildCanvasMutation(wrongType, records, actor), /shape type changed/);
    assert.equal(f.store.getRoom(roomId).revision, revision);
    f.store.mutateCanvas(roomId, { deletes: [id] }, actor);
    assert.equal(f.store.getCanvasRecords(roomId).filter(record => record.typeName === 'binding').length, 0);
  } finally { f.close(); }
});

test('native commands reject invalid geometry, oversized batches and arbitrary raw record props', () => {
  const command = { type: 'create_geo', x: 0, y: 0, w: 100, h: 100, geo: 'ellipse' };
  assert.equal(canvasToolSchemas.apply_canvas.safeParse({ pageId: 'page:page', commands: [{ ...command, w: -1 }] }).success, false);
  assert.equal(canvasToolSchemas.apply_canvas.safeParse({ pageId: 'page:page', commands: Array(21).fill(command) }).success, false);
  assert.equal(canvasToolSchemas.apply_canvas.safeParse({ pageId: 'page:page', commands: [{ ...command, props: { html: '<script />' } }] }).success, false);
  assert.equal(canvasToolSchemas.apply_canvas.safeParse({ pageId: 'page:page', commands: [{ type: 'create_draw', x: 0, y: 0, points: [{ x: Infinity, y: 0 }, { x: 1, y: 1 }] }] }).success, false);
  assert.ok(voiceTools.some(tool => tool.name === 'read_canvas'));
  assert.ok(voiceTools.some(tool => tool.name === 'apply_canvas'));
});

test('same-batch references bind arrows to native notes and preserve the binding after movement', () => {
  const f = fixtures();
  try {
    const commands = [
      { type: 'create_note', x: 0, y: 0, ref: 'idea', text: 'Idea' },
      { type: 'create_geo', x: 300, y: 0, ref: 'build', w: 180, h: 100, geo: 'rectangle', text: 'Build' },
      { type: 'create_arrow', x: 100, y: 50, start: { x: 0, y: 0 }, end: { x: 200, y: 0 }, startBinding: { toRef: 'idea' }, endBinding: { toRef: 'build' } },
    ];
    let attempt = 0;
    const build = (input: unknown) => buildCanvasMutation(canvasToolSchemas.apply_canvas.parse(input), f.store.getCanvasRecords(roomId), actor, `refs-${attempt++}`);
    const built = build({ pageId: f.pageId, commands });
    f.store.mutateCanvas(roomId, built.mutation, actor);
    let records = f.store.getCanvasRecords(roomId);
    const note = records.find((record): record is TLShape => record.typeName === 'shape' && record.type === 'note');
    assert.ok(note); assert.equal(records.filter(record => record.typeName === 'binding').length, 2);
    f.store.mutateCanvas(roomId, { updates: [{ id: note.id, type: 'note', x: 700 }] }, actor);
    records = f.store.getCanvasRecords(roomId);
    assert.ok(records.some(record => record.typeName === 'binding' && record.toId === note.id));
    assert.throws(() => build({ pageId: f.pageId, commands: [commands[2]] }), /reference|target/i);
    assert.throws(() => build({ pageId: f.pageId, commands: [commands[0], commands[0]] }), /reference/i);
  } finally { f.close(); }
});

test('owning document ledger checks original commands before rebuilding a replay against a changed scene', () => {
  const f = fixtures();
  try {
    const input = canvasToolSchemas.apply_canvas.parse({ pageId: f.pageId, commands: [{ type: 'create_text', x: 0, y: 0, text: 'Replay safely' }] });
    let builds = 0;
    const build = (records: Parameters<typeof buildCanvasMutation>[1]) => { builds++; return buildCanvasMutation(input, records, actor, 'durable-replay').mutation; };
    f.store.transactCanvas(roomId, input, actor, build, { requestId: 'durable-replay' });
    const shape = f.store.getCanvasRecords(roomId).find((record): record is TLShape => record.typeName === 'shape'); assert.ok(shape);
    f.store.mutateCanvas(roomId, { updates: [{ id: shape.id, type: shape.type, x: 200 }] }, actor);
    const before = f.store.getRoom(roomId).revision;
    f.store.transactCanvas(roomId, input, actor, build, { requestId: 'durable-replay' });
    assert.equal(builds, 1); assert.equal(f.store.getRoom(roomId).revision, before);
    const after = f.store.getCanvasRecords(roomId).find(record => record.id === shape.id);
    assert.equal(after?.typeName === 'shape' && after.x, 200);
    assert.throws(() => f.store.transactCanvas(roomId, { ...input, commands: [] }, actor, build, { requestId: 'durable-replay' }), /different operation/);
  } finally { f.close(); }
});

test('Realtime ownership deduplicates an entire native batch and suppresses stopped listener work', async () => {
  const f = fixtures();
  try {
    const ownership = new VoiceOwnership(), sessionId = 'canvas-session-1234';
    ownership.begin(roomId, actor, sessionId); ownership.activate(roomId, sessionId);
    const args = canvasToolSchemas.apply_canvas.parse({ pageId: f.pageId, commands: [{ type: 'create_text', x: 0, y: 0, text: 'Exactly once' }] });
    const request = { roomId, actor, sessionId, callId: 'call_canvas', name: 'apply_canvas', arguments: args };
    let count = 0;
    const execute = async () => { count++; const built = buildCanvasMutation(args, f.store.getCanvasRecords(roomId), actor); f.store.mutateCanvas(roomId, built.mutation, actor); return built.shapeIds; };
    const [first, second] = await Promise.all([ownership.runTool(request, execute), ownership.runTool(request, execute)]);
    assert.deepEqual(first, second); assert.equal(count, 1); assert.equal(f.store.getRoom(roomId).objects.length, 1);
    const pending = ownership.runTool({ ...request, callId: 'call_cancelled' }, execute);
    ownership.stop(roomId, sessionId);
    await assert.rejects(pending, /no longer active/); assert.equal(count, 1);
  } finally { f.close(); }
});
