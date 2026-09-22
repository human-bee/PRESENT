import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { AgentError } from '../server/agents/contract';
import { codexThreadOptions, type generateWithCodex } from '../server/agents/codex';
import { WorkJobs } from '../server/agents/work-jobs';
import { RoomStore } from '../server/room-store';
import { makeObject } from '../shared/room';

const roomId = 'd'.repeat(32), actor = 'human-one';
const artifact = JSON.stringify({ title: 'Launch brief', format: 'markdown', body: '# Launch brief\n\nOwner: the product team.\n\nShip the validated prototype, collect five interviews, and review the findings.' });
const input = (requestId: string) => ({ roomId, actor, requestId, title: 'Prepare the launch brief', owner: 'Ben', prompt: 'Draft our launch brief with concrete next steps.' });
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
function deferred() { let resolve: (value: string) => void = () => {}; let reject: (error: Error) => void = () => {}; const promise = new Promise<string>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function fixture(generate: typeof generateWithCodex, persist?: (path: string, content: string) => void) {
  const directory = mkdtempSync(join(tmpdir(), 'present-work-'));
  const store = new RoomStore({ directory: join(directory, 'rooms'), legacyDirectory: join(directory, 'legacy') });
  const jobsDirectory = join(directory, 'jobs');
  const jobs = new WorkJobs({ directory: jobsDirectory, store, generate, persist });
  return { jobs, store, jobsDirectory, close: async () => { jobs.close(); await jobs.settled(); store.close(); rmSync(directory, { recursive: true, force: true }); } };
}

test('start returns a causal shared card before mocked Codex runs, and commits one genuine artifact atomically', async () => {
  let calls = 0;
  const f = fixture(async (prompt, _signal, provider, profile) => {
    calls++; assert.equal(provider, 'luna'); assert.match(JSON.parse(prompt).deliverable, /launch brief/);
    assert.ok(profile); assert.match(profile.instructions, /actual deliverable/);
    assert.deepEqual(codexThreadOptions(provider, profile).environments, []);
    assert.equal(codexThreadOptions(provider, profile).config.features.shell_tool, false);
    assert.deepEqual(Object.keys((profile.outputSchema as { properties: object }).properties), ['title', 'format', 'body']);
    return artifact;
  });
  try {
    const job = f.jobs.start(input('once')); assert.equal(job.status, 'queued'); assert.equal(calls, 0);
    const observations: boolean[] = [];
    const unsubscribe = f.store.subscribeRoom(roomId, room => { const card = room.objects.find(object => object.id === job.objectId); if ((card?.data.work as { status?: string })?.status === 'completed') observations.push(room.objects.some(object => object.data.sourceJobId === job.jobId)); });
    assert.equal(f.jobs.start(input('once')).jobId, job.jobId);
    assert.throws(() => f.jobs.start({ ...input('once'), prompt: 'Something else' }), /different work/);
    await f.jobs.settled(); unsubscribe();
    const finished = f.jobs.get(roomId, job.jobId), room = f.store.getRoom(roomId);
    assert.equal(finished.status, 'completed'); assert.equal(calls, 1); assert.equal(room.objects.length, 2);
    assert.equal(finished.artifactIds.length, 1); assert.ok(observations.length && observations.every(Boolean));
    const output = room.objects.find(object => object.id === finished.artifactIds[0]); assert.ok(output);
    assert.equal((output.data.state as { markdown: string }).markdown, JSON.parse(artifact).body);
    assert.equal(output?.data.completionBoundary, 'artifact-created');
    assert.equal(f.jobs.start(input('once')).jobId, job.jobId); assert.equal(calls, 1);
  } finally { await f.close(); }
});

test('human title and ownership edits survive generation and the initiating actor remains distinct', async () => {
  const pending = deferred(); const f = fixture(async () => pending.promise);
  try {
    const job = f.jobs.start(input('human-edits')); await tick();
    f.store.applyOperation(roomId, { type: 'patch', id: job.objectId, patch: { title: 'Maya’s revised brief', data: { owner: 'Maya' } } }, 'human-two');
    pending.resolve(artifact); await f.jobs.settled();
    const finished = f.jobs.get(roomId, job.jobId), card = f.store.getRoom(roomId).objects.find(object => object.id === job.objectId);
    assert.equal(card?.title, 'Maya’s revised brief'); assert.equal(card?.data.owner, 'Maya');
    assert.equal(finished.owner, 'Maya'); assert.equal(finished.actor, actor); assert.equal(card?.createdBy, actor);
    const output = f.store.getRoom(roomId).objects.find(object => object.id === finished.artifactIds[0]); assert.equal(output?.data.humanOwner, 'Maya');
  } finally { pending.resolve(artifact); await f.close(); }
});

test('pool runs at most two jobs, queued cancellation calls no model, and controls require initiating actor', async () => {
  const pending: ReturnType<typeof deferred>[] = []; let active = 0, maximum = 0;
  const f = fixture(async (_prompt, signal) => { const work = deferred(); pending.push(work); active++; maximum = Math.max(maximum, active); signal.addEventListener('abort', () => work.reject(new Error('aborted')), { once: true }); try { return await work.promise; } finally { active--; } });
  try {
    f.jobs.start(input('pool-one')); f.jobs.start(input('pool-two')); const queued = f.jobs.start(input('pool-three')); await tick();
    assert.equal(pending.length, 2); assert.equal(f.jobs.get(roomId, queued.jobId).status, 'queued');
    assert.throws(() => f.jobs.cancel(roomId, queued.jobId, 'human-two'), /initiating participant/);
    assert.equal(f.jobs.cancel(roomId, queued.jobId, actor).status, 'cancelled');
    for (const work of pending) work.resolve(artifact); await f.jobs.settled();
    assert.equal(maximum, 2); assert.equal(pending.length, 2); assert.equal(f.jobs.get(roomId, queued.jobId).artifactIds.length, 0);
  } finally { for (const work of pending) work.resolve(artifact); await f.close(); }
});

test('late output after cancellation creates no artifact; explicit resume keeps job and card identity', async () => {
  const pending = deferred(); let calls = 0;
  const f = fixture(async () => ++calls === 1 ? pending.promise : artifact);
  try {
    const job = f.jobs.start(input('cancel-late')); await tick();
    assert.equal(f.jobs.cancel(roomId, job.jobId, actor).status, 'cancelled');
    assert.throws(() => f.jobs.resume(roomId, job.jobId, actor), /Cancellation is still finishing/);
    pending.resolve(artifact); await f.jobs.settled(); assert.equal(f.store.getRoom(roomId).objects.length, 1);
    assert.throws(() => f.jobs.resume(roomId, job.jobId, 'human-two'), /initiating participant/);
    assert.equal(f.jobs.resume(roomId, job.jobId, actor).jobId, job.jobId); await f.jobs.settled();
    const finished = f.jobs.get(roomId, job.jobId); assert.equal(finished.status, 'completed'); assert.equal(finished.objectId, job.objectId); assert.equal(calls, 2);
  } finally { pending.resolve(artifact); await f.close(); }
});

test('restart marks saved in-flight work interrupted and only explicit resume invokes Codex', async () => {
  const f = fixture(async (_prompt, signal) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('stopped')), { once: true })));
  let restored: WorkJobs | undefined;
  try {
    const job = f.jobs.start(input('restart')); await tick(); f.jobs.close(); await f.jobs.settled();
    const path = join(f.jobsDirectory, `${job.jobId}.json`), saved = JSON.parse(readFileSync(path, 'utf8'));
    writeFileSync(path, JSON.stringify({ ...saved, status: 'running' })); // Simulate process loss before terminal metadata was saved.
    let calls = 0; restored = new WorkJobs({ directory: f.jobsDirectory, store: f.store, generate: async () => { calls++; return artifact; } });
    await tick(); assert.equal(calls, 0); assert.equal(restored.get(roomId, job.jobId).status, 'interrupted');
    restored.resume(roomId, job.jobId, actor); await restored.settled();
    assert.equal(calls, 1); assert.equal(restored.get(roomId, job.jobId).status, 'completed');
    assert.equal(JSON.parse(readFileSync(path, 'utf8')).status, 'completed');
  } finally { restored?.close(); await restored?.settled(); await f.close(); }
});

