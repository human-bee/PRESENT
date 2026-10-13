import { Readable } from 'node:stream';
import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { prepareAccessDispatch, dispatchAuthorized } from '../server/access/dispatch';
import { handleProjectRequest } from '../server/projects/routes';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, unlinkSync, realpathSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { ProjectRegistry } from '../server/projects/registry';
import { ProjectChanges } from '../server/projects/apply';
import { inspectProjectWorkspace, prepareProjectWorkspace, projectFiles } from '../server/projects/workspace';
import { WorkJobs } from '../server/agents/work-jobs';
import { RoomStore } from '../server/room-store';
import { RoomAccess } from '../server/access/store';
import { createRoomAuthorization, enforceRoomAuthorization, withRoomAuthorization } from '../server/access/context';
import { installNativeAccessGuard } from '../server/access/native-guard';
const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-C', cwd, ...args], { stdio: 'ignore' });
async function fixture(run: (f: Awaited<ReturnType<typeof create>>) => Promise<void>, initialOutput?: string) { const f = await create(initialOutput); try { await run(f); } finally { f.jobs.close(); await f.jobs.settled(); f.restore(); enforceRoomAuthorization(false); f.store.close(); f.access.close(); rmSync(f.root, { recursive: true, force: true }); } }
async function create(initialOutput?: string) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'present-apply-'))), source = join(root, 'source'), jobsDirectory = join(root, 'jobs'), config = join(root, 'projects.json');
  execFileSync('git', ['init', '--quiet', source]); writeFileSync(join(source, 'app.ts'), 'export const answer = 42;\n'); git(source, 'add', '--all'); git(source, '-c', 'user.name=test', '-c', 'user.email=test@example.test', 'commit', '--quiet', '-m', 'source');
  writeFileSync(config, JSON.stringify({ projects: [{ id: 'demo', name: 'Existing source', directory: source, include: ['app.ts'] }] }));
  const registry = new ProjectRegistry(config), access = new RoomAccess({ directory: join(root, 'access'), secret: randomBytes(32).toString('hex') }), owner = access.createSession(), { roomId } = access.createRoom(owner.token), scope = createRoomAuthorization(access, owner.token, roomId);
  const store = new RoomStore({ directory: join(root, 'rooms'), legacyDirectory: join(root, 'legacy') }); enforceRoomAuthorization(true); const restore = installNativeAccessGuard();
  let output = initialOutput ?? 'export const answer = 43;\n', cwd = '';
  const jobs = new WorkJobs({ directory: jobsDirectory, store, projects: registry, run: async input => { cwd = join(jobsDirectory, 'workspaces', input.state.workspaceId, 'files'); mkdirSync(cwd, { recursive: true }); prepareProjectWorkspace(cwd, input.project!, registry); writeFileSync(join(cwd, 'app.ts'), output); return { output: JSON.stringify({ title: 'Source change', format: 'markdown', body: 'Changed actual isolated source.' }), execution: { boundary: 'local-workspace', continued: input.state.threadId !== null, commands: [], files: projectFiles(cwd), project: inspectProjectWorkspace(cwd, input.project!) } }; } });
  const asOwner = <T>(fn: () => T) => withRoomAuthorization(scope, fn);
  const first = asOwner(() => jobs.start({ roomId, actor: owner.userId, requestId: 'first', prompt: 'Change the existing source.', projectId: 'demo', provider: 'sol' })); await jobs.settled();
  const changes = new ProjectChanges({ jobsDirectory, registry, store, receiptDirectory: join(root, 'applies') });
  const input = { roomId, actor: owner.userId, jobId: first.jobId };
  return { root, source, registry, jobs, changes, store, access, owner, scope, restore, first, input, asOwner, get cwd() { return cwd; }, next: async () => { output = 'export const answer = 44;\n'; const next = asOwner(() => jobs.start({ roomId: input.roomId, actor: input.actor, objectId: first.objectId, requestId: 'next', prompt: 'Follow up on the source.', projectId: 'demo', provider: 'sol' })); await jobs.settled(); return { ...input, jobId: next.jobId }; } };
}
test('signed exact reviewed apply preserves original until approval, replays without writes, and supports a same-card follow-up', async () => fixture(async f => {
  const review = f.asOwner(() => f.changes.review(f.input)); assert.equal(review.canApply, true); assert.match(review.diff, /\+export const answer = 43/); assert.equal(readFileSync(join(f.source, 'app.ts'), 'utf8'), 'export const answer = 42;\n');
  const approved = { ...f.input, snapshotId: review.project.snapshotId, changeId: review.changeId };
  assert.equal(f.asOwner(() => f.changes.apply(approved)).applied, true); assert.equal(readFileSync(join(f.source, 'app.ts'), 'utf8'), 'export const answer = 43;\n'); assert.equal(f.asOwner(() => f.changes.apply(approved)).applied, true);
  const next = await f.next(), follow = f.asOwner(() => f.changes.review(next)); assert.equal(follow.canApply, true); f.asOwner(() => f.changes.apply({ ...next, snapshotId: follow.project.snapshotId, changeId: follow.changeId })); assert.equal(readFileSync(join(f.source, 'app.ts'), 'utf8'), 'export const answer = 44;\n');
}));
test('source edits, index divergence and wrong exact approval fail before source writes', async () => fixture(async f => {
  const review = f.asOwner(() => f.changes.review(f.input)), approved = { ...f.input, snapshotId: review.project.snapshotId, changeId: review.changeId };
  assert.throws(() => f.asOwner(() => f.changes.apply({ ...approved, changeId: '0'.repeat(64) })), /exact reviewed/);
  writeFileSync(join(f.source, 'app.ts'), 'Human edit preserved.\n'); assert.equal(f.asOwner(() => f.changes.review(f.input)).canApply, false); assert.throws(() => f.asOwner(() => f.changes.apply(approved)), /diverged/); assert.equal(readFileSync(join(f.source, 'app.ts'), 'utf8'), 'Human edit preserved.\n');
  git(f.source, 'add', 'app.ts'); assert.throws(() => f.asOwner(() => f.changes.apply(approved)), /index diverged/);
}));
test('missing current authority, actor mismatch and changed completed workspace cannot approve', async () => fixture(async f => {
  assert.throws(() => f.changes.review(f.input), /authorization/); assert.throws(() => f.asOwner(() => f.changes.review({ ...f.input, actor: 'other' })), /identity/);
  writeFileSync(join(f.cwd, 'app.ts'), 'Unreviewed post-completion edit.\n'); assert.throws(() => f.asOwner(() => f.changes.review(f.input)), /changed after completion/);
}));
test('modified Git config and historical unknown baseline fail before any filter execution', async () => fixture(async f => {
  writeFileSync(join(f.cwd, '.git', 'config'), '[filter "unsafe"]\n clean = touch /tmp/present-should-not-run\n'); assert.throws(() => inspectProjectWorkspace(f.cwd, f.registry.snapshot('demo')), /baseline changed/);
  unlinkSync(f.cwd + '.project-baseline.json'); assert.throws(() => inspectProjectWorkspace(f.cwd, f.registry.snapshot('demo')), /cannot be verified/);
}));

