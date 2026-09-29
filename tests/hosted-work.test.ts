import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { AccessError, RoomAccess } from '../server/access/store';
import { createRoomAuthorization, roomAuthorization, withRoomAuthorization } from '../server/access/context';
import { installNativeAccessGuard } from '../server/access/native-guard';
import { WorkJobs } from '../server/agents/work-jobs';
import type { WorkspaceRunInput, WorkspaceRunner } from '../server/agents/workspace-work';
import { RoomStore } from '../server/room-store';

const output = JSON.stringify({ title: 'Verified brief', format: 'markdown', body: '# Brief\n\nThe agreed next action belongs to Maya.' });
const result = () => ({ output, execution: { boundary: 'local-workspace' as const, continued: false, commands: [], files: [] } });
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
function fixture(run: WorkspaceRunner) {
  const directory = mkdtempSync(join(tmpdir(), 'present-hosted-work-'));
  let now = Date.now();
  const access = new RoomAccess({ directory: join(directory, 'access'), secret: randomBytes(32).toString('hex'), now: () => now });
  const owner = access.createSession(), editor = access.createSession(), stranger = access.createSession();
  const { roomId } = access.createRoom(owner.token);
  const invite = access.invite(owner.token, roomId, { role: 'editor', ttlMs: 60000, maxUses: 1 });
  access.join(editor.token, invite.token);
  const ownerScope = createRoomAuthorization(access, owner.token, roomId), editorScope = createRoomAuthorization(access, editor.token, roomId);
  const restore = installNativeAccessGuard();
  const store = new RoomStore({ directory: join(directory, 'rooms'), legacyDirectory: join(directory, 'legacy') });
  const jobsDirectory = join(directory, 'jobs'), jobs = new WorkJobs({ directory: jobsDirectory, store, run });
  const asOwner = <T>(fn: () => T) => withRoomAuthorization(ownerScope, fn);
  const asEditor = <T>(fn: () => T) => withRoomAuthorization(editorScope, fn);
  const input = (requestId: string, actor = owner.userId) => ({ roomId, actor, requestId, title: 'Meeting follow-up', prompt: 'Prepare the agreed follow-up.' });
  const saved = (jobId: string) => JSON.parse(readFileSync(join(jobsDirectory, `${jobId}.json`), 'utf8'));
  return { access, owner, editor, stranger, roomId, jobs, jobsDirectory, store, asOwner, asEditor, input, saved,
    expire: () => { now = owner.expiresAt + 1; },
    revoke: () => access.revokeMember(owner.token, roomId, editor.userId),
    close: async () => { jobs.close(); await jobs.settled(); restore(); store.close(); access.close(); rmSync(directory, { recursive: true, force: true }); } };
}

test('each queued job restores its own initiating scope when another actor drains the pool', async () => {
  const gate = deferred(), observed: string[] = [];
  const f = fixture(async () => { observed.push(roomAuthorization()!.userId); if (observed.length <= 2) await gate.promise; return result(); });
  try {
    f.asOwner(() => f.jobs.start(f.input('one')));
    f.asOwner(() => f.jobs.start(f.input('two')));
    const queued = f.asEditor(() => f.jobs.start(f.input('three', f.editor.userId)));
    await tick(); assert.equal(observed.length, 2); gate.resolve(); await f.jobs.settled();
    assert.deepEqual(observed, [f.owner.userId, f.owner.userId, f.editor.userId]);
    assert.equal(f.asEditor(() => f.jobs.get(f.roomId, queued.jobId)).status, 'completed');
  } finally { gate.resolve(); await f.close(); }
});

test('revoked queued work never reaches its provider and cannot replace captured authority through replay', async () => {
  const gate = deferred(); let calls = 0;
  const f = fixture(async () => { calls++; await gate.promise; return result(); });
  try {
    f.asOwner(() => f.jobs.start(f.input('one'))); f.asOwner(() => f.jobs.start(f.input('two')));
    const input = f.input('revoked', f.editor.userId), job = f.asEditor(() => f.jobs.start(input));
    await tick(); f.revoke();
    assert.throws(() => f.asOwner(() => f.jobs.start(input)), /identity/);
    gate.resolve(); await f.jobs.settled();
    assert.equal(calls, 2); assert.equal(f.saved(job.jobId).status, 'interrupted');
    assert.equal(f.saved(job.jobId).output, undefined);
    assert.throws(() => f.asEditor(() => f.jobs.get(f.roomId, job.jobId)), AccessError);
    assert.equal(f.asOwner(() => f.store.getRoom(f.roomId)).objects.filter(o => o.data.sourceJobId === job.jobId).length, 0);
  } finally { gate.resolve(); await f.close(); }
});

