import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import test from 'node:test';
import type { TLRecord, TLShape } from '@tldraw/tlschema';
import { DocumentRecordType, PageRecordType, createBindingId, createShapeId, toRichText } from '@tldraw/tlschema';
import { getIndexAbove } from '@tldraw/utils';
import { objectToRecords, objectToShape } from '../shared/tldraw-adapter';
import { makeObject } from '../shared/room';
import { presentSchema } from '../shared/tldraw-schema';
import { exportDocumentRecords, parseNativeFile, prepareNativeImport } from '../src/tldraw/file-io';

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6lQAAAABJRU5ErkJggg==';
const assetPath = `/api/assets/${'a'.repeat(64)}.png`;
function fixture(): TLRecord[] {
  const firstPage = PageRecordType.create({ id: PageRecordType.createId('page'), name: 'Drawing', index: getIndexAbove() });
  const secondPage = PageRecordType.create({ id: PageRecordType.createId('second'), name: 'Tools', index: getIndexAbove(firstPage.index) });
  const note = objectToShape(makeObject('note', 'source-person', { x: 80, y: 90 }, { text: 'Native import keeps this formatting.' }));
  const group = { ...note, id: 'shape:group', type: 'group', props: {}, index: 'a1' } as TLShape;
  note.parentId = group.id;
  const arrow = { ...note, id: 'shape:arrow', parentId: 'page:page', index: 'a3', type: 'arrow', props: { kind: 'arc', elbowMidPoint: .5, dash: 'draw', size: 'm', fill: 'none', color: 'black', labelColor: 'black', bend: 0, start: { x: 0, y: 0 }, end: { x: 100, y: 0 }, arrowheadStart: 'none', arrowheadEnd: 'arrow', richText: toRichText('Connected'), labelPosition: .5, font: 'draw', scale: 1 } } as TLShape;
  const image = objectToRecords(makeObject('image', 'source-person', { x: 400, y: 0 }, { src: `data:image/png;base64,${png}`, mimeType: 'image/png', imageWidth: 1, imageHeight: 1 }));
  const widgetObject = makeObject('widget', 'source-person', { x: 40, y: 30 }, { html: '<button id="count">Count</button><script>const button=document.getElementById("count");const render=()=>button.textContent="Count "+window.present.getState().count;button.onclick=()=>window.present.increment("count",1);window.addEventListener("present:state",render);render()</script>', state: { count: 3 } }); widgetObject.title = 'Imported counter';
  const widget = objectToShape(widgetObject, { parentId: secondPage.id });
  return [
    DocumentRecordType.create({ id: DocumentRecordType.createId('document'), name: 'Source canvas' }), firstPage, secondPage, group, note, arrow, ...image, widget,
    { typeName: 'binding', id: createBindingId('arrow-note'), type: 'arrow', fromId: arrow.id, toId: note.id, props: { terminal: 'end', normalizedAnchor: { x: .5, y: .5 }, isExact: false, isPrecise: true, snap: 'none' }, meta: {} },
  ];
}
const serialize = (records = fixture()) => JSON.stringify({ tldrawFileFormatVersion: 1, schema: presentSchema.serialize(), records });

test('native file validation retains pages, groups, arrow bindings, images, rich text and custom widget state', () => {
  const records = fixture(); assert.deepEqual(parseNativeFile(serialize(records)), records);
  const widget = records.find(record => record.typeName === 'shape' && record.type === 'present-widget'); assert.ok(widget);
  assert.deepEqual(widget.props.data.state, { count: 3 });
});

test('exports retain validated room captions while omitting operational document metadata', () => {
  const records = fixture(), transcript = [{ id: 'caption-one', role: 'user', text: 'A caption worth keeping.', at: 123, source: 'room-voice' }];
  records[0].meta = { present: { transcript, transcriptOmitted: 7, requests: [['request', 'digest']], events: [{ text: 'Internal receipt' }], session: 'private-session' } };
  const exported = exportDocumentRecords(records), document = exported.find(record => record.typeName === 'document'); assert.ok(document);
  assert.deepEqual(document.meta, { present: { transcript, transcriptOmitted: 7 } });
  assert.ok(JSON.stringify(records[0].meta).includes('private-session'));
});

