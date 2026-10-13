import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, realpathSync, openSync, closeSync } from 'node:fs';
import { dirname, resolve, join, sep } from 'node:path';
import { chromium, expect } from '@playwright/test';
import { RoomAccess } from '../../server/access/store.ts';
import { makeObject } from '../../shared/room.ts';
const hash = value => createHash('sha256').update(value).digest('hex');
const out = resolve(process.env.PRESENT_PROJECT_STORY_PROOF_DIRECTORY ?? '');
assert.ok(process.env.PRESENT_PROJECT_STORY_PROOF_DIRECTORY, 'Supply a new private proof directory.');
const source = realpathSync(process.env.PRESENT_PROJECT_STORY_SOURCE ?? '');
const releaseRoot = realpathSync(resolve(process.cwd(), '..'));
assert.ok(source.startsWith(releaseRoot + sep) && source !== realpathSync(process.cwd()) && releaseRoot.endsWith('/.release'), 'Source must be a separate isolated repository inside .release.');
const summaryPath = join(out, 'summary.json'), dataDirectory = join(out, 'runtime'), budgetPath = join(out, 'work-budget.json');
if (process.argv.includes('--readback')) {
  const report = JSON.parse(readFileSync(summaryPath, 'utf8')), budget = JSON.parse(readFileSync(budgetPath, 'utf8'));
  assert.equal(report.sourceFingerprint, hash(source)); assert.equal(budget.maxTurns, 2); assert.ok(budget.reservations.length <= 2);
  for (const file of report.appliedFiles ?? []) assert.equal(hash(readFileSync(join(source, file.path))), file.sha256);
  const disk = JSON.parse(readFileSync(join(dataDirectory, 'tldraw', report.roomId + '.json'), 'utf8'));
  const shapes = disk.documents.map(entry => entry.state).filter(record => record.typeName === 'shape');
  for (const jobId of report.completedJobs ?? []) assert.ok(shapes.some(shape => shape.props?.data?.sourceJobId === jobId), 'Completed artifact must survive on disk.');
  console.log(JSON.stringify({ status: report.status, readback: true, reservedTurns: budget.reservations.length, completedJobs: report.completedJobs?.length ?? 0, appliedFilesMatch: true, artifactsOnDisk: true })); process.exit(0);
}
assert.equal(process.env.PRESENT_LIVE_PROJECT_STORY, '1', 'Only the root owner runs genuine Codex turns.');
assert.equal(process.env.PRESENT_E2E_BROWSER_CHANNEL ?? '', '', 'Use matched managed Chromium.');
assert.ok(!existsSync(summaryPath) && !existsSync(budgetPath), 'Never rerun a paid story or reset its immutable fence. Use --readback.');
const clean = execFileSync('git', ['-C', source, 'status', '--porcelain'], { encoding: 'utf8' }); assert.equal(clean, '', 'Use a clean committed isolated source.');
for (const path of ['src/widgets/packs/game-state.ts', 'src/widgets/packs/common.ts']) assert.ok(existsSync(join(source, path)));
mkdirSync(dataDirectory, { recursive: true, mode: 0o700 });
writeFileSync(join(dataDirectory, 'projects.json'), JSON.stringify({ projects: [{ id: 'present-card-contract', name: 'PRESENT shared card source', description: 'Explicit committed source selection in an isolated clone.', directory: source, include: ['src/widgets/packs/game-state.ts', 'src/widgets/packs/common.ts'] }] }), { mode: 0o600 });
const secret = randomBytes(32).toString('hex'), accessDirectory = join(dataDirectory, 'access'), access = new RoomAccess({ directory: accessDirectory, secret }), owner = access.createSession(), { roomId } = access.createRoom(owner.token); access.close();
const cardId = 'project-story-' + randomBytes(6).toString('hex'), baseURL = process.env.PRESENT_E2E_URL ?? 'http://127.0.0.1:4398'; assert.match(baseURL, /^http:\/\/127\.0\.0\.1:\d{4,5}$/);
const report = { version: 1, status: 'running', at: new Date().toISOString(), roomId, cardId, sourceFingerprint: hash(source), selectedPaths: ['src/widgets/packs/game-state.ts', 'src/widgets/packs/common.ts'], provider: 'sol', reasoning: 'high', maxActualTurns: 2, mockedProviderOutputs: false, phases: [], completedJobs: [], appliedFiles: [] };
const save = () => writeFileSync(summaryPath, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
const progress = phase => { report.phases.push({ phase, at: new Date().toISOString() }); report.reservedTurns = existsSync(budgetPath) ? JSON.parse(readFileSync(budgetPath, 'utf8')).reservations.length : 0; save(); console.log('project-story: ' + phase); };
progress('prepared');
const log = openSync(join(out, 'server.log'), 'wx', 0o600);
const server = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], { cwd: process.cwd(), stdio: ['ignore', log, log], env: { ...process.env, PRESENT_PORT: new URL(baseURL).port, PRESENT_HOST: '127.0.0.1', PRESENT_DATA_DIRECTORY: dataDirectory, PRESENT_ENV_FILE: join(out, 'absent-provider.env'), PRESENT_MODEL_TRANSPORT: 'codex', PRESENT_ACCESS_MODE: 'invite', PRESENT_ACCESS_ORIGIN: baseURL, PRESENT_ACCESS_SECRET: secret, PRESENT_ACCESS_DIRECTORY: accessDirectory, PRESENT_PROJECT_STORY_BUDGET_FILE: budgetPath, PRESENT_PROJECT_STORY_ROOM: roomId, PRESENT_PROJECT_STORY_CARD: cardId, PRESENT_PROJECT_STORY_MAX_TURNS: '2', OPENAI_API_KEY: '', CEREBRAS_API_KEY: '', TYPESAFE_API_KEY: '', TYPESAFE_AI_API_KEY: '', TYPESAFE_AI_API: '', TYPSESAFE_AI_API: '', LIVEKIT_API_KEY: '', LIVEKIT_API_SECRET: '' } });
let browser;
try {
  await expect.poll(async () => { try { return (await fetch(baseURL + '/api/health')).status; } catch { return 0; } }, { timeout: 30000 }).toBe(200);
  browser = await chromium.launch({ headless: true }); const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 900 } });
  await context.addCookies([{ name: 'present_session', value: owner.token, domain: '127.0.0.1', path: '/', httpOnly: true, sameSite: 'Strict' }]);
  const page = await context.newPage(); page.setDefaultTimeout(15000); await page.goto(`/r/${roomId}`); await expect(page.locator('.room-status')).toHaveText('here, together');
  const request = async (path, body) => { const response = await context.request.post(path, { headers: { origin: baseURL }, data: body }); const value = await response.json(); assert.equal(response.status(), path === '/api/work/start' ? 202 : 200, 'Signed operation must succeed: ' + path); return value; };
  const agents = await context.request.get('/api/agents').then(response => response.json()); assert.ok(agents.workspace?.supported); const model = agents.providers.find(provider => provider.id === 'sol'); assert.ok(model?.configured && model.model === 'gpt-6.1-sol'); report.availableModel = model.model;
  const card = makeObject('widget', owner.userId, { x: 100, y: 100 }, { capability: 'work', owner: 'Root owner', prompt: 'Align the shared card source contract.' }); Object.assign(card, { id: cardId, title: 'Shared card contract follow-through', w: 680, h: 650 });
  await request(`/api/room/${roomId}/operation`, { roomId, actor: owner.userId, requestId: 'story-card', operation: { type: 'put', object: card } });
  const prompts = [
    'In this committed PRESENT source selection, shuffleOrder accepts IDs that recordPatch rejects. Align shuffleOrder with the existing /^[\\w-]{1,100}$/ ID contract. Reject empty, whitespace-containing, colon-containing and overlong IDs and duplicates; preserve valid empty/singleton deck behavior and all standardDeck/rollValues behavior. Add tests/game-state-contract.test.mjs using node:assert/strict and node:test, importing game-state.ts directly. Run node --experimental-strip-types --test tests/game-state-contract.test.mjs. Make the actual source edit and passing tests. Do not commit, install packages, alter .git/config, read other projects or use the network. Return a concise factual deliverable.',
    'Continue the same task and workspace. Extend tests/game-state-contract.test.mjs with deterministic fixed-sample Fisher-Yates boundary tests, input-array preservation, empty and singleton behavior and a valid 52-card deck with unique contiguous order values. Retain the prior ID validation fix. Run node --experimental-strip-types --test tests/game-state-contract.test.mjs. Do not commit, install packages or alter .git/config. Return a concise factual deliverable.'
  ];
  for (let turn = 0; turn < 2; turn++) {
    progress('turn-' + (turn + 1) + ':dispatch'); const started = await request('/api/work/start', { roomId, actor: owner.userId, objectId: cardId, requestId: 'project-story-turn-' + (turn + 1), prompt: prompts[turn], projectId: 'present-card-contract', provider: 'sol', reasoning: 'high', fast: false });
    const jobId = started.job?.jobId ?? started.jobId; assert.match(jobId ?? '', /^[a-f0-9]{32}$/);
    await expect.poll(async () => { const value = await context.request.get(`/api/work/${jobId}?roomId=${roomId}`).then(response => response.json()); const status = value.job?.status ?? value.status; if (['failed', 'cancelled', 'interrupted'].includes(status)) throw new Error('Work terminated before completion: ' + status); return status; }, { timeout: 240000, intervals: [500, 1000, 2000] }).toBe('completed');
    const saved = JSON.parse(readFileSync(join(dataDirectory, 'work-jobs', jobId + '.json'), 'utf8')); assert.equal(saved.executionState.model, 'gpt-6.1-sol'); assert.ok(saved.execution.commands.some(command => command.status === 'completed' && command.exitCode === 0)); report.completedJobs.push(jobId);
    report.phases.push({ phase: 'turn-' + (turn + 1) + ':completed', at: new Date().toISOString(), jobId, model: saved.executionState.model, threadHash: hash(saved.executionState.threadId), workspaceHash: hash(saved.executionState.workspaceId), continued: saved.execution.continued, commands: saved.execution.commands.map(command => ({ status: command.status, exitCode: command.exitCode, commandHash: command.commandSha256 ?? hash(command.command) })) });
    await page.goto(`/r/${roomId}?focus=${cardId}`); await page.getByRole('button', { name: 'Review project changes', exact: true }).click();
    const review = await request('/api/projects/review', { roomId, actor: owner.userId, jobId }); assert.ok(review.review.canApply && !review.review.diffTruncated); report.phases.push({ phase: 'turn-' + (turn + 1) + ':reviewed', at: new Date().toISOString(), snapshotId: review.review.project.snapshotId, changeId: review.review.changeId, diffHash: hash(review.review.diff), paths: review.review.changes.map(change => change.path) });
    const reviewPath = join(out, 'turn-' + (turn + 1) + '-review.json'), approvalPath = join(out, 'turn-' + (turn + 1) + '-approval.json'), diffHash = hash(review.review.diff);
    writeFileSync(reviewPath, JSON.stringify({ version: 1, jobId, snapshotId: review.review.project.snapshotId, changeId: review.review.changeId, diffHash, diff: review.review.diff, changes: review.review.changes }, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    progress('turn-' + (turn + 1) + ':waiting-for-root-exact-diff-approval');
    const approvalDeadline = Date.now() + 60000; let approved = false;
    while (Date.now() < approvalDeadline) {
      if (existsSync(approvalPath)) { const approval = JSON.parse(readFileSync(approvalPath, 'utf8')); assert.equal(approval.changeId, review.review.changeId); assert.equal(approval.diffHash, diffHash); approved = true; break; }
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    assert.ok(approved, 'The root must inspect this exact diff and write its matching approval within60seconds.');
    report.phases.push({ phase: 'turn-' + (turn + 1) + ':root-approved-exact-diff', at: new Date().toISOString(), changeId: review.review.changeId, diffHash });
    await expect(page.getByRole('button', { name: 'Apply reviewed changes', exact: true })).toBeDisabled(); await page.getByLabel('I reviewed this exact diff.').check(); await page.getByRole('button', { name: 'Apply reviewed changes', exact: true }).click(); await expect(page.getByText('Applied this reviewed change to the registered source.', { exact: true })).toBeVisible();
    const result = execFileSync(process.execPath, ['--experimental-strip-types', '--test', 'tests/game-state-contract.test.mjs'], { cwd: source, encoding: 'utf8', timeout: 30000, env: { PATH: dirname(process.execPath) + ':/usr/bin:/bin', TMPDIR: out } }); assert.match(result, /fail 0/);
    report.appliedFiles = saved.execution.project.changes.map(change => ({ path: change.path, sha256: hash(readFileSync(join(source, change.path))) })); progress('turn-' + (turn + 1) + ':applied-and-independent-tests-passed');
  }
  const budget = JSON.parse(readFileSync(budgetPath, 'utf8')); assert.equal(budget.reservations.length, 2); assert.equal(report.phases.filter(phase => phase.continued).length, 1); const completed = report.phases.filter(phase => phase.threadHash); assert.equal(completed[0].threadHash, completed[1].threadHash); assert.equal(completed[0].workspaceHash, completed[1].workspaceHash);
  await page.reload(); await expect(page.getByRole('button', { name: 'Review project changes', exact: true })).toBeVisible(); await page.screenshot({ path: join(out, 'completed-work.png') });
  await expect.poll(() => { try { const disk = JSON.parse(readFileSync(join(dataDirectory, 'tldraw', roomId + '.json'), 'utf8')); return report.completedJobs.every(job => disk.documents.some(entry => entry.state.props?.data?.sourceJobId === job)); } catch { return false; } }).toBe(true);
  report.status = 'passed'; report.reservedTurns = 2; report.sameThreadAndWorkspace = true; report.appliedTestsPassed = true; progress('disk-and-reload-readback-passed');
} catch (error) { report.status = 'failed'; report.failure = { phase: report.phases.at(-1)?.phase, name: error.name }; process.exitCode = 1; }
finally { report.endedAt = new Date().toISOString(); save(); await browser?.close(); server.kill('SIGTERM'); closeSync(log); console.log(JSON.stringify({ status: report.status, completedJobs: report.completedJobs.length, reservedTurns: report.reservedTurns ?? 0, proofDirectory: out })); }
