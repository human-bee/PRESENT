import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import test from 'node:test';
import { agentModels } from '../shared/agent-models';
import { fixture, stateOf, until } from './fixtures/work-process-harness';

test('SIGKILL after canonical artifact flush recovers the signed completed receipt without another turn', { timeout: 30000 }, async () => {
  const f = await fixture(4453);
  try {
    await f.stop('SIGTERM'); await f.start(true);
    const job = await f.startJob(f.owner, 'flushed-before-receipt', 'controlled');
    await until(() => f.saved(job.jobId), value => value.executionState?.phase === 'running', 'controlled turn checkpoint');
    f.release(job.jobId);
    await until(() => existsSync(join(f.root, 'completion-crash.json')), Boolean, 'actual completion-window SIGKILL');
    const marker = JSON.parse(readFileSync(join(f.root, 'completion-crash.json'), 'utf8'));
    assert.equal(marker.jobId, job.jobId);
    await until(() => { try { process.kill(marker.pid, 0); return false; } catch { return true; } }, Boolean, 'server killed before receipt rename');
    const before = f.saved(job.jobId);
    assert.equal(before.status, 'running'); assert.ok(before.output); assert.deepEqual(before.artifactIds, []);
    const durableCanonical = readFileSync(join(f.root, 'tldraw', `${f.roomId}.json`), 'utf8');
    assert.ok(durableCanonical.includes(`artifact-${job.jobId}`));
    await f.start();
    assert.equal((await f.resume(f.editor, job.jobId)).status, 403);
    assert.equal((await f.resume(f.owner, job.jobId)).status, 202);
    const recovered = await f.get(job.jobId);
    assert.equal(recovered.status, 'completed');
    assert.deepEqual(f.saved(job.jobId).executionState, before.executionState);
    assert.equal(f.events().filter(event => event.method === 'turn/start').length, 1);
    assert.equal(f.events().filter(event => event.method === 'process-start').length, 1);
    const card = (await f.objects(f.owner, f.roomId)).find(object => object.id === job.objectId)!;
    assert.equal((card.data.work as { status: string }).status, 'completed');
    assert.deepEqual(recovered.artifactIds, [`artifact-${job.jobId}`]);
    assert.equal(readFileSync(join(f.root, 'tldraw', `${f.roomId}.json`), 'utf8'), durableCanonical, 'recovery preserves the canonical completed transaction exactly');
  } finally { await f.close(); }
});

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