test('import remaps every page, shape, asset and binding ID and hosts embedded bytes before commit', async () => {
  const source = fixture(); const uploads: File[] = [];
  const plan = await prepareNativeImport(serialize(source), 'my-canvas.tldr', async (_asset, file) => { uploads.push(file); return { src: assetPath }; });
  assert.equal(plan.pages.length, 2); assert.deepEqual(plan.pages.map(page => page.name), ['Imported · Drawing', 'Imported · Tools']);
  const oldIds = new Set(source.map(record => record.id)); assert.ok(plan.records.every(record => !oldIds.has(record.id)));
  assert.equal(uploads.length, 1); assert.equal(uploads[0].type, 'image/png'); assert.deepEqual(Buffer.from(await uploads[0].arrayBuffer()), Buffer.from(png, 'base64'));
  const group = plan.records.find(record => record.typeName === 'shape' && record.type === 'group');
  const note = plan.records.find(record => record.typeName === 'shape' && record.type === 'note');
  const arrow = plan.records.find(record => record.typeName === 'shape' && record.type === 'arrow');
  const binding = plan.records.find(record => record.typeName === 'binding');
  assert.ok(group && note && arrow && binding); assert.equal(note.parentId, group.id); assert.equal(group.parentId, plan.pages[0].id);
  assert.deepEqual([binding.fromId, binding.toId], [arrow.id, note.id]);
  const image = plan.records.find(record => record.typeName === 'shape' && record.type === 'image');
  const asset = plan.records.find(record => record.typeName === 'asset'); assert.ok(image && asset);
  assert.equal(image.props.assetId, asset.id); assert.equal(asset.props.src, assetPath);
  assert.equal(plan.records.some(record => record.typeName === 'document'), false);
  assert.deepEqual(parseNativeFile(serialize(source)), source);
});

test('invalid native schemas and graphs fail before asset upload', async () => {
  const source = fixture(); let uploads = 0;
  const invalid: TLRecord[][] = [
    [...source, source[1]], source.filter(record => record.typeName !== 'asset'),
    source.map(record => record.typeName === 'binding' ? { ...record, toId: createShapeId('missing') } : record),
    source.map(record => record.typeName === 'shape' && record.type === 'group' ? { ...record, parentId: record.id } : record),
    source.map(record => record.typeName === 'shape' && record.type === 'present-widget' ? { ...record, props: { ...record.props, w: -10 } } : record),
  ];
  for (const records of invalid) await assert.rejects(prepareNativeImport(serialize(records), 'invalid.tldr', async () => { uploads++; return { src: assetPath }; }));
  assert.equal(uploads, 0); assert.throws(() => parseNativeFile(serialize().replace('"tldrawFileFormatVersion":1', '"tldrawFileFormatVersion":999')));
});

test('embedded video bytes use the bounded uploader and retain their native asset relationship', async () => {
  const source = fixture(); const asset = source.find(record => record.typeName === 'asset' && record.type === 'image');
  const shape = source.find(record => record.typeName === 'shape' && record.type === 'image'); assert.ok(asset && shape);
  const payload = Buffer.from('mock video bytes').toString('base64'), videoPath = `/api/assets/${'b'.repeat(64)}.webm`;
  const records: TLRecord[] = source.map(record => record.id === asset.id ? { ...asset, type: 'video', props: { ...asset.props, src: `data:video/webm;base64,${payload}`, mimeType: 'video/webm', isAnimated: true } } : record.id === shape.id ? { ...shape, type: 'video', props: { w: 320, h: 180, time: 0, playing: false, autoplay: false, url: '', assetId: asset.id, altText: 'Imported video' } } : record);
  const plan = await prepareNativeImport(serialize(records), 'video.tldr', async (_asset, file) => { assert.equal(file.type, 'video/webm'); assert.equal(await file.text(), 'mock video bytes'); return { src: videoPath }; });
  const videoAsset = plan.records.find(record => record.typeName === 'asset' && record.type === 'video'); const videoShape = plan.records.find(record => record.typeName === 'shape' && record.type === 'video');
  assert.ok(videoAsset && videoShape); assert.equal(videoShape.props.assetId, videoAsset.id); assert.equal(videoAsset.props.src, videoPath);
});

test('remote media, credential URLs and malformed embedded files fail without network access', async () => {
  let uploads = 0;
  for (const src of ['https://example.com/track.png', 'https://user:password@example.com/private.png', 'data:image/svg+xml;base64,PHN2Zz4=', 'data:image/png;base64,%%%']) {
    const records = fixture().map(record => record.typeName === 'asset' && record.type === 'image' ? { ...record, props: { ...record.props, src } } : record);
    await assert.rejects(prepareNativeImport(serialize(records), 'unsafe.tldr', async () => { uploads++; return { src: assetPath }; }));
  }
  const records = fixture(); records[0].meta = { apiKey: 'example-secret' };
  assert.throws(() => parseNativeFile(serialize(records)), /credentials/); assert.equal(uploads, 0);
  await assert.rejects(prepareNativeImport(serialize(), 'upload-error.tldr', async () => { throw new Error('Upload failed'); }), /Upload failed/);
  await assert.rejects(prepareNativeImport(serialize(), 'upload-error.tldr', async () => ({ src: 'https://unexpected.example/image.png' })), /safe local asset/);
});

