import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, globSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import { chromium, expect } from '@playwright/test';

// Real subscription turns only. Never copy raw rollout/auth/SDP into proof receipts.
const root = process.cwd();
const out = resolve(process.env.PRESENT_WORK_PROOF_DIRECTORY ?? resolve(root, 'docs/evidence/native-work-proof'));
const dataDirectory = resolve(process.env.PRESENT_DATA_DIRECTORY ?? resolve(root, '.data'));
const jobsDirectory = resolve(dataDirectory, 'work-jobs');
const baseURL = process.env.PRESENT_E2E_URL ?? 'http://127.0.0.1:4318';
assert.match(baseURL, /^http:\/\/127\.0\.0\.1:\d{4,5}$/);
const readbackOnly = process.argv.includes('--readback');
const preflightOnly = process.argv.includes('--preflight');
const continuing = readbackOnly || process.argv.includes('--continue-followup');
const provider = process.env.PRESENT_WORK_PROVIDER ?? 'sol';
assert.ok(['sol', 'luna', 'codex'].includes(provider), 'Choose a current work provider; legacy Spark/Terra cannot start fresh work.');
assert.ok(readbackOnly || preflightOnly || process.env.PRESENT_LIVE_WORK === '1', 'Real subscription turns require PRESENT_LIVE_WORK=1. --preflight/--readback start no turns.');
const save = (name, data) => writeFileSync(resolve(out, name), `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
const get = async path => {
  const response = await fetch(baseURL + path, { signal: AbortSignal.timeout(15000) });
  assert.equal(response.status, 200, `${path}: ${response.status}`);
  return response.json();
};
const availability = await get('/api/agents');
const selected = availability.providers.find(item => item.id === provider);
assert.ok(selected?.configured, selected?.reason ?? `No configured ${provider} provider was discovered.`);
const model = process.env.PRESENT_WORK_MODEL ?? selected.model;
assert.equal(model, selected.model, 'Exact requested model must match provider discovery.');
const affinity = { baseURL, dataDirectory, provider, model };
if (preflightOnly) {
  console.log(JSON.stringify({ mode: 'preflight', ...affinity, configured: true, maxNewTurns: 0, subscriptionDiscoveryOnly: true }, null, 2));
  process.exit(0);
}
mkdirSync(out, { recursive: true, mode: 0o700 });
assert.equal(existsSync(resolve(out, 'budget.json')), continuing, 'Existing budget prevents an accidental paid rerun. Use its continuation/readback mode.');
const previous = continuing ? JSON.parse(readFileSync(resolve(out, 'summary.json'), 'utf8')) : null;
const budget = continuing ? JSON.parse(readFileSync(resolve(out, 'budget.json'), 'utf8')) : null;
if (continuing) {
  for (const [key, value] of Object.entries(affinity)) {
    assert.equal(previous[key], value, `Saved proof ${key} affinity cannot change.`);
    assert.equal(budget[key], value, `Saved budget ${key} affinity cannot change.`);
  }
  assert.equal(budget.requestsStarted, readbackOnly ? 2 : 1);
}
const report = {
  at: new Date().toISOString(), ...affinity, roomId: previous?.roomId ?? randomBytes(16).toString('hex'),
  maxTurns: 2, requestsStarted: budget?.requestsStarted ?? 0, status: 'running',
  separateBrowserContexts: true, physicalDevices: false, mockedModelOutputs: false,
  mode: readbackOnly ? 'readback' : continuing ? 'continue-followup' : 'initial-and-followup',
  newTurnsAllowed: readbackOnly ? 0 : continuing ? 1 : 2,
  initialIngress: 'Real browser Work request typing and Start work click',
  source: { head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), dirty: Boolean(execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim()), harnessSha256: createHash('sha256').update(readFileSync(resolve(root, 'tests/live/native-work.mjs'))).digest('hex') },
};
if (previous?.error) report.initialHarnessFailure = previous.error;
const prior = continuing ? readdirSync(jobsDirectory).filter(name => /^[a-f0-9]{32}\.json$/.test(name))
  .map(name => JSON.parse(readFileSync(resolve(jobsDirectory, name), 'utf8')))
  .find(job => job.roomId === report.roomId && job.jobId === previous.initial?.jobId) : null;
if (continuing) {
  assert.ok(prior, 'Initial job must exist in the declared data directory.');
  assert.equal(prior.provider, provider);
  assert.equal(prior.executionState?.model, model, 'Exact saved execution model must match.');
}
const reserve = () => {
  report.requestsStarted++;
  assert.ok(report.requestsStarted <= 2);
  save('budget.json', { ...affinity, roomId: report.roomId, requestsStarted: report.requestsStarted, maxTurns: 2 });
};
const waitJob = async id => {
  for (let attempt = 0; attempt < 180; attempt++) {
    const job = await get(`/api/work/${id}?roomId=${report.roomId}`);
    if (!['queued', 'running'].includes(job.status)) { assert.equal(job.status, 'completed', job.error ?? job.status); return job; }
    await new Promise(resolveWait => setTimeout(resolveWait, 1000));
  }
  throw new Error('Work job exceeded the 180-second bounded wait.');
};
const inspect = job => {
  const stored = JSON.parse(readFileSync(resolve(jobsDirectory, `${job.jobId}.json`), 'utf8'));
  assert.equal(stored.provider, provider);
  assert.equal(stored.executionState.model, model);
  const workspace = resolve(jobsDirectory, 'workspaces', stored.executionState.workspaceId, 'files');
  for (const file of job.execution.files) assert.equal(createHash('sha256').update(readFileSync(resolve(workspace, file.path))).digest('hex'), file.sha256);
  assert.ok(job.execution.commands.some(command => command.exitCode === 0 && command.status === 'completed'));
  const codexHome = process.env.CODEX_HOME ?? resolve(homedir(), '.codex');
  const paths = globSync(`sessions/**/rollout-*-${stored.executionState.threadId}.jsonl`, { cwd: codexHome });
  assert.equal(paths.length, 1, 'Saved private thread must have one authoritative rollout.');
  const events = readFileSync(resolve(codexHome, paths[0]), 'utf8').trim().split('\n').map(line => JSON.parse(line))
    .filter(event => event.type === 'response_item').map(event => event.payload);
  assert.ok(job.execution.commands.some(command => {
    const call = events.find(event => event.type === 'function_call' && event.call_id === command.id);
    const output = events.find(event => event.type === 'function_call_output' && event.call_id === command.id);
    return JSON.stringify(call ?? {}).includes('node --test math.test.mjs') && /fail 0/.test(JSON.stringify(output)) && /pass [1-9]/.test(JSON.stringify(output));
  }), 'Successful real test command must correlate to a provider call ID and output.');
  assert.ok(job.execution.files.some(file => file.path === 'math.mjs'));
  assert.ok(job.execution.files.some(file => file.path === 'math.test.mjs'));
  return stored.executionState;
};
const publicJob = job => ({ jobId: job.jobId, objectId: job.objectId, provider: job.provider, status: job.status, artifactIds: job.artifactIds, execution: job.execution });
const browser = await chromium.launch({ channel: process.env.PRESENT_E2E_BROWSER_CHANNEL || undefined, headless: true });
try {
  const contexts = await Promise.all([browser.newContext({ viewport: { width: 1440, height: 1000 } }), browser.newContext({ viewport: { width: 1440, height: 1000 } })]);
  if (prior) await contexts[0].addInitScript(actor => sessionStorage.setItem('present:member-id', actor), prior.actor);
  const [a, b] = await Promise.all(contexts.map(context => context.newPage()));
  await Promise.all([a.goto(`${baseURL}/r/${report.roomId}`), b.goto(`${baseURL}/r/${report.roomId}`)]);
  await expect(a.locator('.person')).toHaveCount(2);
  const actor = await a.evaluate(() => sessionStorage.getItem('present:member-id'));
  assert.notEqual(actor, await b.evaluate(() => sessionStorage.getItem('present:member-id')));
  let initial;
  if (prior) initial = await waitJob(prior.jobId);
  else {
    await a.getByRole('button', { name: 'Add to room', exact: true }).click();
    await a.getByRole('button', { name: 'A commitment Assign it, start work, keep the result', exact: true }).click();
    await a.getByLabel('Work request', { exact: true }).pressSequentially('Create math.mjs exporting add(a,b) that returns their sum, plus math.test.mjs using node:test and node:assert/strict with tests for positive, negative, and zero inputs. Run node --test math.test.mjs as a separate final command and fix failures. No dependencies. Return a concise Markdown deliverable describing the function and actual test result.');
    reserve();
    const pending = a.waitForResponse(response => new URL(response.url()).pathname === '/api/work/start' && response.request().method() === 'POST');
    await a.getByRole('button', { name: 'Start work', exact: true }).click();
    const response = await pending; assert.equal(response.status(), 202);
    const accepted = await response.json();
    assert.equal(accepted.provider, provider, 'Actual UI provider must match the requested proof provider.');
    report.initial = publicJob(accepted); save('summary.json', report);
    initial = await waitJob(accepted.jobId);
  }
  const firstState = readbackOnly ? prior.executionState : inspect(initial);
  report.initial = previous?.initial?.execution?.files ? previous.initial : publicJob(initial);
  report.initialActualTestsPassed = true; save('summary.json', report);
  for (const page of [a, b]) {
    page.setDefaultTimeout(10000); await page.getByRole('button', { name: 'Fit everything' }).click();
    await expect(page.getByRole('region', { name: 'Work card' }).getByRole('status')).toHaveText('completed');
  }
  let follow;
  if (readbackOnly) {
    const room = (await get(`/api/room/${report.roomId}`)).room;
    follow = await waitJob(room.objects.find(object => object.id === initial.objectId).data.work.jobId);
  } else {
    await a.getByLabel('Work follow-up', { exact: true }).pressSequentially('Continue the existing files. Change add(a,b) to clamp negative sums to zero, preserving positive sums. Update math.test.mjs with assertions for negative sum clamping, positive sums, and zero. Run node --test math.test.mjs as a separate final command tool call (not bundled with file creation), and fix failures. Return a concise Markdown artifact stating the new behavior and actual test result.');
    reserve();
    const pending = a.waitForResponse(response => new URL(response.url()).pathname === '/api/work/start' && response.request().method() === 'POST');
    await a.getByRole('button', { name: 'Continue work', exact: true }).click();
    const response = await pending; assert.equal(response.status(), 202);
    const accepted = await response.json(); assert.equal(accepted.provider, provider, 'Card must preserve its initial provider.');
    follow = await waitJob(accepted.jobId);
  }
  const nextState = inspect(follow);
  assert.equal(follow.objectId, initial.objectId);
  assert.equal(nextState.workspaceId, firstState.workspaceId);
  assert.equal(nextState.threadId, firstState.threadId);
  assert.equal(nextState.model, firstState.model);
  assert.equal(follow.execution.continued, true);
  assert.notEqual(follow.execution.files.find(file => file.path === 'math.mjs').sha256, report.initial.execution.files.find(file => file.path === 'math.mjs').sha256);
  Object.assign(report, { followup: publicJob(follow), followupActualTestsPassed: true, sameWorkspace: true, samePrivateThread: true, sameExactModel: true, followupViaRealUI: true });
  const shapes = page => page.locator('.tl-shape[data-shape-id]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-shape-id')).sort());
  await expect.poll(async () => JSON.stringify(await shapes(a))).toBe(JSON.stringify(await shapes(b)));
  const canonical = await shapes(a); await Promise.all([a.reload(), b.reload()]);
  for (const page of [a, b]) await expect.poll(async () => JSON.stringify(await shapes(page))).toBe(JSON.stringify(canonical));
  report.peersAndReloadMatch = true; report.peerShapeCount = canonical.length; assert.equal(canonical.length, 3);
  for (const [name, page] of [['initiator', a], ['peer', b]]) {
    await page.getByRole('button', { name: 'Fit everything' }).click();
    await expect(page.getByRole('region', { name: 'Work card' }).getByRole('status')).toHaveText('completed');
    await page.screenshot({ path: resolve(out, `${name}.png`) });
  }
  const room = (await get(`/api/room/${report.roomId}`)).room;
  const document = await get(`/api/room/${report.roomId}/document`);
  const nativeShapes = snapshot => snapshot.documents.map(entry => entry.state).filter(record => record.typeName === 'shape').sort((left, right) => left.id.localeCompare(right.id));
  const diskPath = resolve(dataDirectory, 'tldraw', `${report.roomId}.json`);
  await expect.poll(() => {
    try { return nativeShapes(JSON.parse(readFileSync(diskPath, 'utf8'))); }
    catch { return null; }
  }).toEqual(nativeShapes(document.snapshot));
  report.disk = { path: diskPath, sha256: createHash('sha256').update(readFileSync(diskPath)).digest('hex'), canonicalNativeShapesMatch: true };
  for (const id of [...initial.artifactIds, ...follow.artifactIds]) {
    const artifact = room.objects.find(object => object.id === id); assert.ok(artifact?.data.state?.markdown?.length > 30);
    for (const page of [a, b]) await expect(page.locator(`.tl-shape[data-shape-id="shape:${id}"]`).frameLocator('iframe').locator('#content')).toHaveText(artifact.data.state.markdown);
  }
  report.sharedArtifactsRendered = true; report.status = 'passed';
} catch (error) { report.status = 'failed'; report.error = error.message; process.exitCode = 1; }
finally { await browser.close(); report.endedAt = new Date().toISOString(); save('summary.json', report); console.log(JSON.stringify(report, null, 2)); }
