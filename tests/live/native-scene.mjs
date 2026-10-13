import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium, expect } from '@playwright/test';

// Operator-run genuine provider story. Never resets a paid fence or records pixels/prompts/rollouts in traces.
const readbackOnly = process.argv.includes('--readback');
assert.ok(readbackOnly || process.env.PRESENT_LIVE_SCENE === '1', 'Real scene turns require PRESENT_LIVE_SCENE=1. --readback starts zero turns.');
assert.equal(process.env.PRESENT_E2E_BROWSER_CHANNEL ?? '', '', 'Use version-matched managed Chromium.');
const baseURL = process.env.PRESENT_E2E_URL;
assert.match(baseURL ?? '', /^http:\/\/127\.0\.0\.1:\d{4,5}$/);
const roomId = process.env.PRESENT_SCENE_ROOM_ID;
assert.match(roomId ?? '', /^[a-f0-9]{32}$/);
assert.equal(process.env.PRESENT_NATIVE_SCENE_BUDGET_ROOM, roomId);
assert.equal(process.env.PRESENT_NATIVE_SCENE_MAX_TURNS, '6');
const imagePath = resolve(process.env.PRESENT_SCENE_IMAGE ?? '');
assert.ok(process.env.PRESENT_SCENE_IMAGE && /\.(png|jpe?g)$/i.test(imagePath) && existsSync(imagePath), 'Supply an actual operator-approved photo or diagram PNG/JPEG.');
const dataDirectory = resolve(process.env.PRESENT_DATA_DIRECTORY ?? '');
assert.ok(process.env.PRESENT_DATA_DIRECTORY);
const budgetPath = resolve(process.env.PRESENT_NATIVE_SCENE_BUDGET_FILE ?? '');
assert.ok(process.env.PRESENT_NATIVE_SCENE_BUDGET_FILE);
const out = resolve(process.env.PRESENT_SCENE_PROOF_DIRECTORY ?? '');
assert.ok(process.env.PRESENT_SCENE_PROOF_DIRECTORY);
assert.equal(existsSync(resolve(out, 'summary.json')), readbackOnly, 'An existing proof prevents an accidental paid rerun. Use --readback to inspect the same immutable room/fence without new turns.');
const previous = readbackOnly ? JSON.parse(readFileSync(resolve(out, 'summary.json'), 'utf8')) : null;
mkdirSync(out, { recursive: true, mode: 0o700 });
const hash = value => createHash('sha256').update(value).digest('hex');
const budget = () => {
  const value = JSON.parse(readFileSync(budgetPath, 'utf8'));
  assert.equal(value.roomHash, hash(roomId)); assert.equal(value.maxTurns, 6);
  assert.equal(value.count, value.reservations.length); assert.ok(value.count <= 6);
  return value;
};
if (!readbackOnly && existsSync(budgetPath)) assert.equal(budget().count, 0, 'The live journey requires a fresh scoped fence; never reset an existing reservation.');
const tracePath = resolve('logs/canvas-requests.jsonl');
const traces = () => existsSync(tracePath) ? readFileSync(tracePath, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse).filter(row => row.roomHash === hash(roomId)) : [];
if (!readbackOnly) assert.equal(traces().length, 0, 'Use a fresh fixed room for this journey.');
const get = async path => {
  const response = await fetch(baseURL + path, { signal: AbortSignal.timeout(15000) });
  assert.equal(response.status, 200); return response.json();
};
const selectedProvider = process.env.PRESENT_SCENE_PROVIDER ?? 'sol';
const availability = readbackOnly ? { providers: [{ id: previous.provider, model: previous.model, configured: true }] } : await get('/api/agents');
const provider = availability.providers.find(item => item.id === selectedProvider);
assert.ok(['sol', 'luna', 'codex'].includes(selectedProvider) && provider?.configured, 'Choose a configured current provider.');
const report = { at: new Date().toISOString(), roomId, baseURL, dataDirectory, imagePath, imageSha256: hash(readFileSync(imagePath)), provider: selectedProvider, model: provider.model, maxActualTurnStarts: 6, physicalDevices: false, contexts: 2, mockedModelOutputs: false, sourceHead: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), node: process.version, status: 'running', phases: [], requests: [] };
const save = () => {
  const temporary = resolve(out, 'summary.json.tmp');
  writeFileSync(temporary, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 }); renameSync(temporary, resolve(out, 'summary.json'));
};
const progress = phase => { report.progress = { phase, at: new Date().toISOString(), requestsObserved: report.requests.length, reservedTurns: existsSync(budgetPath) ? budget().count : 0 }; save(); console.log(`native-scene: ${phase}`); };
if (!readbackOnly) save();
const document = async () => (await get(`/api/room/${roomId}/document`)).snapshot.documents.map(entry => entry.state);
const scene = records => records.find(record => record.typeName === 'document')?.meta.scenes?.[0];
const native = records => records.filter(record => record.typeName === 'shape').sort((a, b) => a.id.localeCompare(b.id));
if (readbackOnly) {
  for (const [key, value] of Object.entries({ roomId, baseURL, dataDirectory, imagePath, imageSha256: report.imageSha256, provider: selectedProvider, model: provider.model })) assert.equal(previous[key], value, `Readback must preserve ${key} affinity.`);
  const before = budget(), records = await document(), current = scene(records);
  assert.ok(current, 'No durable scene exists yet. Inspect the preserved progress and fence.');
  const diskPath = resolve(dataDirectory, 'tldraw', `${roomId}.json`);
  await expect.poll(() => { try { return native(JSON.parse(readFileSync(diskPath, 'utf8')).documents.map(entry => entry.state)); } catch { return null; } }).toEqual(native(records));
  await expect.poll(() => { try { return scene(JSON.parse(readFileSync(diskPath, 'utf8')).documents.map(entry => entry.state)); } catch { return null; } }).toEqual(current);
  const readbackBrowser = await chromium.launch({ headless: true });
  try {
    const contexts = await Promise.all([readbackBrowser.newContext(), readbackBrowser.newContext()]);
    const pages = await Promise.all(contexts.map(context => context.newPage()));
    for (const page of pages) {
      page.setDefaultTimeout(15000); page.setDefaultNavigationTimeout(30000);
      await page.goto(`${baseURL}/r/${roomId}`);
      await expect.poll(() => page.evaluate(() => window.__presentEditor.getCurrentPageShapes().map(shape => ({ id: shape.id, x: shape.x, y: shape.y, props: shape.props })).sort((a, b) => a.id.localeCompare(b.id)))).toEqual(native(records).map(shape => ({ id: shape.id, x: shape.x, y: shape.y, props: shape.props })));
      await page.reload();
      await expect.poll(() => page.evaluate(() => window.__presentEditor.getCurrentPageShapes().map(shape => ({ id: shape.id, x: shape.x, y: shape.y, props: shape.props })).sort((a, b) => a.id.localeCompare(b.id)))).toEqual(native(records).map(shape => ({ id: shape.id, x: shape.x, y: shape.y, props: shape.props })));
      await expect.poll(() => page.evaluate(() => window.__presentEditor.store.allRecords().find(record => record.typeName === 'document')?.meta.scenes?.[0]?.revision)).toBe(current.revision);
    }
    assert.equal(budget().count, before.count, 'Readback must start zero new turns.');
    const requestReceipts = previous.requests.map(request => {
      const key = hash(JSON.stringify({ actor: previous.actor, requestId: request.requestId, roomId }));
      try {
        const saved = JSON.parse(readFileSync(resolve(dataDirectory, 'agent-requests', `${key}.json`), 'utf8'));
        return { phase: request.phase, requestId: request.requestId, state: saved.status, completedPaidResult: saved.status === 'completed', kind: saved.result?.kind, sceneId: saved.result?.sceneId };
      } catch { return { phase: request.phase, requestId: request.requestId, state: 'receipt-unavailable' }; }
    });
    const result = { at: new Date().toISOString(), mode: 'readback', newTurns: 0, roomId, fencePath: budgetPath, reservedTurns: before.count, sceneId: current.id, revision: current.revision, sceneShapeIds: current.shapeIds, peersDiskAndReloadMatch: true, diskSha256: hash(readFileSync(diskPath)), originalHarnessStatus: previous.status, originalProgress: previous.progress, requestReceipts, completedBrowserJourney: previous.status === 'passed', disclosure: previous.status === 'passed' ? 'Prior full journey receipt retained.' : 'Durable scene readback passed; original incomplete browser assertions remain unavailable. No paid phase was repeated. Continue only an unfinished phase explicitly in this same room after inspecting its request receipt; never repeat a completed phase.', requestTrace: traces() };
    writeFileSync(resolve(out, 'readback.json'), `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 }); console.log(JSON.stringify(result, null, 2));
  } finally { await readbackBrowser.close(); }
  process.exit(0);
}
const browser = await chromium.launch({ headless: true });
report.browser = browser.version();
try {
  const contexts = await Promise.all([browser.newContext({ viewport: { width: 1440, height: 1000 } }), browser.newContext({ viewport: { width: 1440, height: 1000 } })]);
  const [a, b] = await Promise.all(contexts.map(context => context.newPage()));
  for (const page of [a, b]) { page.setDefaultTimeout(15000); page.setDefaultNavigationTimeout(30000); }
  a.on('request', request => {
    if (new URL(request.url()).pathname !== '/api/agents/generate' || request.method() !== 'POST') return;
    const input = request.postDataJSON();
    report.requests.push({ phase: report.progress?.phase, requestId: input.requestId, recoverOnly: input.recoverOnly === true, provider: input.provider, selection: input.selection, imageBytes: input.canvasImage?.length ?? 0, imageSha256: input.canvasImage ? hash(input.canvasImage) : null, startedAt: new Date().toISOString() }); save();
  });
  await Promise.all([a.goto(`${baseURL}/r/${roomId}`), b.goto(`${baseURL}/r/${roomId}`)]);
  await expect(a.locator('.person')).toHaveCount(2);
  await a.getByRole('button', { name: 'Room settings', exact: true }).click();
  await a.getByLabel('Who’s making things?').selectOption(selectedProvider);
  if (provider.reasoning?.includes('high')) await a.getByLabel('Reasoning level', { exact: true }).selectOption('high');
  await a.getByLabel('Jev for quick decisions', { exact: true }).uncheck();
  await a.getByRole('button', { name: 'Close settings', exact: true }).click();
  report.decisions = 'off'; // This proof's paid fence counts Codex, not unrelated classification calls.
  await a.getByRole('button', { name: 'Add to room', exact: true }).click();
  await a.locator('input[type="file"]').setInputFiles(imagePath);
  await expect.poll(() => a.evaluate(() => window.__presentEditor.getSelectedShapes().map(shape => shape.type))).toEqual(['image']);
  const uploadedId = await a.evaluate(() => window.__presentEditor.getSelectedShapeIds()[0]);
  report.uploadedId = uploadedId; report.actor = await a.evaluate(() => sessionStorage.getItem('present:member-id')); progress('source-diagram-uploaded');
  const generate = async (prompt, button = 'Create with agent', phase = 'generation') => {
    await a.getByRole('textbox', { name: 'Ask the room' }).fill(prompt);
    const started = performance.now(), before = report.requests.length;
    progress(`${phase}:before-dispatch`);
    await a.getByRole('button', { name: button, exact: true }).click();
    await expect.poll(() => report.requests.length).toBeGreaterThan(before);
    await expect(a.getByRole('button', { name: 'Stop generation' })).toHaveCount(0, { timeout: 180000 });
    assert.equal(await a.getByRole('button', { name: 'Recover result' }).count(), 0, 'Generation did not complete; saved request must be inspected instead of repeated.');
    const request = report.requests.at(-1); assert.equal(request.provider, selectedProvider);
    report.phases.push({ phase, requestId: request.requestId, browserCommandToFinishedUIWallMs: performance.now() - started, clock: 'Host monotonic performance.now; includes Playwright and UI observation; sampleSize=1', actualReservedTurns: budget().count }); progress(`${phase}:finished-ui`);
  };
  await generate('Use the selected self-authored diagram pixels as evidence. Create an editable native animated scene showing its visible boxes/entities and directional relationships, not a widget or new raster image. Set autoplay=false explicitly so the initial frame remains at time zero. Add a visible static text annotation with key sourceCaption and label Source diagram. Include at least one moving native token, a 6-second illustrative trajectory and playback controls. This is an illustrative diagram, not a photograph; infer no photo identity. Keep source identities, label uncertainty, no research or external retrieval.', 'Create with agent', 'initial-scene');
  assert.ok(report.requests[0].imageBytes > 500 && report.requests[0].imageBytes <= 1500000, 'Actual selected pixels must reach native generation.');
  let records = await document(), initial = scene(records); assert.ok(initial && initial.plan.tracks.length > 0);
  assert.equal(initial.plan.autoplay, false, 'The requested initial zero-time frame must be stable.');
  report.initialScene = { id: initial.id, revision: initial.revision, shapeIds: initial.shapeIds };
  progress('initial-scene:durable-native-result');
  await b.getByRole('button', { name: 'Fit everything', exact: true }).click();
  const tokenId = initial.shapeIds[initial.plan.tracks[0].key];
  const beforePlayback = records.find(record => record.id === tokenId);
  await a.getByRole('button', { name: 'Play animation', exact: true }).click();
  await expect.poll(async () => (await document()).find(record => record.id === tokenId)).not.toEqual(beforePlayback);
  await a.getByRole('button', { name: 'Pause animation', exact: true }).click();
  await a.getByRole('button', { name: 'Restart animation', exact: true }).click();
  await a.getByRole('button', { name: 'Pause animation', exact: true }).click();
  await a.getByRole('slider', { name: 'Animation position', exact: true }).focus();
  await a.getByRole('slider', { name: 'Animation position', exact: true }).press('Home');
  await expect.poll(async () => (await document()).find(record => record.id === tokenId)?.x).toBe(beforePlayback.x);
  report.playbackVerified = true; progress('playback:real-controls-verified');
  const captionId = initial.shapeIds.sourceCaption; assert.ok(captionId, 'The generated scene must include the requested editable static annotation.');
  const caption = page => page.locator(`.tl-shape[data-shape-id="${captionId}"]`);
  await caption(b).dblclick();
  const input = b.locator('.tl-text-input [contenteditable="true"]');
  await input.press('ControlOrMeta+a'); await input.pressSequentially('Human correction preserved');
  const direct = [], peer = [];
  for (let index = 0; index < 20; index++) {
    const expected = `Human correction preserved${'x'.repeat(index + 1)}`, started = performance.now();
    await input.pressSequentially('x'); await expect(input).toHaveText(expected); direct.push(performance.now() - started);
    await expect(caption(a).locator('.tl-text-content')).toContainText(expected); peer.push(performance.now() - started);
  }
  await b.keyboard.press('Escape');
  const correction = `Human correction preserved${'x'.repeat(20)}`;
  report.correction = correction; report.benchmarkSamples = { direct, peer }; progress('manual-correction:twenty-browser-samples');
  await caption(a).click();
  await generate(`Revise this same existing scene. Preserve all native entity keys and identities, source image and unrelated shapes. Preserve the manual sourceCaption label EXACTLY: ${correction}. Keep its current position. Make the animated token travel more slowly with an 8-second duration. Set autoplay=false. Return the complete same-scene native plan, no research or image generation.`, 'Create with agent', 'revision');
  records = await document(); const revised = scene(records);
  assert.equal(revised.id, initial.id); assert.notEqual(revised.revision, initial.revision);
  assert.equal(revised.shapeIds.sourceCaption, captionId);
  await expect(caption(a).locator('.tl-text-content')).toContainText(correction);
  await expect(caption(b).locator('.tl-text-content')).toContainText(correction);
  assert.ok(records.some(record => record.id === uploadedId), 'Source image survives revision.');
  report.revisedScene = { id: revised.id, revision: revised.revision, shapeIds: revised.shapeIds }; progress('revision:correction-and-identity-verified');
  const beforeInterrupt = budget().count;
  await a.getByRole('textbox', { name: 'Ask the room' }).fill('Revise the same animation to ten seconds while preserving the exact human annotation and every entity. No research.');
  progress('interruption:before-dispatch');
  await a.getByRole('button', { name: 'Create with agent' }).click();
  await expect.poll(() => budget().count, { timeout: 30000 }).toBeGreaterThan(beforeInterrupt);
  const interruptedRequest = report.requests.at(-1).requestId;
  report.interruptedRequest = interruptedRequest; progress('interruption:turn-reserved');
  await expect.poll(() => traces().some(row => row.requestId === interruptedRequest && row.stage === 'provider_dispatch' && row.transport === 'codex'), { timeout: 30000 }).toBe(true);
  await a.getByRole('button', { name: 'Stop generation' }).click();
  await expect(a.getByRole('button', { name: 'Recover result' })).toBeVisible();
  await expect.poll(() => traces().some(row => row.requestId === interruptedRequest && ['aborted', 'timed_out', 'failed'].includes(row.stage)), { timeout: 30000 }).toBe(true);
  await a.reload(); await expect(a.getByRole('button', { name: 'Recover result' })).toBeVisible();
  const stoppedCount = budget().count;
  await a.getByRole('button', { name: 'Recover result' }).click();
  await expect(a.getByRole('button', { name: 'Stop generation' })).toHaveCount(0);
  assert.equal(budget().count, stoppedCount, 'Reload and replay-only recovery must start zero turns.');
  await expect(a.getByRole('button', { name: 'Start a new continuation' })).toBeVisible();
  report.reconnectAndRecoveryNewTurns = 0; progress('interruption:reconnected-replay-only-verified');
  await caption(a).click();
  await generate(`Continue from the current native scene after interruption. Preserve the sourceCaption label EXACTLY: ${correction}, all keys and entity identities. Complete a ten-second native animation, autoplay=false, without research or new media.`, 'Start a new continuation', 'explicit-continuation');
  records = await document(); const final = scene(records);
  assert.equal(final.id, initial.id); assert.equal(final.shapeIds.sourceCaption, captionId);
  await expect(caption(a).locator('.tl-text-content')).toContainText(correction);
  await expect(caption(b).locator('.tl-text-content')).toContainText(correction);
  await expect.poll(() => b.evaluate(() => window.__presentEditor.getCurrentPageShapes().map(shape => ({ id: shape.id, x: shape.x, y: shape.y, props: shape.props })).sort((a, b) => a.id.localeCompare(b.id)))).toEqual(native(records).map(shape => ({ id: shape.id, x: shape.x, y: shape.y, props: shape.props })));
  const diskPath = resolve(dataDirectory, 'tldraw', `${roomId}.json`);
  await expect.poll(() => { try { return native(JSON.parse(readFileSync(diskPath, 'utf8')).documents.map(entry => entry.state)); } catch { return null; } }).toEqual(native(records));
  await expect.poll(() => { try { return scene(JSON.parse(readFileSync(diskPath, 'utf8')).documents.map(entry => entry.state)); } catch { return null; } }).toEqual(final);
  await Promise.all([a.reload(), b.reload()]);
  for (const [name, page] of [['initiator', a], ['peer', b]]) { await expect(caption(page).locator('.tl-text-content')).toContainText(correction); await page.screenshot({ path: resolve(out, `${name}.png`) }); }
  const receipts = traces();
  assert.ok(receipts.some(row => row.requestId === interruptedRequest && ['aborted', 'timed_out', 'failed'].includes(row.stage)), 'Actual interruption must have a terminal receipt.');
  const dispatches = receipts.filter(row => row.stage === 'provider_dispatch' && row.transport === 'codex');
  assert.equal(dispatches.length, budget().count);
  assert.ok(receipts.some(row => row.stage === 'provider_result' && row.model === provider.model && row.modelSource === 'confirmed'));
  const stats = values => { const sorted = [...values].sort((a, b) => a - b); return { n: values.length, rawMs: values, p50Ms: sorted[Math.ceil(sorted.length * .5) - 1], p95Ms: sorted[Math.ceil(sorted.length * .95) - 1], maxMs: sorted.at(-1) }; };
  Object.assign(report, { status: 'passed', actualReservedTurnStarts: budget().count, interruptedRequest, reconnectAndRecoveryNewTurns: 0, manualCorrectionPreserved: true, sameSceneAndAnnotationIdentity: true, sourceImagePreserved: true, peersAndReloadMatch: true, disk: { path: diskPath, sha256: hash(readFileSync(diskPath)), nativeShapesMatch: true }, finalScene: { id: final.id, revision: final.revision, shapeIds: final.shapeIds }, benchmark: { clock: 'One host monotonic performance.now, browser keyboard to text DOM; includes automation/assertion overhead, two contexts on one host', direct: stats(direct), peer: stats(peer) } });
  writeFileSync(resolve(out, 'trace.json'), JSON.stringify(receipts, null, 2), { mode: 0o600 });
} catch (error) { report.status = 'failed'; report.error = error.message; process.exitCode = 1; }
finally { report.endedAt = new Date().toISOString(); save(); await browser.close(); console.log(JSON.stringify(report, null, 2)); }