test('revocation aborts in-flight work and rejects late checkpoints and output from an unrelated event scope', async () => {
  const gate = deferred(); let captured!: WorkspaceRunInput, signal!: AbortSignal;
  const f = fixture(async (input, abortSignal) => { captured = input; signal = abortSignal; await gate.promise; return result(); });
  try {
    const job = f.asEditor(() => f.jobs.start(f.input('inflight', f.editor.userId))); await tick();
    // A legitimate callback can be delivered under the owner's shared transport context.
    f.asOwner(() => captured.onCheckpoint({ ...captured.state, threadId: 'saved-thread' }));
    f.revoke(); assert.equal(signal.aborted, true);
    assert.throws(() => f.asOwner(() => captured.onCheckpoint({ ...captured.state, threadId: 'unauthorized-late' })), AccessError);
    gate.resolve(); await f.jobs.settled();
    const saved = f.saved(job.jobId);
    assert.equal(saved.status, 'interrupted'); assert.equal(saved.executionState.threadId, 'saved-thread'); assert.equal(saved.output, undefined);
    assert.match(saved.error, /authorization ended/);
    assert.equal(f.asOwner(() => f.store.getRoom(f.roomId)).objects.length, 1);
    const publicJob = f.asOwner(() => f.jobs.get(f.roomId, job.jobId));
    assert.equal('executionState' in publicJob, false); assert.equal('commitToken' in publicJob, false);
  } finally { gate.resolve(); await f.close(); }
});

test('session expiry is rechecked after provider await even before the expiry timer fires', async () => {
  const gate = deferred(); const f = fixture(async () => { await gate.promise; return result(); });
  try {
    const job = f.asOwner(() => f.jobs.start(f.input('expired'))); await tick(); f.expire(); gate.resolve(); await f.jobs.settled();
    assert.equal(f.saved(job.jobId).status, 'interrupted'); assert.equal(f.saved(job.jobId).output, undefined);
  } finally { gate.resolve(); await f.close(); }
});

test('authorization precedes private saved-file reads and actor controls', async () => {
  const f = fixture(async () => result());
  try {
    const id = 'a'.repeat(32); writeFileSync(join(f.jobsDirectory, `${id}.json`), 'private corrupt metadata');
    assert.throws(() => f.jobs.get(f.roomId, id), AccessError);
    assert.throws(() => f.jobs.resume(f.roomId, id, f.owner.userId), AccessError);
    assert.throws(() => f.jobs.cancel(f.roomId, id, f.owner.userId), AccessError);
    assert.throws(() => f.jobs.start(f.input('unsigned')), AccessError);
    assert.throws(() => f.asEditor(() => f.jobs.start(f.input('spoofed'))), /identity/);
    assert.throws(() => f.asOwner(() => f.jobs.get(f.roomId, id)), /preserved/);
  } finally { await f.close(); }
});

test('hosted restart never reads private rooms or replays providers until signed explicit resume', async () => {
  const gate = deferred(); let calls = 0;
  const f = fixture(async () => { calls++; await gate.promise; return result(); });
  let restarted: WorkJobs | undefined;
  try {
    const job = f.asOwner(() => f.jobs.start(f.input('restart'))); await tick();
    f.jobs.close(); gate.resolve(); await f.jobs.settled();
    writeFileSync(join(f.jobsDirectory, `${job.jobId}.json`), JSON.stringify({ ...f.saved(job.jobId), status: 'running' }));
    restarted = new WorkJobs({ directory: f.jobsDirectory, store: f.store, run: async () => { calls++; return result(); } });
    await tick(); assert.equal(calls, 1); assert.equal(f.saved(job.jobId).status, 'interrupted');
    assert.throws(() => restarted!.resume(f.roomId, job.jobId, f.owner.userId), AccessError);
    f.asOwner(() => restarted!.resume(f.roomId, job.jobId, f.owner.userId)); await restarted.settled();
    assert.equal(calls, 2); assert.equal(f.asOwner(() => restarted!.get(f.roomId, job.jobId)).status, 'completed');
  } finally { restarted?.close(); await restarted?.settled(); gate.resolve(); await f.close(); }
});
