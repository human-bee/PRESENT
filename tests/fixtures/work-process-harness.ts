import assert from 'node:assert/strict';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import type { StoredWorkJob, WorkJob } from '../../shared/work';
import type { RoomObject } from '../../shared/room';

type Identity = { cookie: string; userId: string };
export const stateOf = (job: StoredWorkJob) => { assert.ok(job.executionState); return job.executionState; };
type Event = { pid: number; method: string; threadId?: string; dispatchId?: string; cwd?: string; model?: string };
export async function until<T>(read: () => T | Promise<T>, accept: (value: T) => boolean, label: string): Promise<T> {
  for (let i = 0; i < 200; i++) { const value = await read(); if (accept(value)) return value; await pause(25); }
  throw new Error(`Timed out: ${label}`);
}
export async function fixture(port: number) {
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
  const start = async (crashBeforeReceipt = false) => {
    output = '';
    child = spawn(process.execPath, ['--import', 'tsx', ...(crashBeforeReceipt ? ['--import', resolve('tests/fixtures/work-completion-crash.mjs')] : []), 'server/index.ts'], { stdio: ['ignore', 'pipe', 'pipe'], env: {
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
  return { root, origin, owner, editor, stranger, roomId, call, start, stop, saved, events, objects, close, admit, startJob, get, resume, revoke, release };
  } catch (error) { await close(); throw error; }
}

