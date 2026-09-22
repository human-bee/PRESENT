import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { parseResearchEvidence, researchWidgetHtml, safeEvidenceUrl } from '../shared/evidence';
import { createResearchRoom, RESEARCH_MODEL } from '../server/agents/research';
import { createGenerateRoomImage, decodeGeneratedPng, IMAGE_MODEL } from '../server/agents/image-generation';
import { RoomStore } from '../server/room-store';
import { AgentError } from '../server/agents/contract';
import { objectToRecords, recordsToRoom } from '../shared/tldraw-adapter';
import { makeObject } from '../shared/room';

const roomId = 'e'.repeat(32);
const input = { roomId, prompt: 'Does water freeze near zero Celsius at one atmosphere?', actor: 'human-1', requestId: 'request-one', position: { x: 120, y: 230 } };
const assessment = 'Water freezes near 0°C at one atmosphere; dissolved substances can lower its freezing point.';
function providerResponse() {
  return { id: 'resp_123', model: RESEARCH_MODEL, status: 'completed', output: [
    { type: 'web_search_call', status: 'completed', action: { sources: [{ url: 'https://science.example/consulted-only', title: 'Consulted only' }] } },
    { type: 'message', content: [{ type: 'output_text', text: assessment, annotations: [{ type: 'url_citation', url: 'https://science.example/freezing', title: 'Freezing point', start_index: 0, end_index: assessment.length }] }] },
  ] };
}
function storeFixture() {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'present-evidence-'))); const store = new RoomStore({ directory: join(directory, 'rooms') });
  return { directory, store, dependencies: { getRoom: store.getRoom.bind(store), applyOperation: store.applyOperation.bind(store), apiKey: () => 'test-only' }, close: () => { store.close(); rmSync(directory, { recursive: true, force: true }); } };
}
const status = (code: number) => (error: unknown) => error instanceof AgentError && error.status === code;

test('research retains exact question, provider citation spans and consulted-versus-cited provenance', () => {
  const evidence = parseResearchEvidence(providerResponse(), input.prompt, RESEARCH_MODEL, 123);
  assert.equal(evidence.question, input.prompt); assert.equal(evidence.status, 'model-assessment'); assert.equal(evidence.coverage, 'cited-sources');
  assert.deepEqual(evidence.sources, [{ id: '1', url: 'https://science.example/freezing', title: 'Freezing point' }]);
  assert.equal(evidence.consultedSources[0].url, 'https://science.example/consulted-only');
  const citation = evidence.modelAssessment.citations[0];
  assert.equal(evidence.modelAssessment.text.slice(citation.startIndex, citation.endIndex), assessment);
  assert.equal(citation.sourceId, evidence.sources[0].id);
});

test('unsourced model prose is a coverage gap; incomplete/no-search output cannot claim research', () => {
  const response = providerResponse(); response.output[1] = { type: 'message', content: [{ type: 'output_text', text: 'See https://made-up.example for proof.', annotations: [] }] };
  const evidence = parseResearchEvidence(response, input.prompt, RESEARCH_MODEL, 123);
  assert.equal(evidence.coverage, 'no-citable-sources'); assert.deepEqual(evidence.sources, []);
  assert.throws(() => parseResearchEvidence({ ...response, status: 'incomplete' }, input.prompt, RESEARCH_MODEL, 123));
  assert.throws(() => parseResearchEvidence({ ...response, output: [response.output[1]] }, input.prompt, RESEARCH_MODEL, 123));
});

test('research commits a sourced widget once and replay cannot change its request', async () => {
  const f = storeFixture(); let calls = 0;
  try {
    const research = createResearchRoom({ ...f.dependencies, fetch: async (url, init) => {
      calls++; assert.equal(url, 'https://api.openai.com/v1/responses');
      const request = JSON.parse(String(init?.body));
      assert.equal(request.model, RESEARCH_MODEL); assert.equal(request.tool_choice, 'required'); assert.equal(request.max_tool_calls, 2);
      assert.deepEqual(request.include, ['web_search_call.action.sources']); assert.equal(request.store, false); assert.ok(init?.signal);
      return Response.json(providerResponse());
    } });
    const [first, replay] = await Promise.all([research(input), research(input)]);
    assert.equal(first.objectId, replay.objectId); assert.equal(calls, 1);
    const object = f.store.getRoom(roomId).objects[0];
    assert.equal(object.kind, 'widget'); assert.equal(object.data.capability, 'research'); assert.equal(object.x, 120);
    assert.deepEqual(object.data.state, { notes: '' }); assert.equal(f.store.getRoom(roomId).objects.length, 1);
    await assert.rejects(research({ ...input, prompt: 'A different claim' }), status(409));
    const restored = createResearchRoom({ ...f.dependencies, fetch: async () => { throw new Error('must not fetch'); } });
    assert.equal((await restored(input)).objectId, first.objectId);
  } finally { f.close(); }
});

