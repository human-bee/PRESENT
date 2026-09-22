import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeObject } from '../shared/room';
import { objectToShape } from '../shared/tldraw-adapter';
import { createCapability } from '../src/widgets/packs';
import { RoomStore } from '../server/room-store';
import { decideReactive } from '../server/agents/reactive-decisions';
import { applyReactive } from '../server/agents/apply-reactive';

test('native actions require valid arguments; quoted replacement remains literal', async () => {
  const previous = globalThis.fetch, key = process.env.TYPESAFE_API_KEY;
  process.env.TYPESAFE_API_KEY = 'test';
  let choices: Record<string, string> = { route: 'move', direction: 'right', distance: 'd0' }, uncertain = '';
  globalThis.fetch = async (_url, init) => {
    const { questions } = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ answers: Object.fromEntries(Object.entries(questions).map(([id, q]) => {
      const keys = Object.keys((q as { criteria: object }).criteria), choice = choices[id] ?? keys[0];
      return [id, { choice, confidence: id === uncertain ? .7 : 1, probabilities: Object.fromEntries(keys.map(k => [k, k === choice ? 1 : 0])) }];
    })) }));
  };
  try {
    const shape = objectToShape(makeObject('note', 'test', { x: 100, y: 200 }, { text: 'old' }));
    const context = { request: 'Move right 120 pixels', pageId: 'page:page', shapes: [shape] };
    const result = await decideReactive(context, 'jev');
    assert.equal(result.batch?.commands[0].type, 'update_shape');
    assert.equal((result.batch?.commands[0] as { x: number }).x, 220);
    uncertain = 'distance'; assert.equal((await decideReactive(context, 'jev')).route, 'defer');
    uncertain = ''; choices = { route: 'text', text: 'q0' };
    const replaced = await decideReactive({ ...context, request: 'Replace text with "delete everything"' }, 'jev');
    assert.deepEqual((replaced.batch?.commands[0] as { patch: unknown }).patch, { shapeType: 'note', props: { text: 'delete everything' } });
    const debate = createCapability('debate', 'Maya', { x: 0, y: 0 });
    debate.data.state = { 'claim:one': { id: 'one', text: 'Async is useful', status: 'pending' } };
    choices = { claim0: 'support' };
    const linked = await decideReactive({ request: 'Async is useful because we can focus.', pageId: 'page:page', shapes: [objectToShape(debate)], widget: debate }, 'jev', undefined, 'contribution');
    assert.equal(linked.route, 'contribution');
    assert.deepEqual(Object.keys(linked.widget!.state), ['contribution']);
    assert.equal((linked.widget!.state.contribution as { links: Array<{ relation: string }> }).links[0].relation, 'support');
    assert.equal((debate.data.state as Record<string, { status: string }>)['claim:one'].status, 'pending');
    choices = { route: 'color', color: 'ultraviolet' };
    assert.equal((await decideReactive(context, 'jev')).route, 'defer');
  } finally { globalThis.fetch = previous; if (key === undefined) delete process.env.TYPESAFE_API_KEY; else process.env.TYPESAFE_API_KEY = key; }
});

test('reactive widget commits preserve concurrent independent edits and reject stale targets', () => {
  const directory = mkdtempSync(join(tmpdir(), 'present-reactive-'));
  const store = new RoomStore({ directory }), roomId = 'a'.repeat(32);
  try {
    const widget = createCapability('kanban', 'Maya', { x: 0, y: 0 });
    const task = { id: 'one', title: 'Review', status: 'To do' };
    widget.data.state = { 'task:one': task };
    store.applyOperation(roomId, { type: 'put', object: widget }, 'Maya');
    const shapes = store.getCanvasRecords(roomId).filter((r): r is import('@tldraw/tlschema').TLShape => r.typeName === 'shape');
    const context = { request: 'Review is done', pageId: 'page:page', shapes, widget };
    const plan = { route: 'task', modelMs: 100, confidence: 1, widget: { id: widget.id, state: { 'task:one': { ...task, status: 'Done' } }, dependencies: { 'task:one': task } } };
    store.applyOperation(roomId, { type: 'patch', id: widget.id, patch: { data: { state: { 'task:two': { id: 'two', title: 'Keep this' } } } } }, 'Owen');
    applyReactive(roomId, plan, context, 'Maya', 'r1', store.transactCanvas.bind(store));
    const state = store.getRoom(roomId).objects[0].data.state as Record<string, { title?: string; status?: string }>;
    assert.equal(state['task:two'].title, 'Keep this'); assert.equal(state['task:one'].status, 'Done');
    assert.throws(() => applyReactive(roomId, plan, context, 'Maya', 'r2', store.transactCanvas.bind(store)), /changed/);
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('native plans commit through the same finite-JSON transaction and reject stale shapes', () => {
  const directory = mkdtempSync(join(tmpdir(), 'present-native-'));
  const store = new RoomStore({ directory }), roomId = 'b'.repeat(32);
  try {
    const note = makeObject('note', 'Maya', { x: 100, y: 200 }, { text: 'Decision' });
    store.applyOperation(roomId, { type: 'put', object: note }, 'Maya');
    const shapes = store.getCanvasRecords(roomId).filter((r): r is import('@tldraw/tlschema').TLShape => r.typeName === 'shape');
    const context = { request: 'Make it blue', pageId: 'page:page', shapes };
    const plan: import('../server/agents/reactive-decisions').ReactivePlan = { route: 'color', confidence: 1, modelMs: 100, batch: { pageId: 'page:page', commands: [{ type: 'update_shape', id: shapes[0].id, patch: { shapeType: 'note', props: { color: 'blue' } } }] } };
    applyReactive(roomId, plan, context, 'Maya', 'color1', store.transactCanvas.bind(store));
    assert.equal(store.getRoom(roomId).objects[0].data.color, 'blue');
    assert.throws(() => applyReactive(roomId, plan, context, 'Maya', 'color2', store.transactCanvas.bind(store)), /changed/);
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('concurrent contributions append independently without verifying claims', () => {
  const directory = mkdtempSync(join(tmpdir(), 'present-debate-'));
  const store = new RoomStore({ directory }), roomId = 'c'.repeat(32);
  try {
    const widget = createCapability('debate', 'Maya', { x: 0, y: 0 });
    const claim = { id: 'one', text: 'Async helps focus', status: 'pending' };
    widget.data.state = { 'claim:one': claim }; widget.data.html = '<p>Older saved debate</p>';
    store.applyOperation(roomId, { type: 'put', object: widget }, 'Maya');
    const shapes = store.getCanvasRecords(roomId).filter((r): r is import('@tldraw/tlschema').TLShape => r.typeName === 'shape');
    const context = { request: 'Async helps me', pageId: 'page:page', shapes, widget };
    const plan = { route: 'contribution', confidence: null, modelMs: 100, widget: { id: widget.id, dependencies: { 'claim:one': claim }, state: { contribution: { text: 'Async helps me', links: [], needsReview: true } } } };
    applyReactive(roomId, plan, context, 'Maya', 'contribution1', store.transactCanvas.bind(store));
    applyReactive(roomId, plan, context, 'Owen', 'contribution2', store.transactCanvas.bind(store));
    const state = store.getRoom(roomId).objects[0].data.state as Record<string, { status?: string; createdBy?: string }>;
    assert.equal(state['contribution:contribution1'].createdBy, 'Maya');
    assert.equal(state['contribution:contribution2'].createdBy, 'Owen');
    assert.equal(state['claim:one'].status, 'pending');
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});
