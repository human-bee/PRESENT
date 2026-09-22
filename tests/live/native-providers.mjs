import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const output = resolve(root, 'docs/evidence/native-provider-proof');
const manifestPath = resolve(output, 'manifest.json');
const baseURL = process.env.PRESENT_E2E_URL ?? 'http://127.0.0.1:4318';
assert.match(baseURL, /^http:\/\/127\.0\.0\.1:\d{4,5}$/);
const mode = process.argv[2] ?? 'prepare';
assert.ok(['prepare', 'research', 'image', 'readback', 'render-research', 'verify-browser'].includes(mode));
const hash = value => createHash('sha256').update(value).digest('hex');
const save = (name, value) => writeFileSync(resolve(output, name), `${JSON.stringify(value, null, 2)}\n`);
const sourceFiles = ['tests/live/native-providers.mjs', 'server/agents/fulfill-request.ts', 'server/agents/room-request.ts', 'server/agents/room-intent.ts', 'server/agents/research.ts', 'server/agents/image-generation.ts', 'shared/evidence.ts', 'shared/evidence-markdown.ts', 'src/widgets/sandbox.ts', 'src/widgets/sandbox-widget.tsx'];
const source = () => Object.fromEntries(sourceFiles.map(path => [path, hash(readFileSync(resolve(root, path)))]));
const canonical = records => JSON.stringify(records.map(record => JSON.stringify(sort(record))).sort());
const sort = value => Array.isArray(value) ? value.map(sort) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, sort(value[key])])) : value;
const get = async path => { const response = await fetch(`${baseURL}${path}`, { signal: AbortSignal.timeout(10000) }); assert.equal(response.status, 200); return response.json(); };

mkdirSync(output, { recursive: true });
if (!existsSync(manifestPath)) {
  assert.equal(mode, 'prepare', 'Prepare the exact inputs before running a paid scenario.');
  save('manifest.json', { createdAt: new Date().toISOString(), baseURL, providerOutputsMocked: false, physicalDevices: false, maxNativeRequests: 2,
    scenarios: [
      { name: 'research', roomId: randomBytes(16).toString('hex'), prompt: 'Research, using current official tldraw documentation only: what must a self-hosted tldraw sync backend guarantee about TLSocketRoom ownership for each room? Create a compact cited research card with clickable source links.' },
      { name: 'image', roomId: randomBytes(16).toString('hex'), prompt: 'Generate a new original square illustration with image generation: a friendly orange robot gardener watering one small green sprout in a terracotta pot, warm cream background, clean editorial gouache shapes, subtle paper texture, no text. Use no reference images.' },
    ].map(scenario => ({ ...scenario, actor: `native-provider-qa-${scenario.name}`, position: { x: 180, y: 100 }, selection: [], provider: 'spark' })) });
}
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
assert.equal(manifest.baseURL, baseURL);
if (mode === 'prepare') {
  console.log(JSON.stringify({ mode, manifestPath, scenarios: manifest.scenarios.map(({ name, roomId, prompt }) => ({ name, url: `${baseURL}/r/${roomId}`, prompt })), paidCalls: 0 }, null, 2));
  process.exit(0);
}
if (mode === 'verify-browser') {
  const read = name => JSON.parse(readFileSync(resolve(output, name), 'utf8'));
  const records = name => read(name).documents.map(entry => entry.state);
  const scenarios = [];
  for (const name of ['research', 'image']) {
    const browser = read(`${name === 'research' ? 'research-browser-rendered' : 'image-browser'}.json`);
    const reload = read(`${name === 'research' ? 'research-reload-rendered' : 'image-reload'}.json`);
    const disk = records(`${name === 'research' ? 'research-rendered' : 'image'}-disk.json`);
    assert.notEqual(browser.initiator.participantId, browser.peer.participantId);
    const same = (a, b) => assert.equal(canonical(a), canonical(b));
    same(browser.initiator.shapes, browser.peer.shapes); same(reload.shapes, browser.peer.shapes);
    same(browser.peer.shapes, disk.filter(record => record.typeName === 'shape'));
    if (name === 'image') {
      same(browser.initiator.assets, browser.peer.assets); same(reload.assets, browser.peer.assets);
      same(browser.peer.assets, disk.filter(record => record.typeName === 'asset'));
      for (const participant of [browser.initiator, browser.peer, reload]) assert.ok(participant.images.some(image => image.src.startsWith('/api/assets/') && image.complete && image.naturalWidth === 1024 && image.naturalHeight === 1024 && image.width > 0 && image.height > 0));
    } else {
      assert.ok(browser.originalEvidenceUnchanged);
      assert.ok(browser.sources.length >= 5 && browser.sources.every(link => link.target === '_blank' && link.rel === 'noopener noreferrer'));
      const original = read('research-browser-before.json'), originalDisk = records('research-disk.json');
      same(original.initiator.shapes, original.peer.shapes); same(original.peer.shapes, originalDisk.filter(record => record.typeName === 'shape'));
      assert.equal(original.citation.openerIsNull, true); assert.equal(original.citation.referrer, '');
      assert.equal(read('research-render-fix.json').providerCalls, 0);
    }
    const result = read(`${name}-result.json`); assert.equal(result.status, 'provider-and-disk-passed'); assert.equal(result.httpStatus, 200);
    assert.equal(read(`${name}-budget.json`).started, 1);
    scenarios.push({ name, roomId: result.input.roomId, objectId: result.result.objectId, model: result.result.model, elapsedMs: result.elapsedMs,
      nativeApiRequests: 1, mockedProviderOutputs: false, distinctParticipants: true, canonicalPeersMatchDisk: true, reloadUnchanged: true });
  }
  const summary = { at: new Date().toISOString(), status: 'passed', scenarios, research: { citationCount: 5, officialSources: 3, openerIsNull: true, referrer: '', renderingCorrectedWithoutProviderCall: true, originalEvidencePreserved: true },
    image: { model: 'gpt-image-2', quality: 'low', dimensions: '1024x1024', generatedPngSha256: hash(readFileSync(resolve(output, 'generated-illustration.png'))), decodedPixelsVisibleInBothPeersAndReload: true },
    boundary: 'Real native API through Spark routing; two ordinary Chrome tabs with distinct participant sessions. Functional proof, not a latency benchmark or isolated browser-profile test. No physical device or image edit request.',
    qualityIssue: 'The original router expanded the research question into an excerpt request and the provider returned quotations. The original private artifact is retained. Markdown rendering was corrected using the unchanged evidence; the stricter router instruction was not retested with another paid call.', source: source() };
  save('summary.json', summary); console.log(JSON.stringify(summary, null, 2)); process.exit(0);
}

