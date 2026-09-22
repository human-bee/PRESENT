import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { PageRecordType } from '@tldraw/tlschema';
import { getIndexAbove } from '@tldraw/utils';
import { makeObject, operationSchema } from '../shared/room';
import { shapeIdForObject } from '../shared/tldraw-adapter';
import { initialSnapshot } from '../server/tldraw-persistence';
import { RoomStore, RoomError } from '../server/room-store';
import { generateWidget } from '../server/agents/generate';
import { createResearchRoom } from '../server/agents/research';
import { createGenerateRoomImage } from '../server/agents/image-generation';
import { executeVoiceTool, type VoiceToolDependencies } from '../server/agents/voice-tools';
import { WorkJobs } from '../server/agents/work-jobs';

const roomId = 'b'.repeat(32), pageId = PageRecordType.createId('second'), missingPageId = PageRecordType.createId('missing');
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6lQAAAABJRU5ErkJggg==';
const widget = JSON.stringify({ intent: 'create', targetId: null, title: 'A counter', html: '<button>Count</button>', width: 240, height: 180 });
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'present-pages-')), snapshot = initialSnapshot();
  snapshot.documents.push({ state: PageRecordType.create({ id: pageId, name: 'Page 2', index: getIndexAbove(getIndexAbove()) }), lastChangedClock: 0 });
  writeFileSync(join(directory, `${roomId}.json`), JSON.stringify(snapshot));
  const store = new RoomStore({ directory, legacyDirectory: join(directory, 'legacy') });
  const dependencies = { getRoom: store.getRoom.bind(store), getCanvasRecords: store.getCanvasRecords.bind(store), applyOperation: store.applyOperation.bind(store) };
  const parent = (id: string) => { const record = store.getCanvasRecords(roomId).find(record => record.id === shapeIdForObject(id)); return record?.typeName === 'shape' ? record.parentId : undefined; };
  return { directory, store, dependencies, parent, close: () => { store.close(); rmSync(directory, { recursive: true, force: true }); } };
}
const missingPage = (error: unknown) => error instanceof RoomError && error.status === 404;

test('put uses its explicit native page, preserves the first page and rejects an unknown page', () => {
  const f = fixture();
  try {
    const first = makeObject('note', 'human', { x: 1, y: 2 }, { text: 'Original first-page note' });
    f.store.applyOperation(roomId, { type: 'put', object: first }, 'human');
    const before = f.store.getCanvasRecords(roomId).find(record => record.id === shapeIdForObject(first.id));
    const second = makeObject('timer', 'human', { x: 50, y: 60 });
    const operation = operationSchema.parse({ type: 'put', object: second, pageId }); assert.equal(operation.type === 'put' && operation.pageId, pageId);
    f.store.applyOperation(roomId, operation, 'human'); assert.equal(f.parent(second.id), pageId); assert.equal(f.parent(first.id), 'page:page');
    assert.deepEqual(f.store.getCanvasRecords(roomId).find(record => record.id === shapeIdForObject(first.id)), before);
    assert.throws(() => f.store.applyOperation(roomId, { type: 'put', object: makeObject('note', 'human', { x: 0, y: 0 }), pageId: missingPageId }, 'human'), missingPage);
    assert.equal(f.store.getRoom(roomId).objects.length, 2);
  } finally { f.close(); }
});