test('provider error and cancellation leave the room unchanged', async () => {
  const f = storeFixture();
  try {
    const unavailable = createResearchRoom({ ...f.dependencies, fetch: async () => new Response('', { status: 429 }) });
    await assert.rejects(unavailable(input), status(429));
    const controller = new AbortController();
    const cancelled = createResearchRoom({ ...f.dependencies, fetch: async () => { controller.abort(); return Response.json(providerResponse()); } });
    await assert.rejects(cancelled({ ...input, requestId: 'cancel' }, controller.signal), status(504));
    const noSearch = createResearchRoom({ ...f.dependencies, fetch: async () => Response.json({ ...providerResponse(), output: [providerResponse().output[1]] }) });
    await assert.rejects(noSearch({ ...input, requestId: 'no-search' }), status(502));
    assert.equal(f.store.getRoom(roomId).objects.length, 0);
  } finally { f.close(); }
});

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6lQAAAABJRU5ErkJggg==';
test('one generated PNG becomes a local asset plus native-image DTO with durable provenance', async () => {
  const f = storeFixture(); let calls = 0;
  try {
    const assetDirectory = join(f.directory, 'assets');
    const generate = createGenerateRoomImage({ ...f.dependencies, assetDirectory, fetch: async (url, init) => {
      calls++; assert.equal(url, 'https://api.openai.com/v1/images/generations');
      assert.deepEqual(JSON.parse(String(init?.body)), { model: IMAGE_MODEL, prompt: input.prompt, n: 1, size: '1024x1024', quality: 'low', output_format: 'png' });
      return Response.json({ data: [{ b64_json: png }] });
    } });
    const result = await generate(input); await generate(input);
    assert.equal(calls, 1); assert.match(result.src, /^\/api\/assets\/[a-f0-9]{64}\.png$/);
    const file = join(assetDirectory, result.src.split('/').pop() ?? ''); assert.deepEqual(readFileSync(file), Buffer.from(png, 'base64'));
    assert.deepEqual([result.width, result.height], [1, 1]); assert.equal(readdirSync(assetDirectory).length, 1);
    const object = f.store.getRoom(roomId).objects[0]; assert.equal(object.kind, 'image');
    assert.equal(JSON.stringify(object).includes(png), false);
    const records = objectToRecords(object);
    assert.ok(records.some(record => record.typeName === 'asset' && record.type === 'image'));
    assert.ok(records.some(record => record.typeName === 'shape' && record.type === 'image'));
    const native = recordsToRoom(roomId, records).objects[0];
    assert.equal(native.data.src, result.src); assert.equal(native.data.imageWidth, 1);
    assert.deepEqual(native.data.provenance, object.data.provenance);
    assert.deepEqual(object.data.provenance, { prompt: input.prompt, model: IMAGE_MODEL, generatedAt: result.generatedAt, elapsedMs: result.elapsedMs, requestId: input.requestId, requestDigest: (object.data.provenance as Record<string, unknown>).requestDigest, requestedBy: input.actor });
  } finally { f.close(); }
});

test('invalid image output and cancelled generation create no asset or room object', async () => {
  const f = storeFixture();
  try {
    const invalid = createGenerateRoomImage({ ...f.dependencies, assetDirectory: join(f.directory, 'assets'), fetch: async () => Response.json({ data: [{ b64_json: Buffer.from('<script>bad</script>').toString('base64') }] }) });
    await assert.rejects(invalid(input), status(502));
    const controller = new AbortController();
    const cancelled = createGenerateRoomImage({ ...f.dependencies, assetDirectory: join(f.directory, 'assets'), fetch: async () => { controller.abort(); return Response.json({ data: [{ b64_json: png }] }); } });
    await assert.rejects(cancelled({ ...input, requestId: 'cancel-image' }, controller.signal), status(504));
    assert.equal(readdirSync(f.directory).includes('assets'), false); assert.equal(f.store.getRoom(roomId).objects.length, 0);
    assert.throws(() => decodeGeneratedPng('not base64!'));
  } finally { f.close(); }
});