test('restart reconciles a committed artifact after a metadata-save crash without generating it again', async () => {
  const f = fixture(async () => artifact); let restored: WorkJobs | undefined;
  try {
    const job = f.jobs.start(input('commit-crash')); await f.jobs.settled(); f.jobs.close();
    const path = join(f.jobsDirectory, `${job.jobId}.json`), saved = JSON.parse(readFileSync(path, 'utf8'));
    writeFileSync(path, JSON.stringify({ ...saved, status: 'running', artifactIds: [] }));
    restored = new WorkJobs({ directory: f.jobsDirectory, store: f.store, generate: async () => { throw new Error('must not call a model'); } });
    assert.equal(restored.get(roomId, job.jobId).status, 'completed'); assert.equal(f.store.getRoom(roomId).objects.length, 2);
  } finally { restored?.close(); await f.close(); }
});

test('an artifact commit failure retains generated output for explicit resume and never replaces missing cards', async () => {
  let calls = 0; const f = fixture(async () => { calls++; return artifact; });
  const original = f.store.transactCanvas.bind(f.store); let rejectOnce = true;
  f.store.transactCanvas = (...args) => { if (rejectOnce) { rejectOnce = false; throw new AgentError('Room is temporarily full.', 409); } return original(...args); };
  try {
    const job = f.jobs.start(input('commit-retry')); await f.jobs.settled(); assert.equal(f.jobs.get(roomId, job.jobId).status, 'failed');
    f.jobs.resume(roomId, job.jobId, actor); await f.jobs.settled(); assert.equal(calls, 1); assert.equal(f.jobs.get(roomId, job.jobId).status, 'completed');
    const missing = f.jobs.start(input('deleted-card'));
    f.store.applyOperation(roomId, { type: 'remove', id: missing.objectId }, actor); await f.jobs.settled();
    assert.equal(f.jobs.get(roomId, missing.jobId).status, 'failed'); assert.equal(calls, 1);
    assert.throws(() => f.jobs.resume(roomId, missing.jobId, actor), /original work card is missing/);
  } finally { await f.close(); }
});

