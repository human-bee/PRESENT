import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { runWorkspaceTurn } from '../server/agents/workspace-turn';
import type { WorkspaceWire } from '../server/agents/workspace-work';
import { reserveProjectStoryTurn } from '../server/projects/work-budget';
const keys = ['PRESENT_DATA_DIRECTORY', 'PRESENT_PROJECT_STORY_BUDGET_FILE', 'PRESENT_PROJECT_STORY_ROOM', 'PRESENT_PROJECT_STORY_CARD', 'PRESENT_PROJECT_STORY_MAX_TURNS'];
test('project story fence is inert by default, scopes exact card and refuses a third turn or changed durable scope', async () => {
  const previous = keys.map(key => process.env[key]), root = mkdtempSync(join(tmpdir(), 'present-work-budget-'));
  try {
    keys.forEach(key => delete process.env[key]); reserveProjectStoryTurn('not-a-job', 'discovery', 'unknown');
    process.env.PRESENT_DATA_DIRECTORY = root; process.env.PRESENT_PROJECT_STORY_BUDGET_FILE = resolve(root, 'budget.json'); process.env.PRESENT_PROJECT_STORY_ROOM = 'a'.repeat(48); process.env.PRESENT_PROJECT_STORY_CARD = 'story-card'; process.env.PRESENT_PROJECT_STORY_MAX_TURNS = '2';
    mkdirSync(join(root, 'work-jobs')); const jobId = 'b'.repeat(32);
    const job = { jobId, roomId: 'a'.repeat(48), requestId: 'story', objectId: 'story-card', actor: 'actor', owner: 'Owner', title: 'Project story', prompt: 'Synthetic public work', provider: 'sol', reasoning: 'high', fast: false, status: 'running', attempt: 1, createdAt: 1, startedAt: 2, completedAt: null, error: null, artifactIds: [], fingerprint: 'c'.repeat(64), commitToken: 'd'.repeat(32), project: { id: 'source', name: 'Source', description: '', commit: 'e'.repeat(40), snapshotId: 'f'.repeat(64), sourceFingerprint: '0'.repeat(64), files: 1, bytes: 1 } };
    writeFileSync(join(root, 'work-jobs', jobId + '.json'), JSON.stringify(job));
    process.env.PRESENT_PROJECT_STORY_CARD = 'other'; reserveProjectStoryTurn(jobId, 'out-of-scope', 'gpt-6.1-sol'); process.env.PRESENT_PROJECT_STORY_CARD = 'story-card';
    assert.throws(() => reserveProjectStoryTurn(jobId, 'one', 'unknown'), /exact model/);
    reserveProjectStoryTurn(jobId, 'one', 'gpt-6.1-sol'); reserveProjectStoryTurn(jobId, 'two', 'gpt-6.1-sol');
    const saved = JSON.parse(readFileSync(process.env.PRESENT_PROJECT_STORY_BUDGET_FILE!, 'utf8')); assert.equal(saved.reservations.length, 2); assert.ok(!JSON.stringify(saved).includes('story-card')); assert.ok(!JSON.stringify(saved).includes('gpt-6.1-sol'));
    assert.throws(() => reserveProjectStoryTurn(jobId, 'three', 'gpt-6.1-sol'), /exhausted/); let turnCalls = 0; const wire: WorkspaceWire = { closed: false, listeners: new Set(), stopped: Promise.resolve(), send() {}, close() {}, request: async () => { turnCalls++; throw new Error('No turn RPC may be dispatched.'); } }; await assert.rejects(runWorkspaceTurn(wire, { jobId, prompt: 'No real provider request', provider: 'sol', attempt: 3, state: { workspaceId: jobId, threadId: 'saved-thread', model: 'gpt-6.1-sol', phase: 'ready', turnId: null, dispatchId: null, commands: [] }, onCheckpoint() {} }, root, AbortSignal.timeout(1000)), /exhausted/); assert.equal(turnCalls, 0); process.env.PRESENT_PROJECT_STORY_MAX_TURNS = '1'; assert.throws(() => reserveProjectStoryTurn(jobId, 'three', 'gpt-6.1-sol'), /scope changed/);
  } finally { keys.forEach((key, index) => { if (previous[index] === undefined) delete process.env[key]; else process.env[key] = previous[index]; }); rmSync(root, { recursive: true, force: true }); }
});
