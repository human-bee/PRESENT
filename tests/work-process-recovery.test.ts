import assert from 'node:assert/strict';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import test from 'node:test';
import type { StoredWorkJob, WorkJob } from '../shared/work';
import { agentModels } from '../shared/agent-models';
import type { RoomObject } from '../shared/room';

type Identity = { cookie: string; userId: string };
const stateOf = (job: StoredWorkJob) => { assert.ok(job.executionState); return job.executionState; };
type Event = { pid: number; method: string; threadId?: string; dispatchId?: string; cwd?: string; model?: string };
async function until<T>(read: () => T | Promise<T>, accept: (value: T) => boolean, label: string): Promise<T> {
  for (let i = 0; i < 200; i++) { const value = await read(); if (accept(value)) return value; await pause(25); }
  throw new Error(`Timed out: ${label}`);
}
async function fixture(port: number) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'present-work-process-'))), origin = `http://127.0.0.1:${port}`;
  const fakeHome = join(root, 'controlled-codex'), secret = randomBytes(32).toString('hex');
  mkdirSync(fakeHome); writeFileSync(join(fakeHome, 'CONTROLLED_TEST_ONLY'), 'controlled fixture, no real provider\n');
  writeFileSync(join(fakeHome, 'auth.json'), JSON.stringify({ auth_mode: 'chatgpt' }));
  const source = join(root, 'project');
  execFileSync('git', ['init', '--quiet', source]); writeFileSync(join(source, 'source.txt'), 'Committed controlled source.\n');
  execFileSync('git', ['-C', source, 'add', 'source.txt']);
  execFileSync('git', ['-C', source, '-c', 'user.name=Test', '-c', 'user.email=test@example.test', 'commit', '--quiet', '-m', 'Controlled source']);
  writeFileSync(join(root, 'projects.json'), JSON.stringify({ projects: [{ id: 'controlled', name: 'Controlled project', directory: source }] }));
  let child: ChildProcess | undefined, output = '';
  const evidence = process.env.PRESENT_RECOVERY_EVIDENCE_DIRECTORY;
  if (evidence) mkdirSync(evidence, { recursive: true });
  const start = async () => {
    output = '';
    child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], { stdio: ['ignore', 'pipe', 'pipe'], env: {
      ...process.env, NODE_ENV: 'production', PRESENT_HOST: '127.0.0.1', PRESENT_PORT: String(port),
      PRESENT_ACCESS_MODE: 'invite', PRESENT_ACCESS_ORIGIN: origin, PRESENT_ACCESS_SECRET: secret,
      PRESENT_ACCESS_DIRECTORY: join(root, 'access'), PRESENT_DATA_DIRECTORY: root, PRESENT_ENV_FILE: join(root, 'absent.env'),
      CODEX_HOME: fakeHome, CODEX_CLI_PATH: resolve('tests/fixtures/controlled-work-codex.mjs'),
      OPENAI_API_KEY: '', CEREBRAS_API_KEY: '', TYPESAFE_API_KEY: '', TYPSESAFE_AI_API: '',
      LIVEKIT_URL: '', NEXT_PUBLIC_LIVEKIT_URL: '', LIVEKIT_API_KEY: '', LIVEKIT_API_SECRET: '', LINEAR_API_KEY: '', YOUTUBE_API_KEY: '',
    } });
    const capture = (bytes: Buffer) => { output = (output + String(bytes)).slice(-8000); if (evidence) appendFileSync(join(evidence, `server-${port}.log`), bytes); };
    child.stdout?.on('data', capture); child.stderr?.on('data', capture);
    await until(async () => {
      if (child?.exitCode !== null) throw new Error(`Server exited: ${output}`);
      if (!output.includes(`PRESENT is ready at ${origin}`)) return false;
      try { return (await fetch(`${origin}/healthz`, { signal: AbortSignal.timeout(300) })).ok; } catch { return false; }
    }, ready => ready, 'server listen');
  };
  const stop = async (signal: NodeJS.Signals) => {
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    const exited = once(child, 'exit', { signal: AbortSignal.timeout(7000) }); child.kill(signal); await exited;
  };
  const call = (who: Identity | undefined, path: string, method = 'GET', body?: unknown) => fetch(`${origin}${path}`, {
    method, headers: { origin, cookie: who?.cookie ?? '', 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(5000),
  });
  const session = async (): Promise<Identity> => {
    const response = await call(undefined, '/api/access/session', 'POST'); assert.equal(response.status, 201);
    const { userId } = await response.json(), cookie = response.headers.get('set-cookie'); assert.ok(cookie);
    return { userId, cookie: cookie.split(';')[0] };
  };
  const saved = (jobId: string): StoredWorkJob => JSON.parse(readFileSync(join(root, 'work-jobs', `${jobId}.json`), 'utf8'));
  const events = (): Event[] => existsSync(join(fakeHome, 'events.jsonl')) ? readFileSync(join(fakeHome, 'events.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];
  const objects = async (who: Identity, roomId: string): Promise<RoomObject[]> => (await (await call(who, `/api/room/${roomId}`)).json()).room.objects;
  const close = async () => {
    await stop('SIGKILL');
    // Every controlled worker is owned by this disposable fixture. Kill any
    // detached child left by abrupt server death before removing its state.
    for (const pid of new Set(events().filter(event => event.method === 'process-start').map(event => event.pid))) {
      try { process.kill(pid, 'SIGKILL'); } catch { /* Already stopped. */ }
    }
    if (evidence) writeFileSync(join(evidence, `executor-${port}.jsonl`), events().map(event => JSON.stringify(event)).join('\n'));
    rmSync(root, { recursive: true, force: true });
  };
  try {
  await start();
  const owner = await session(), editor = await session(), stranger = await session();
  const { roomId } = await (await call(owner, '/api/access/rooms', 'POST')).json();
  const admit = async () => {
    const invite = await (await call(owner, `/api/access/rooms/${roomId}/invites`, 'POST', { role: 'editor', ttlMs: 60000, maxUses: 1 })).json();
    assert.equal((await call(editor, '/api/access/join', 'POST', { token: invite.token })).status, 200);
  };
  await admit();
  const startJob = async (who: Identity, requestId: string, projectId?: string): Promise<WorkJob> => {
    const response = await call(who, '/api/work/start', 'POST', { roomId, actor: who.userId, requestId, title: 'Controlled recovery', prompt: 'Produce the controlled recovery receipt.', ...(projectId ? { projectId } : {}) });
    assert.equal(response.status, 202, await response.clone().text()); return response.json();
  };
  const get = async (jobId: string): Promise<WorkJob> => {
    const response = await call(owner, `/api/work/${jobId}?roomId=${roomId}`); assert.equal(response.status, 200); return response.json();
  };
  const resume = (who: Identity, jobId: string, actor = who.userId, scopeRoomId = roomId) => call(who, '/api/work/resume', 'POST', { roomId: scopeRoomId, jobId, actor });
  const revoke = () => call(owner, `/api/access/rooms/${roomId}/members/${editor.userId}`, 'DELETE');
  const release = (jobId: string) => { const state = stateOf(saved(jobId)); assert.ok(state.turnId); writeFileSync(join(fakeHome, `${state.turnId}.release`), 'release controlled result\n'); };
  return { root, owner, editor, stranger, roomId, call, start, stop, saved, events, objects, close, admit, startJob, get, resume, revoke, release };
  } catch (error) { await close(); throw error; }
}

for (const [index, signal] of (['SIGKILL', 'SIGTERM'] as const).entries()) {
  test(`real signed HTTP queued and in-flight work survives ${signal} only through explicit same-actor resume`, { timeout: 45000 }, async () => {
    const f = await fixture(4450 + index);
    try {
      const active = await f.startJob(f.owner, 'owner-running', 'controlled');
      const revoked = await f.startJob(f.editor, 'editor-running', 'controlled');
      await until(() => f.saved(active.jobId), job => job.executionState?.phase === 'running', 'durable turn checkpoint');
      const queued = await f.startJob(f.owner, 'owner-queued', 'controlled');
      assert.equal(f.saved(queued.jobId).status, 'queued');
      const before = f.saved(active.jobId), queueBefore = f.saved(queued.jobId), oldPids = f.events().filter(event => event.method === 'process-start').map(event => event.pid);
      assert.equal(stateOf(before).model, agentModels[before.provider], 'durable model affinity is known');
      await until(() => { try { return readFileSync(join(f.root, 'tldraw', `${f.roomId}.json`), 'utf8'); } catch { return ''; } }, text => text.includes(queued.objectId), 'native card checkpoint before crash');
      assert.equal(f.events().filter(event => event.method === 'turn/start').length, 2);
      await f.stop(signal); await f.start();
      // The first signed read constructs the normal work service and recovers
      // private jobs. No authority is restored from disk and no worker starts.
      for (const job of [active, revoked, queued]) assert.equal((await f.get(job.jobId)).status, 'interrupted');
      await pause(100);
      assert.equal(f.events().filter(event => event.method === 'process-start').length, 2, 'restart does not spawn executors');
      assert.equal((await f.call(undefined, `/api/work/${active.jobId}?roomId=${f.roomId}`)).status, 401);
      assert.equal((await f.call(f.stranger, `/api/work/${active.jobId}?roomId=${f.roomId}`)).status, 403);
      assert.equal((await f.resume(f.owner, revoked.jobId)).status, 403, 'owner cannot take over initiating identity');
      assert.equal((await f.resume(f.owner, revoked.jobId, f.editor.userId)).status, 403, 'signed actor cannot be spoofed');
      const other = await (await f.call(f.owner, '/api/access/rooms', 'POST')).json();
      assert.equal((await f.resume(f.owner, active.jobId, f.owner.userId, other.roomId)).status, 404, 'job cannot move rooms');
      assert.equal((await f.revoke()).status, 200);
      assert.equal((await f.resume(f.editor, revoked.jobId)).status, 403, 'revocation is current after restart');
      f.release(revoked.jobId); await pause(100);
      assert.equal((await f.objects(f.owner, f.roomId)).filter(object => object.data.sourceJobId === revoked.jobId).length, 0, 'old process release cannot publish');
      await until(() => oldPids.every(pid => { try { process.kill(pid, 0); return false; } catch { return true; } }), stopped => stopped, 'old executor shutdown');
      f.release(active.jobId);
      assert.equal((await f.resume(f.owner, active.jobId)).status, 202);
      const finished = await until(() => f.get(active.jobId), job => job.status === 'completed', 'authorized recovered turn completion');
      const after = f.saved(active.jobId);
      assert.equal(after.actor, before.actor); assert.equal(after.roomId, before.roomId); assert.equal(after.objectId, before.objectId);
      assert.deepEqual(after.project, before.project);
      for (const key of ['workspaceId', 'threadId', 'turnId', 'dispatchId', 'model'] as const) assert.equal(stateOf(after)[key], stateOf(before)[key]);
      assert.equal(f.events().filter(event => event.method === 'turn/start').length, 2, 'resume reconciles exact turn without duplicate dispatch');
      assert.equal(finished.execution?.commands[0].exitCode, 0);
      const receiptFile = finished.execution?.files.find(file => file.path === 'receipt.txt');
      assert.ok(receiptFile);
      const receiptBytes = readFileSync(join(f.root, 'work-jobs', 'workspaces', stateOf(after).workspaceId, 'files', 'receipt.txt'));
      assert.equal(receiptFile.sha256, createHash('sha256').update(receiptBytes).digest('hex'));
      assert.equal(receiptBytes.toString('utf8').trim(), stateOf(before).dispatchId);
      assert.equal(readFileSync(join(f.root, 'project', 'source.txt'), 'utf8'), 'Committed controlled source.\n');
      assert.equal('executionState' in finished, false); assert.equal('commitToken' in finished, false);
      assert.equal((await f.resume(f.owner, queued.jobId)).status, 202);
      await until(() => f.saved(queued.jobId), job => job.executionState?.phase === 'running', 'explicit queue dispatch');
      assert.equal(f.saved(queued.jobId).actor, queueBefore.actor); assert.deepEqual(f.saved(queued.jobId).project, queueBefore.project);
      assert.equal(stateOf(f.saved(queued.jobId)).workspaceId, stateOf(queueBefore).workspaceId);
      f.release(queued.jobId); await until(() => f.get(queued.jobId), job => job.status === 'completed', 'explicit queued completion');
      assert.equal(f.events().filter(event => event.method === 'turn/start').length, 3, 'only previously queued job gets its first dispatch');
      for (const job of [active, queued]) {
        const artifact = (await f.objects(f.owner, f.roomId)).find(object => object.data.sourceJobId === job.jobId);
        assert.ok(artifact); assert.equal(artifact.data.commitToken, f.saved(job.jobId).commitToken);
        assert.ok(readFileSync(join(f.root, 'tldraw', `${f.roomId}.json`), 'utf8').includes(artifact.id), 'terminal receipt follows canonical disk flush');
      }
      await f.stop('SIGTERM'); await f.start();
      for (const job of [active, queued]) assert.equal((await f.get(job.jobId)).status, 'completed');
      assert.equal((await f.objects(f.owner, f.roomId)).filter(object => [active.jobId, queued.jobId].includes(String(object.data.sourceJobId))).length, 2);
      assert.equal((await f.resume(f.editor, revoked.jobId)).status, 403, 'revocation remains durable after second restart');
      assert.equal(f.saved(revoked.jobId).output, undefined);
    } finally { await f.close(); }
  });
}

test('real signed HTTP revocation rejects active late executor output and never dispatches revoked queued work', { timeout: 30000 }, async () => {
  const f = await fixture(4452);
  try {
    const ownerJob = await f.startJob(f.owner, 'owner-blocker'), active = await f.startJob(f.editor, 'revoked-active');
    await until(() => f.saved(active.jobId), job => job.executionState?.phase === 'running', 'active checkpoint');
    const queued = await f.startJob(f.editor, 'revoked-queued');
    assert.equal((await f.revoke()).status, 200);
    await until(() => f.events(), events => events.some(event => event.method === 'late-output'), 'actual adversarial late event');
    await until(() => f.saved(active.jobId), job => job.status === 'interrupted', 'revoked active terminal receipt');
    f.release(ownerJob.jobId); await until(() => f.get(ownerJob.jobId), job => job.status === 'completed', 'unrelated authorized pool drain');
    await until(() => f.saved(queued.jobId), job => job.status === 'interrupted', 'revoked queue terminal receipt');
    assert.equal(f.events().filter(event => event.method === 'turn/start').length, 2);
    for (const job of [active, queued]) {
      assert.equal(f.saved(job.jobId).output, undefined);
      assert.equal((await f.objects(f.owner, f.roomId)).some(object => object.data.sourceJobId === job.jobId), false);
      assert.equal((await f.resume(f.editor, job.jobId)).status, 403);
      assert.equal((await f.resume(f.owner, job.jobId)).status, 403);
    }
  } finally { await f.close(); }
});