test('all voice creation paths preserve the listener page through native, provider and work execution', async () => {
  const f = fixture();
  const jobs = new WorkJobs({ directory: join(f.directory, 'jobs'), store: f.store, generate: async () => JSON.stringify({ title: 'Done', format: 'markdown', body: 'The requested deliverable.' }) });
  const dependencies: VoiceToolDependencies = {
    ...f.dependencies, work: jobs.start.bind(jobs),
    widget: (raw, signal) => generateWidget(raw, signal, { ...f.dependencies, codex: async () => widget, cerebras: async () => widget }),
    research: createResearchRoom({ ...f.dependencies, apiKey: () => 'test-only', fetch: async () => Response.json({ id: 'test-response', status: 'completed', output: [{ type: 'web_search_call', status: 'completed' }, { type: 'message', content: [{ type: 'output_text', text: 'A mock assessment without citable sources.', annotations: [] }] }] }) }),
    image: createGenerateRoomImage({ ...f.dependencies, assetDirectory: join(f.directory, 'assets'), apiKey: () => 'test-only', fetch: async () => Response.json({ data: [{ b64_json: png }] }) }),
  };
  try {
    const calls = [
      ['add_note', { text: 'Remember this' }], ['set_timer', { seconds: 60 }],
      ['add_capability', { capability: 'kanban', title: 'Tasks' }], ['add_video', { url: 'https://youtu.be/dQw4w9WgXcQ' }],
      ['create_widget', { prompt: 'A counter' }], ['research_sources', { question: 'An exact question' }],
      ['generate_image', { prompt: 'A quiet landscape', referenceIds: [] }], ['start_work', { prompt: 'Write our deliverable' }],
    ] as const;
    for (const [name, args] of calls) {
      const result = await executeVoiceTool({ roomId, pageId, actor: 'listener', name, arguments: args }, undefined, dependencies) as { objectId: string };
      assert.equal(f.parent(result.objectId), pageId, name);
    }
    await jobs.settled();
    const shapes = f.store.getCanvasRecords(roomId).filter(record => record.typeName === 'shape');
    assert.equal(shapes.length, 9); assert.ok(shapes.every(shape => shape.parentId === pageId));
  } finally { jobs.close(); await jobs.settled(); f.close(); }
});

test('missing target pages are rejected before model, image, research or work provider invocation', async () => {
  const f = fixture(); let providers = 0;
  const jobs = new WorkJobs({ directory: join(f.directory, 'jobs'), store: f.store, generate: async () => { providers++; return ''; } });
  const input = { roomId, pageId: missingPageId, actor: 'human', prompt: 'A task', requestId: 'missing-page', provider: 'spark', position: { x: 0, y: 0 }, selection: [] };
  try {
    await assert.rejects(generateWidget(input, undefined, { ...f.dependencies, codex: async () => { providers++; return widget; }, cerebras: async () => { providers++; return widget; } }), missingPage);
    const fetcher: typeof fetch = async () => { providers++; throw new Error('Must not fetch'); };
    await assert.rejects(createResearchRoom({ ...f.dependencies, fetch: fetcher, apiKey: () => 'test-only' })(input), missingPage);
    await assert.rejects(createGenerateRoomImage({ ...f.dependencies, fetch: fetcher, apiKey: () => 'test-only', assetDirectory: join(f.directory, 'assets') })(input), missingPage);
    assert.throws(() => jobs.start({ roomId, pageId: missingPageId, actor: 'human', requestId: 'missing-work', prompt: 'A task' }), missingPage);
    assert.equal(providers, 0); assert.equal(f.store.getRoom(roomId).objects.length, 0);
  } finally { jobs.close(); await jobs.settled(); f.close(); }
});

test('work fulfillment follows the work card when a human moves it to another native page', async () => {
  const f = fixture(); let finish: (value: string) => void = () => {};
  const jobs = new WorkJobs({ directory: join(f.directory, 'jobs'), store: f.store, generate: () => new Promise(resolve => { finish = resolve; }) });
  try {
    const job = jobs.start({ roomId, pageId, actor: 'human', requestId: 'moving-card', prompt: 'Draft the brief' });
    assert.equal(f.parent(job.objectId), pageId); await new Promise(resolve => setImmediate(resolve));
    const firstPageId = PageRecordType.createId('page'); f.store.mutateCanvas(roomId, { updates: [{ id: shapeIdForObject(job.objectId), type: 'present-widget', parentId: firstPageId }] }, 'human');
    finish(JSON.stringify({ title: 'Brief', format: 'markdown', body: 'A finished draft.' })); await jobs.settled();
    const completed = jobs.get(roomId, job.jobId); assert.equal(completed.status, 'completed'); assert.equal(f.parent(completed.artifactIds[0]), firstPageId);
  } finally { finish(''); jobs.close(); await jobs.settled(); f.close(); }
});