test('truncated and binary diffs are never applied', async () => {
  await fixture(async f => { writeFileSync(join(f.cwd, 'app.ts'), 'x'.repeat(60000) + '\n'); const path = join(f.root, 'jobs', f.first.jobId + '.json'), saved = JSON.parse(readFileSync(path, 'utf8')); saved.execution.project = inspectProjectWorkspace(f.cwd, f.registry.snapshot('demo')); saved.execution.files = projectFiles(f.cwd); writeFileSync(path, JSON.stringify(saved)); const review = f.asOwner(() => f.changes.review(f.input)); assert.equal(review.diffTruncated, true); assert.equal(review.canApply, false); assert.match(review.blockedReason!, /truncated/); assert.equal(readFileSync(join(f.source, 'app.ts'), 'utf8'), 'export const answer = 42;\n'); });
  await fixture(async f => { writeFileSync(join(f.cwd, 'app.ts'), 'binary\0content'); assert.throws(() => f.asOwner(() => f.changes.review(f.input)), /Binary/); });
});
test('an apply requires a server-issued exact review, and late human edits are preserved with an interrupted receipt', async () => fixture(async f => {
  const review = f.asOwner(() => f.changes.review(f.input)), approved = { ...f.input, snapshotId: review.project.snapshotId, changeId: review.changeId }, directory = join(f.root, 'applies');
  for (const name of readdirSync(directory).filter(name => name.startsWith('review-'))) unlinkSync(join(directory, name));
  assert.throws(() => f.asOwner(() => f.changes.apply(approved)), /Review this exact/); f.asOwner(() => f.changes.review(f.input));
  const original = f.scope.check; let edited = false;
  f.scope.check = permission => { const grant = original(permission); if (!edited && readdirSync(directory).filter(name => name.endsWith('.json')).some(name => JSON.parse(readFileSync(join(directory, name), 'utf8')).status === 'applying')) { edited = true; writeFileSync(join(f.source, 'app.ts'), 'Late human edit.\n'); } return grant; };
  assert.throws(() => f.asOwner(() => f.changes.apply(approved)), /Source changed during apply/); assert.equal(readFileSync(join(f.source, 'app.ts'), 'utf8'), 'Late human edit.\n');
  assert.equal(f.asOwner(() => f.changes.review(f.input)).canApply, false);
}));

test('real signed project routes bind current actor, deny other members and reject a revoked apply', async () => fixture(async f => {
  class Response extends EventEmitter { status = 0; body: any; destroyed = false; writableEnded = false; writeHead(status: number) { this.status = status; return this; } end(value: string) { this.body = JSON.parse(value); this.writableEnded = true; } destroy() { this.destroyed = true; return this; } }
  const call = async (path: string, body: object, token = f.owner.token) => {
    const request = Readable.from([Buffer.from(JSON.stringify(body))]) as unknown as IncomingMessage;
    Object.assign(request, { method: 'POST', url: path, headers: { 'content-type': 'application/json', cookie: 'present_session=' + token }, socket: {} });
    const prepared = await prepareAccessDispatch(f.access, request), response = new Response();
    await dispatchAuthorized(prepared, response as unknown as ServerResponse, request => handleProjectRequest(request, response as unknown as ServerResponse, f.registry, f.changes)); return response;
  };
  const response = await call('/api/projects/review', { ...f.input, actor: 'forged' }); assert.equal(response.status, 200); assert.equal(response.body.review.canApply, true);
  const editor = f.access.createSession(), invitation = f.access.invite(f.owner.token, f.input.roomId, { role: 'editor', ttlMs: 60000, maxUses: 1 }); f.access.join(editor.token, invitation.token);
  assert.equal((await call('/api/projects/review', f.input, editor.token)).status, 403);
  const approved = { ...f.input, snapshotId: response.body.review.project.snapshotId, changeId: response.body.review.changeId };
  f.access.revokeSession(f.owner.token); await assert.rejects(call('/api/projects/apply', approved), /session/i); assert.equal(readFileSync(join(f.source, 'app.ts'), 'utf8'), 'export const answer = 42;\n');
}));
