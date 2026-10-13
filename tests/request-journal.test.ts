import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { RequestJournal, RequestRecoveryError } from '../server/agents/request-journal';

const identity = { roomId: 'a'.repeat(32), actor: 'participant-a', requestId: 'request-1' };

test('recovery reads only existing results and never creates a receipt or waits for dispatch', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'present-recovery-'));
  try {
    const journal = new RequestJournal({ directory });
    const input = { prompt: 'Keep the human correction' };
    assert.throws(() => journal.recover(identity, input), (error: unknown) => error instanceof RequestRecoveryError && error.requestState === 'missing');
    assert.deepEqual(readdirSync(directory), []);
    let release!: () => void;
    const running = journal.run(identity, input, async () => { await new Promise<void>(resolve => { release = resolve; }); return { objectId: 'one-result' }; });
    await Promise.resolve();
    assert.throws(() => journal.recover(identity, input), (error: unknown) => error instanceof RequestRecoveryError && error.requestState === 'running');
    assert.throws(() => journal.recover(identity, { prompt: 'different' }), /different content/);
    release(); await running;
    const recovered = new RequestJournal({ directory }).recover<{ objectId: string }>(identity, input);
    assert.equal(recovered.objectId, 'one-result'); assert.equal(recovered.replayed, true);
    assert.throws(() => journal.recover({ ...identity, actor: 'another-person' }, input), (error: unknown) => error instanceof RequestRecoveryError && error.requestState === 'missing');
    await assert.rejects(journal.run({ ...identity, requestId: 'failed' }, input, async () => { throw new Error('stopped'); }), /stopped/);
    assert.throws(() => journal.recover({ ...identity, requestId: 'failed' }, input), (error: unknown) => error instanceof RequestRecoveryError && error.requestState === 'failed');
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('concurrent retries and a restarted journal recover the same result without another execution', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'present-request-'));
  try {
    const journal = new RequestJournal({ directory }); let executions = 0;
    let release!: () => void;
    const execute = async () => { executions++; await new Promise<void>(resolve => { release = resolve; }); return { objectId: 'same-native-object' }; };
    const first = journal.run(identity, { prompt: 'Draw a tree' }, execute);
    const second = journal.run(identity, { prompt: 'Draw a tree' }, execute);
    await Promise.resolve(); release();
    assert.equal((await first).replayed, false);
    assert.equal((await second).replayed, true);
    const recovered = await new RequestJournal({ directory }).run(identity, { prompt: 'Draw a tree' }, execute);
    assert.equal(recovered.objectId, 'same-native-object'); assert.equal(recovered.replayed, true); assert.equal(executions, 1);
    assert.doesNotMatch(readFileSync(join(directory, readdirSync(directory)[0]), 'utf8'), /Draw a tree/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('changed content conflicts even when a caller supplies additional identity properties', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'present-request-'));
  try {
    const journal = new RequestJournal({ directory });
    await journal.run({ ...identity, ...{ prompt: 'first' } }, { prompt: 'first' }, async () => ({ ok: true }));
    await assert.rejects(journal.run({ ...identity, ...{ prompt: 'changed' } }, { prompt: 'changed' }, async () => ({ ok: true })), /different content/);
    const otherActor = await journal.run({ ...identity, actor: 'participant-b' }, { prompt: 'changed' }, async () => ({ ok: true }));
    assert.equal(otherActor.replayed, false);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('failed or interrupted execution is never automatically repeated after a restart', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'present-request-'));
  try {
    const journal = new RequestJournal({ directory }); let executions = 0;
    const execute = async () => { executions++; throw new Error('provider interrupted after a possible commit'); };
    await assert.rejects(journal.run(identity, {}, execute), /provider interrupted/);
    await assert.rejects(new RequestJournal({ directory }).run(identity, {}, execute), /Check the room/);
    assert.equal(executions, 1);
    const file = join(directory, readdirSync(directory)[0]);
    const receipt = JSON.parse(readFileSync(file, 'utf8')); receipt.status = 'running'; writeFileSync(file, JSON.stringify(receipt));
    assert.throws(() => new RequestJournal({ directory }).recover(identity, {}), (error: unknown) => error instanceof RequestRecoveryError && error.requestState === 'interrupted');
    await assert.rejects(new RequestJournal({ directory }).run(identity, {}, execute), /Check the room/);
    assert.equal(executions, 1);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('full receipt storage still recovers prior requests and rejects new execution', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'present-request-'));
  try {
    const journal = new RequestJournal({ directory, maxEntries: 1 });
    await journal.run(identity, {}, async () => ({ done: true }));
    assert.equal((await journal.run(identity, {}, async () => ({ done: false }))).done, true);
    await assert.rejects(journal.run({ ...identity, requestId: 'second' }, {}, async () => ({ done: true })), /history is full/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