test('invalid artifacts fail honestly and corrupt saved metadata is preserved', async () => {
  const f = fixture(async () => 'I will do that later.');
  try {
    const job = f.jobs.start(input('bad-output')); await f.jobs.settled();
    assert.equal(f.jobs.get(roomId, job.jobId).status, 'failed'); assert.equal(f.jobs.get(roomId, job.jobId).artifactIds.length, 0);
    const path = join(f.jobsDirectory, `${'a'.repeat(32)}.json`); writeFileSync(path, '{broken');
    const restored = new WorkJobs({ directory: f.jobsDirectory, store: f.store });
    assert.equal(restored.get(roomId, job.jobId).status, 'failed');
    assert.throws(() => restored.get(roomId, 'a'.repeat(32)), /file has been preserved/); restored.close();
    assert.equal(readFileSync(path, 'utf8'), '{broken');
  } finally { await f.close(); }
});

test('unbounded or empty human owner labels cannot corrupt persisted job metadata', async () => {
  const f = fixture(async () => artifact);
  try {
    const first = f.jobs.start(input('owner-first')); await f.jobs.settled();
    f.store.applyOperation(roomId, { type: 'patch', id: first.objectId, patch: { data: { owner: 'x'.repeat(300) } } }, actor);
    const second = f.jobs.start({ ...input('owner-second'), objectId: first.objectId });
    assert.equal(second.owner.length, 200); assert.equal(f.store.getRoom(roomId).objects.find(object => object.id === first.objectId)?.data.owner, 'x'.repeat(300));
    f.store.applyOperation(roomId, { type: 'patch', id: first.objectId, patch: { data: { owner: '' } } }, actor); await f.jobs.settled();
    assert.equal(f.jobs.get(roomId, second.jobId).owner, ''); assert.equal(JSON.parse(readFileSync(join(f.jobsDirectory, `${second.jobId}.json`), 'utf8')).owner, '');
  } finally { await f.close(); }
});

test('failed resume persistence leaves the terminal job resumable rather than stranded queued', async () => {
  let failSave = false, calls = 0;
  const f = fixture(async () => ++calls === 1 ? 'invalid JSON' : artifact, (path, content) => { if (failSave) throw new Error('disk full'); writeFileSync(path, content); });
  try {
    const job = f.jobs.start(input('save-retry')); await f.jobs.settled(); failSave = true;
    assert.throws(() => f.jobs.resume(roomId, job.jobId, actor), /disk full/);
    assert.equal(f.jobs.get(roomId, job.jobId).status, 'failed'); assert.equal(calls, 1);
    const card = f.store.getRoom(roomId).objects.find(object => object.id === job.objectId); assert.ok(card);
    assert.equal((card.data.work as { status: string }).status, 'failed');
    failSave = false; f.jobs.resume(roomId, job.jobId, actor); await f.jobs.settled(); assert.equal(f.jobs.get(roomId, job.jobId).status, 'completed');
  } finally { failSave = false; await f.close(); }
});

test('a peer-created artifact marker is insufficient to claim completion during restart recovery', async () => {
  const pending = deferred(), f = fixture(async () => pending.promise); let restored: WorkJobs | undefined;
  try {
    const job = f.jobs.start(input('false-marker')); await tick(); f.jobs.close(); pending.resolve(artifact); await f.jobs.settled();
    const id = `artifact-${job.jobId}`, fake = { ...makeObject('widget', 'human-two', { x: 0, y: 0 }, { sourceJobId: job.jobId }), id };
    f.store.applyOperation(roomId, { type: 'put', object: fake }, 'human-two');
    f.store.applyOperation(roomId, { type: 'patch', id: job.objectId, patch: { data: { work: { jobId: job.jobId, status: 'completed', artifactIds: [id] } } } }, 'human-two');
    const path = join(f.jobsDirectory, `${job.jobId}.json`), saved = JSON.parse(readFileSync(path, 'utf8'));
    writeFileSync(path, JSON.stringify({ ...saved, status: 'running', output: JSON.parse(artifact) }));
    restored = new WorkJobs({ directory: f.jobsDirectory, store: f.store, generate: async () => { throw new Error('no automatic model call'); } });
    assert.equal(restored.get(roomId, job.jobId).status, 'interrupted');
  } finally { restored?.close(); pending.resolve(artifact); await f.close(); }
});