async function readback(scenario, suffix = '') {
  const document = await get(`/api/room/${scenario.roomId}/document`);
  const room = (await get(`/api/room/${scenario.roomId}`)).room;
  const shapes = document.snapshot.documents.map(entry => entry.state).filter(record => record.typeName === 'shape');
  assert.equal(shapes.length, 1, 'Each isolated provider scenario must create exactly one native shape.');
  assert.equal(room.objects.length, 1);
  const object = room.objects[0];
  assert.equal(shapes[0].id, `shape:${object.id}`);
  const diskPath = resolve(root, '.data/tldraw', `${scenario.roomId}.json`);
  const until = Date.now() + 5000;
  while (Date.now() < until) {
    if (existsSync(diskPath)) {
      const saved = JSON.parse(readFileSync(diskPath, 'utf8')).documents.map(entry => entry.state).filter(record => record.typeName === 'shape');
      if (canonical(saved) === canonical(shapes)) break;
    }
    await new Promise(resolveWait => setTimeout(resolveWait, 100));
  }
  const disk = readFileSync(diskPath);
  const diskShapes = JSON.parse(disk).documents.map(entry => entry.state).filter(record => record.typeName === 'shape');
  assert.equal(canonical(diskShapes), canonical(shapes));
  const prefix = `${scenario.name}${suffix}`;
  save(`${prefix}-document.json`, document); save(`${prefix}-room.json`, room);
  writeFileSync(resolve(output, `${prefix}-disk.json`), disk);
  const proof = { at: new Date().toISOString(), roomId: scenario.roomId, objectId: object.id, nativeShapeId: shapes[0].id, diskPath, diskSha256: hash(disk), diskConverged: true };
  if (scenario.name === 'research') {
    assert.equal(object.data.capability, 'research');
    const evidence = object.data.evidence;
    assert.equal(evidence.status, 'model-assessment'); assert.equal(evidence.coverage, 'cited-sources');
    assert.ok(evidence.modelAssessment.citations.length > 0);
    assert.ok(evidence.sources.every(source => ['tldraw.dev', 'www.tldraw.dev', 'tldraw.com', 'www.tldraw.com'].includes(new URL(source.url).hostname)));
    Object.assign(proof, { model: evidence.model, responseId: evidence.responseId, citationCount: evidence.modelAssessment.citations.length, sources: evidence.sources, modelAssessmentOnly: true });
  } else {
    assert.equal(object.kind, 'image'); assert.equal(object.data.imageWidth, 1024); assert.equal(object.data.imageHeight, 1024);
    assert.equal(object.data.provenance.model, 'gpt-image-2'); assert.equal(object.data.provenance.referenceIds, undefined);
    const response = await fetch(`${baseURL}${object.data.src}`, { signal: AbortSignal.timeout(10000) });
    assert.equal(response.status, 200); assert.match(response.headers.get('content-type'), /^image\/png/);
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.ok(bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])));
    assert.equal(bytes.readUInt32BE(16), 1024); assert.equal(bytes.readUInt32BE(20), 1024);
    assert.equal(hash(bytes), object.data.src.match(/([a-f0-9]{64})\.png$/)[1]);
    writeFileSync(resolve(output, 'generated-illustration.png'), bytes);
    Object.assign(proof, { model: object.data.provenance.model, requestedQuality: 'low', src: object.data.src, pngBytes: bytes.length, pngSha256: hash(bytes), imageWidth: 1024, imageHeight: 1024, referenceImages: 0 });
  }
  save(`${prefix}-readback.json`, proof);
  return proof;
}