test('source URLs and research HTML cannot turn provider text into executable markup', () => {
  assert.equal(safeEvidenceUrl('javascript:alert(1)'), null); assert.equal(safeEvidenceUrl('https://user:password@example.com'), null);
  const report = parseResearchEvidence(providerResponse(), '</h2><script>bad()</script>', RESEARCH_MODEL, 123);
  const html = researchWidgetHtml(report);
  assert.ok(html.includes('&lt;script&gt;bad()&lt;/script&gt;')); assert.equal(html.includes('<script>bad()'), false);
  assert.equal((html.match(/href="https:\/\/science.example\/freezing"/g) ?? []).length, 2);
  assert.ok(html.includes('<sup>[<a ')); assert.ok(html.includes('aria-label="Source 1: Freezing point"'));
  report.sources[0].url = 'javascript:alert(1)';
  assert.equal(researchWidgetHtml(report).includes('href='), false);
});

test('research Markdown preserves citation positions and escapes hostile text and links', () => {
  const report = parseResearchEvidence(providerResponse(), 'A short question', RESEARCH_MODEL, 123);
  const first = '**One authority** uses `TLSocketRoom`.';
  report.modelAssessment = { text: `### Summary\n\n${first}\n\n- *First* item\n- [Official docs](https://tldraw.dev/docs/sync)\n\n> A short paraphrase.\n\n<script>bad()</script> [unsafe](javascript:bad)\n\n\`\`\`\n<img src=x onerror=bad()>\n\`\`\``,
    citations: [{ sourceId: '1', startIndex: 13, endIndex: 13 + first.length }] };
  const before = structuredClone(report), html = researchWidgetHtml(report);
  assert.deepEqual(report, before, 'Rendering must not rewrite the provider evidence or citation offsets.');
  assert.ok(html.includes('<h3>Summary</h3>'));
  assert.ok(html.includes('<strong>One authority</strong> uses <code>TLSocketRoom</code>.<sup>[<a '));
  assert.ok(html.includes('<ul><li><em>First</em> item</li>'));
  assert.ok(html.includes('href="https://tldraw.dev/docs/sync" target="_blank" rel="noopener noreferrer"'));
  assert.ok(html.includes('<blockquote>A short paraphrase.</blockquote>'));
  assert.ok(html.includes('<pre><code>&lt;img src=x onerror=bad()&gt;</code></pre>'));
  assert.ok(html.includes('&lt;script&gt;bad()&lt;/script&gt;'));
  assert.equal(html.includes('href="javascript:'), false); assert.equal(html.includes('<script>bad()'), false);
});

function addReference(f: ReturnType<typeof storeFixture>, src: string, kind: 'image' | 'note' = 'image') {
  const object = makeObject(kind, 'human-1', { x: 30, y: 40 }, { src, mimeType: 'image/png', imageWidth: 1, imageHeight: 1 });
  f.store.applyOperation(roomId, { type: 'put', object }, 'human-1'); return object;
}

test('four explicit local image references use multipart edits and create a separate image with source provenance', async () => {
  const f = storeFixture(); let calls = 0;
  try {
    const assetDirectory = join(f.directory, 'assets'), mediaDirectory = join(f.directory, 'media'); mkdirSync(assetDirectory); mkdirSync(mediaDirectory);
    const bytes = Buffer.from(png, 'base64'), hash = createHash('sha256').update(bytes).digest('hex');
    writeFileSync(join(assetDirectory, `${hash}.png`), bytes);
    const refs = [addReference(f, `/api/assets/${hash}.png`), ...['speed-and-judgment', 'scene', 'style'].map(name => { writeFileSync(join(mediaDirectory, `${name}.png`), bytes); return addReference(f, `/media/${name}.png`); })];
    const before = structuredClone(f.store.getRoom(roomId).objects);
    const edit = createGenerateRoomImage({ ...f.dependencies, assetDirectory, mediaDirectory, fetch: async (url, init) => {
      calls++; assert.equal(url, 'https://api.openai.com/v1/images/edits'); assert.ok(init?.body instanceof FormData);
      const body = init.body; assert.equal(body.get('model'), IMAGE_MODEL); assert.equal(body.get('prompt'), input.prompt); assert.equal(body.get('n'), '1'); assert.equal(body.get('input_fidelity'), null);
      assert.equal(new Headers(init.headers).get('Content-Type'), null);
      const images = body.getAll('image[]'); assert.equal(images.length, 4);
      for (const image of images) { assert.ok(image instanceof Blob); assert.equal(image.type, 'image/png'); assert.deepEqual(Buffer.from(await image.arrayBuffer()), bytes); }
      return Response.json({ data: [{ b64_json: png }] });
    } });
    const request = { ...input, selection: refs.map(reference => reference.id) };
    const result = await edit(request); assert.equal((await edit(request)).objectId, result.objectId); assert.equal(calls, 1);
    const room = f.store.getRoom(roomId); assert.equal(room.objects.length, 5); assert.deepEqual(room.objects.filter(object => object.id !== result.objectId), before);
    const object = room.objects.find(value => value.id === result.objectId); assert.ok(object);
    const provenance = object.data.provenance as Record<string, unknown>; assert.deepEqual(provenance.referenceIds, request.selection);
    assert.deepEqual(provenance.referenceImages, refs.map(reference => ({ objectId: reference.id, src: reference.data.src, sha256: hash })));
    assert.deepEqual(recordsToRoom(roomId, objectToRecords(object)).objects[0].data.provenance, provenance);
    const restored = createGenerateRoomImage({ ...f.dependencies, fetch: async () => { throw new Error('must not fetch'); } });
    assert.equal((await restored(request)).objectId, result.objectId);
  } finally { f.close(); }
});