test('browser native import and export preserve the human canvas and round-trip a linked file', { skip: process.env.PRESENT_FILE_BROWSER !== '1', timeout: 60000 }, async () => {
  const { chromium } = await import('@playwright/test');
  const baseURL = process.env.PRESENT_E2E_URL ?? 'http://127.0.0.1:4317';
  assert.ok((await fetch(`${baseURL}/api/health`)).ok, 'The existing development server must already be running.');
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const page = await context.newPage(), roomId = randomBytes(16).toString('hex');
  try {
    await page.goto(`/r/${roomId}`); await page.waitForFunction(() => !!(window as unknown as { __presentEditor: unknown }).__presentEditor);
    await page.evaluate(() => { const editor = (window as unknown as { __presentEditor: { createShape(shape: unknown): void } }).__presentEditor; editor.createShape({ type: 'geo', x: 10, y: 20, props: { w: 200, h: 100 } }); });
    const before = await page.evaluate(() => { const editor = (window as unknown as { __presentEditor: { getCurrentPageId(): string; getCurrentPageShapes(): unknown[] } }).__presentEditor; return { pageId: editor.getCurrentPageId(), shapes: editor.getCurrentPageShapes() }; });
    await page.getByRole('button', { name: 'Room settings', exact: true }).click();
    await page.getByLabel('Import a .tldr file').setInputFiles({ name: 'native-round-trip.tldr', mimeType: 'application/vnd.tldraw+json', buffer: Buffer.from(serialize()) });
    await page.getByRole('complementary', { name: 'Room settings' }).waitFor({ state: 'hidden' });
    await page.waitForFunction(() => (window as unknown as { __presentEditor: { getPages(): unknown[] } }).__presentEditor.getPages().length === 3);
    const readback = await page.evaluate(({ pageId }) => { const editor = (window as unknown as { __presentEditor: { getPageShapeIds(id: string): Set<string>; getShape(id: string): unknown; getPages(): unknown[]; store: { allRecords(): { typeName: string }[] } } }).__presentEditor; return { original: [...editor.getPageShapeIds(pageId)].map(id => editor.getShape(id)), pages: editor.getPages(), records: editor.store.allRecords().filter(record => ['shape', 'asset', 'binding'].includes(record.typeName)) as unknown[] }; }, before);
    const savedRecords = readback.records as TLRecord[];
    assert.deepEqual(readback.original, before.shapes); assert.equal(readback.pages.length, 3); assert.equal(savedRecords.filter(record => record.typeName === 'binding').length, 1);
    const importedAsset = savedRecords.find(record => record.typeName === 'asset'); assert.ok(importedAsset?.props.src?.startsWith('/api/assets/'));
    const widget = savedRecords.find(record => record.typeName === 'shape' && record.type === 'present-widget'); assert.ok(widget);
    await page.evaluate(id => { const editor = (window as unknown as { __presentEditor: { setCurrentPage(id: string): void; zoomToFit(): void } }).__presentEditor; editor.setCurrentPage(id); editor.zoomToFit(); }, String(widget.parentId));
    await page.frameLocator('iframe[title="Imported counter"]').getByRole('button', { name: 'Count 3' }).click();
    await page.waitForFunction(async ({ roomId, widgetId }) => { const response = await fetch(`/api/room/${roomId}/document`); const data = await response.json(); return data.snapshot.documents.some((document: { state: { id: string; props?: { data?: { state?: { count?: number } } } } }) => document.state.id === widgetId && document.state.props?.data?.state?.count === 4); }, { roomId, widgetId: String(widget.id) });
    await page.frameLocator('iframe[title="Imported counter"]').getByRole('button', { name: 'Count 4' }).waitFor({ timeout: 5000 });
    await page.getByRole('button', { name: 'Room settings', exact: true }).click();
    const download = page.waitForEvent('download'); await page.getByRole('button', { name: 'Save this room', exact: true }).click();
    const artifact = await download, path = await artifact.path(); assert.ok(path);
    const exported = await readFile(path, 'utf8'), parsed = parseNativeFile(exported);
    assert.equal(parsed.filter(record => record.typeName === 'page').length, 3); assert.equal(parsed.filter(record => record.typeName === 'binding').length, 1);
    assert.ok(parsed.some(record => record.typeName === 'asset' && record.props.src?.startsWith('data:image/png;base64,')));
    await mkdir('docs/evidence', { recursive: true }); await writeFile('docs/evidence/native-files-round-trip.tldr', exported); await page.screenshot({ path: 'docs/evidence/native-files-round-trip.png' });
    await writeFile('docs/evidence/native-files-round-trip.json', JSON.stringify({ at: new Date().toISOString(), roomId, pages: 3, originalShapesPreserved: true, bindings: 1, embeddedImage: true, importedCounterServerCount: 4, importedWidgets: parsed.filter(record => record.typeName === 'shape' && record.type === 'present-widget').length }, null, 2));
  } finally { await context.close(); await browser.close(); }
});
