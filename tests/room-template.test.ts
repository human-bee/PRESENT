import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { getIndexAbove } from '@tldraw/utils';
import type { TLRecord } from '@tldraw/tlschema';
import { exportRoomTemplate, instantiateRoomTemplate, parseRoomTemplate } from '../shared/room-template';
import { builtInTemplates, TemplateCatalog } from '../server/templates/catalog';
import { createTemplateRequestHandler } from '../server/template-routes';
import { installTemplateRecords } from '../server/templates/install';
import { RoomStore } from '../server/room-store';
import { runTemplateBenchmark } from '../server/templates/benchmark';
const fixture = () => structuredClone(builtInTemplates.get('builtin-retro')!);

test('privacy whitelist resets notes/timers, omits custom widgets and all ambient data', () => {
  const source = fixture().records;
  const note = source.find(r => r.typeName === 'shape' && r.type === 'note')! as any;
  note.meta = { personal: 'PRIVATE' }; note.props.richText = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'PRIVATE' }] }] }; note.props.url = 'https://secret.invalid';
  const timer = source.find(r => r.typeName === 'shape' && r.type === 'present-widget')! as any;
  timer.props.createdBy = 'PRIVATE'; timer.props.title = 'PRIVATE'; timer.props.data = { durationMs: 900000, remainingMs: 1, endsAt: 123, transcript: 'PRIVATE', permissions: 'PRIVATE', votes: 'PRIVATE', state: { secret: 'PRIVATE' } };
  source.push({ ...structuredClone(timer), id: 'shape:custom', props: { ...timer.props, kind: 'widget', data: { html: 'PRIVATE', capability: 'work' } } });
  const result = exportRoomTemplate(source, 'Reusable layout');
  assert.ok(!JSON.stringify(result).includes('PRIVATE')); assert.ok(!JSON.stringify(result).includes('secret.invalid'));
  assert.ok(result.notices.some(n => n.reason === 'unsupported'));
  const clean = result.records.find(r => r.typeName === 'shape' && r.type === 'present-widget')! as any;
  assert.deepEqual(clean.props.data, { durationMs: 900000, remainingMs: 900000, endsAt: null });
  assert.equal(clean.props.createdBy, '');
});
test('fresh IDs, page parents and native arrow bindings remap without leaking source IDs', () => {
  const source = fixture().records;
  const target = source.find(r => r.typeName === 'shape')!;
  source.push({ id: 'shape:secret_arrow', typeName: 'shape', type: 'arrow', parentId: source[0].id, x: 0, y: 0, rotation: 0, index: getIndexAbove(), isLocked: false, opacity: 1, meta: {}, props: { kind: 'arc', color: 'black', labelColor: 'black', fill: 'none', dash: 'draw', size: 'm', arrowheadStart: 'none', arrowheadEnd: 'arrow', font: 'draw', start: { x: 0, y: 0 }, end: { x: 100, y: 100 }, bend: 0, richText: { type: 'doc', content: [{ type: 'paragraph' }] }, labelPosition: .5, scale: 1, elbowMidPoint: .5 } } as TLRecord);
  source.push({ id: 'binding:secret_link', typeName: 'binding', type: 'arrow', fromId: 'shape:secret_arrow', toId: target.id, meta: {}, props: { terminal: 'end', normalizedAnchor: { x: .5, y: .5 }, isExact: false, isPrecise: true, snap: 'none' } } as TLRecord);
  const template = exportRoomTemplate(source, 'Diagram');
  assert.ok(!JSON.stringify(template).includes('secret_'));
  const a = instantiateRoomTemplate(template), b = instantiateRoomTemplate(template);
  assert.ok(a.records.every(r => !b.records.some(other => other.id === r.id)));
  const binding = a.records.find(r => r.typeName === 'binding');
  assert.ok(binding, JSON.stringify(template.notices));
  assert.ok(a.records.some(r => r.id === binding.fromId)); assert.ok(a.records.some(r => r.id === binding.toId));
  assert.throws(() => instantiateRoomTemplate(template, { id: () => 'same' }), /unique/);
});
test('tampered imports sanitize state and reject invalid versions, sizes and duplicate IDs', () => {
  const t = fixture();
  const timer = t.records.find(r => r.typeName === 'shape' && r.type === 'present-widget')! as any;
  timer.props.data.secret = 'PRIVATE'; timer.props.createdBy = 'PRIVATE';
  assert.ok(!JSON.stringify(parseRoomTemplate(t)).includes('PRIVATE'));
  assert.throws(() => parseRoomTemplate({ ...t, version: 2 }));
  assert.throws(() => parseRoomTemplate({ ...t, name: 'x'.repeat(240001) }));
  assert.throws(() => exportRoomTemplate([...t.records, t.records[0]], 'Duplicate'));
});
test('typed HTTP save/list/install commits usable native records and survives catalog reopening', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'present-template-'));
  const store = new RoomStore({ directory: join(directory, 'rooms') });
  const sourceId = 'a'.repeat(32);
  await installTemplateRecords(store.getTldrawRoom(sourceId), instantiateRoomTemplate(fixture()).records);
  const catalog = new TemplateCatalog(join(directory, 'templates'));
  const handler = createTemplateRequestHandler({ catalog, readRoom: id => store.getCanvasRecords(id), installRoom: (id, records) => installTemplateRecords(store.getTldrawRoom(id), records) });
  const base = '/api/templates';
  const fetch = async (url: string, init: { method?: string; body?: string } = {}) => {
    const req = Object.assign(Readable.from(init.body ? [Buffer.from(init.body)] : []), { url, method: init.method ?? 'GET' }) as IncomingMessage;
    let status = 0, body = '';
    const res = { writeHead(code: number) { status = code; }, end(value: string) { body = value; } } as unknown as ServerResponse;
    assert.equal(await handler(req, res), true);
    return { status, json: async () => JSON.parse(body) };
  };
  try {
    const saved = await fetch(base, { method: 'POST', body: JSON.stringify({ roomId: sourceId, name: 'Weekly' }) });
    assert.equal(saved.status, 201); const result = await saved.json() as any;
    assert.equal(new TemplateCatalog(join(directory, 'templates')).get(result.id)?.name, 'Weekly');
    const installed = await fetch(`${base}/${result.id}/instantiate`, { method: 'POST', body: '{}' });
    assert.equal(installed.status, 201); const room = await installed.json() as any;
    assert.notEqual(room.roomId, sourceId); assert.equal(store.getRoom(room.roomId).objects.length, 7);
    const timer = store.getRoom(room.roomId).objects.find(o => o.kind === 'timer')!;
    assert.equal(timer.data.endsAt, null);
    await assert.rejects(installTemplateRecords(store.getTldrawRoom(room.roomId), instantiateRoomTemplate(fixture()).records), /not empty/);
    assert.equal((await fetch(`${base}/missing/instantiate`, { method: 'POST' })).status, 404);
    assert.equal((await fetch(base, { method: 'POST', body: 'x'.repeat(4097) })).status, 413);
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});
test('deterministic representative instantiation benchmark stays within size and timing budgets', () => {
  const result = runTemplateBenchmark(); console.log('Template benchmark:', JSON.stringify(result));
  assert.ok(result.templateBytes < 120000); assert.ok(result.instanceBytes < 150000); assert.ok(result.p95Ms < 250); assert.ok(result.totalMs < 5000);
});
