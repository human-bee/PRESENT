import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { makeObject } from '../shared/room';
import { RoomStore } from '../server/room-store';
import { applyGeneratedWidget, generateWidget } from '../server/agents/generate';
import { agentModels, generationRequestSchema, parseWidget, type GenerationRequest, type GeneratedWidget } from '../server/agents/contract';

const roomId = 'a'.repeat(24);
const input: GenerationRequest = { roomId, prompt: 'A shared counter', provider: 'spark', position: { x: 2, y: 3 }, selection: [], actor: 'human' };
const output: GeneratedWidget = { intent: 'create', targetId: null, title: 'Counter', html: '<button>Count</button>', width: 240, height: 180 };
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'present-generation-'));
  const roomStore = new RoomStore({ directory });
  return { getRoom: roomStore.getRoom.bind(roomStore), applyOperation: roomStore.applyOperation.bind(roomStore), close() { roomStore.close(); rmSync(directory, { recursive: true }); } };
}

test('Spark is explicit and malformed model output cannot enter the room', () => {
  assert.equal(generationRequestSchema.parse(input).provider, 'spark');
  assert.throws(() => parseWidget(JSON.stringify({ ...output, html: '', extra: true })));
  assert.throws(() => generationRequestSchema.parse({ ...input, provider: 'fallback' }));
});

test('generated edits preserve concurrent position, state, title and independently changed dimensions', () => {
  const store = fixture();
  try {
    const object = makeObject('widget', 'human', { x: 0, y: 0 }, { html: 'old', state: { count: 0 }, metadata: 'keep' });
    store.applyOperation(roomId, { type: 'put', object }, 'human');
    const before = store.getRoom(roomId);
    store.applyOperation(roomId, { type: 'patch', id: object.id, patch: { x: 40, title: 'Human title', w: 500, data: { state: { count: 7 } } } }, 'human');
    applyGeneratedWidget({ ...input, selection: [object.id] }, { ...output, intent: 'edit', targetId: object.id }, before, 50, store);
    const updated = store.getRoom(roomId).objects[0];
    assert.equal(updated.x, 40); assert.equal(updated.title, 'Human title'); assert.equal(updated.w, 500); assert.equal(updated.h, 180);
    assert.deepEqual(updated.data.state, { count: 7 }); assert.equal(updated.data.metadata, 'keep');
    assert.equal(updated.data.html, output.html); assert.equal(updated.data.model, agentModels.spark);
  } finally { store.close(); }
});

test('an edit cannot replace a newer source, a deleted object or an unselected widget', () => {
  const store = fixture();
  try {
    const object = makeObject('widget', 'human', input.position, { html: 'old' });
    store.applyOperation(roomId, { type: 'put', object }, 'human');
    const before = store.getRoom(roomId); const edit = { ...output, intent: 'edit' as const, targetId: object.id };
    assert.throws(() => applyGeneratedWidget(input, edit, before, 1, store), /Select the widget/);
    store.applyOperation(roomId, { type: 'patch', id: object.id, patch: { data: { html: 'newer source' } } }, 'human');
    assert.throws(() => applyGeneratedWidget({ ...input, selection: [object.id] }, edit, before, 1, store), /changed while/);
    assert.equal(store.getRoom(roomId).objects[0].data.html, 'newer source');
    store.applyOperation(roomId, { type: 'remove', id: object.id }, 'human');
    assert.throws(() => applyGeneratedWidget({ ...input, selection: [object.id] }, edit, before, 1, store), /changed while/);
  } finally { store.close(); }
});

test('failed generation releases room capacity and Spark retries keep the exact provider', async () => {
  const store = fixture(); const providers: unknown[] = []; let attempts = 0;
  try {
    const dependencies = { ...store, cerebras: async () => { throw new Error('Unexpected Cerebras fallback'); }, codex: async (_prompt: string, _signal: AbortSignal, provider?: 'spark' | 'codex' | 'luna' | 'terra') => { providers.push(provider); if (++attempts === 1) throw new Error('temporary failure'); return JSON.stringify(output); } };
    await assert.rejects(generateWidget(input, undefined, dependencies), /temporary failure/);
    assert.equal(store.getRoom(roomId).objects.length, 0);
    const result = await generateWidget(input, undefined, dependencies);
    assert.equal(result.provider, 'spark'); assert.deepEqual(providers, ['spark', 'spark']); assert.equal(store.getRoom(roomId).objects.length, 1);
  } finally { store.close(); }
});

test('concurrent room work is bounded and cancelled output never mutates the room', async () => {
  const store = fixture(); let finish: (result: string) => void = () => {};
  const controller = new AbortController();
  const dependencies = { ...store, codex: () => new Promise<string>(resolve => { finish = resolve; }), cerebras: async () => JSON.stringify(output) };
  try {
    const pending = generateWidget(input, controller.signal, dependencies);
    await assert.rejects(generateWidget(input, undefined, dependencies), /already making/);
    controller.abort(); finish(JSON.stringify(output));
    await assert.rejects(pending, /cancelled/); assert.equal(store.getRoom(roomId).objects.length, 0);
    await generateWidget(input, undefined, { ...dependencies, codex: async () => JSON.stringify(output) });
    assert.equal(store.getRoom(roomId).objects.length, 1);
  } finally { store.close(); }
});