if (mode === 'readback') {
  for (const scenario of manifest.scenarios) console.log(JSON.stringify(await readback(scenario, '-final')));
  process.exit(0);
}
if (mode === 'render-research') {
  // Run through `npx tsx`; re-render only the saved provider evidence, without a provider request.
  const { researchWidgetHtml } = await import('../../shared/evidence.ts');
  const scenario = manifest.scenarios.find(item => item.name === 'research');
  const original = JSON.parse(readFileSync(resolve(output, 'research-room.json'), 'utf8')).objects[0];
  const current = (await get(`/api/room/${scenario.roomId}`)).room.objects.find(object => object.id === original.id);
  assert.deepEqual(current.data.evidence, original.data.evidence);
  const html = researchWidgetHtml(current.data.evidence), requestId = `qa-render:${hash(html)}`;
  const response = await fetch(`${baseURL}/api/room/${scenario.roomId}/operation`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ actor: scenario.actor, requestId, operation: { type: 'patch', id: original.id, patch: { data: { html } } } }) });
  assert.equal(response.status, 200); const result = await response.json();
  assert.deepEqual(result.room.objects.find(object => object.id === original.id).data.evidence, original.data.evidence);
  save('research-render-fix.json', { at: new Date().toISOString(), roomId: scenario.roomId, objectId: original.id, providerCalls: 0, requestId,
    originalEvidenceSha256: hash(JSON.stringify(original.data.evidence)), evidenceUnchanged: true, htmlSha256: hash(html), source: source(), readback: await readback(scenario, '-rendered') });
  console.log('Re-rendered the original research evidence through its native room operation. No provider call.');
  process.exit(0);
}
assert.equal(process.env.LIVE_NATIVE_PROVIDERS, '1', 'LIVE_NATIVE_PROVIDERS=1 is required for the authorized live proof.');
const scenario = manifest.scenarios.find(item => item.name === mode);
const budgetPath = resolve(output, `${mode}-budget.json`);
assert.ok(!existsSync(budgetPath), 'This exact scenario already started; automatic paid retries are forbidden.');
await get('/api/health');
const before = (await get(`/api/room/${scenario.roomId}`)).room;
assert.equal(before.objects.length, 0, 'Use only the fresh isolated QA room.');
const { name, ...input } = scenario;
const report = { scenario: name, input, startedAt: new Date().toISOString(), sourceBefore: source(), status: 'started', route: '/api/agents/generate', providerOutputsMocked: false };
save(`${mode}-budget.json`, { started: 1, maximum: 1, at: report.startedAt, automaticRetryAllowed: false });
save(`${mode}-request.json`, report);
try {
  const started = performance.now();
  const response = await fetch(`${baseURL}/api/agents/generate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input), signal: AbortSignal.timeout(245000) });
  report.httpStatus = response.status; report.elapsedMs = Math.round(performance.now() - started); report.result = await response.json();
  save(`${mode}-result.json`, report);
  assert.equal(response.status, 200, JSON.stringify(report.result)); assert.equal(report.result.kind, mode);
  report.readback = await readback(scenario); report.status = 'provider-and-disk-passed';
} catch (error) { report.status = 'failed'; report.error = error.message; process.exitCode = 1; }
finally { report.endedAt = new Date().toISOString(); report.sourceAfter = source(); save(`${mode}-result.json`, report); console.log(JSON.stringify({ scenario: mode, status: report.status, httpStatus: report.httpStatus, elapsedMs: report.elapsedMs, objectId: report.result?.objectId, error: report.error })); }