test('image editing rejects remote paths, traversal, unsupported files, symlinks and non-image references before provider access', async () => {
  const f = storeFixture(); let calls = 0;
  try {
    const mediaDirectory = join(f.directory, 'media'); mkdirSync(mediaDirectory);
    writeFileSync(join(f.directory, 'outside.png'), Buffer.from(png, 'base64')); symlinkSync(join(f.directory, 'outside.png'), join(mediaDirectory, 'linked.png'));
    writeFileSync(join(mediaDirectory, 'invalid.png'), '<script>not an image</script>');
    const edit = createGenerateRoomImage({ ...f.dependencies, mediaDirectory, fetch: async () => { calls++; throw new Error('must not fetch'); } });
    const sources = ['https://example.com/image.png', '/etc/passwd', '/media/../outside.png', '/media/%2e%2e/outside.png', '/media/missing.png', '/media/linked.png', '/media/invalid.png', '/media/movie.mp4', `/api/assets/${'a'.repeat(64)}.png`];
    for (const [index, src] of sources.entries()) { const reference = addReference(f, src); await assert.rejects(edit({ ...input, requestId: `unsafe-${index}`, selection: [reference.id] }), status(400)); }
    const note = addReference(f, '/media/safe.png', 'note'); await assert.rejects(edit({ ...input, selection: [note.id] }), status(400));
    await assert.rejects(edit({ ...input, selection: ['missing'] }), status(400));
    await assert.rejects(edit({ ...input, selection: [note.id, note.id] }), status(400)); assert.equal(calls, 0);
  } finally { f.close(); }
});

test('failed and cancelled edits preserve originals; a removed reference discards the result before storing it', async () => {
  const f = storeFixture();
  try {
    const mediaDirectory = join(f.directory, 'media'); mkdirSync(mediaDirectory); writeFileSync(join(mediaDirectory, 'source.png'), Buffer.from(png, 'base64'));
    const original = addReference(f, '/media/source.png'), before = structuredClone(f.store.getRoom(roomId).objects);
    const request = { ...input, selection: [original.id] }, dependencies = { ...f.dependencies, mediaDirectory, assetDirectory: join(f.directory, 'assets') };
    await assert.rejects(createGenerateRoomImage({ ...dependencies, fetch: async () => new Response('', { status: 500 }) })(request), status(502));
    const controller = new AbortController();
    await assert.rejects(createGenerateRoomImage({ ...dependencies, fetch: async () => { controller.abort(); return Response.json({ data: [{ b64_json: png }] }); } })(request, controller.signal), status(504));
    assert.deepEqual(f.store.getRoom(roomId).objects, before);
    await assert.rejects(createGenerateRoomImage({ ...dependencies, fetch: async () => { f.store.applyOperation(roomId, { type: 'remove', id: original.id }, 'human-1'); return Response.json({ data: [{ b64_json: png }] }); } })(request), status(409));
    assert.equal(f.store.getRoom(roomId).objects.length, 0);
    assert.equal(readdirSync(f.directory).includes('assets'), false);
  } finally { f.close(); }
});
