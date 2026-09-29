import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { ProjectRegistry } from '../server/projects/registry';
import { inspectProjectWorkspace, prepareProjectWorkspace } from '../server/projects/workspace';
import { WorkJobs } from '../server/agents/work-jobs';
import { RoomStore } from '../server/room-store';

const runGit = (cwd: string, args: string[]) => execFileSync('git', ['-C', cwd, ...args], { stdio: 'ignore' });
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'present-project-work-')), source = join(root, 'source'), destination = join(root, 'copy'), config = join(root, 'projects.json');
  execFileSync('git', ['init', '--quiet', source]);
  writeFileSync(join(source, 'app.ts'), 'export const answer = 42;\n');
  writeFileSync(join(source, '.env'), 'PRIVATE=do-not-copy\n');
  writeFileSync(join(source, 'secrets.txt'), 'do-not-copy\n');
  mkdirSync(join(source, 'node_modules')); writeFileSync(join(source, 'node_modules', 'private.js'), 'do-not-copy\n');
  symlinkSync('/etc/hosts', join(source, 'outside-link'));
  runGit(source, ['add', '--all']); runGit(source, ['-c', 'user.name=test', '-c', 'user.email=test@example.test', 'commit', '--quiet', '-m', 'fixture']);
  writeFileSync(config, JSON.stringify({ projects: [{ id: 'demo', name: 'Demo', description: 'Fixture', directory: source }] }));
  return { root, source, destination, registry: new ProjectRegistry(config), close: () => rmSync(root, { recursive: true, force: true }) };
}

test('selected project snapshot excludes private, dependency and symlink content and preserves original source', () => {
  const f = fixture();
  try {
    const snapshot = f.registry.snapshot('demo');
    assert.equal(snapshot.files, 1);
    mkdirSync(f.destination);
    prepareProjectWorkspace(f.destination, snapshot, f.registry);
    assert.equal(readFileSync(join(f.destination, 'app.ts'), 'utf8'), 'export const answer = 42;\n');
    for (const path of ['.env', 'secrets.txt', 'node_modules', 'outside-link']) assert.equal(existsSync(join(f.destination, path)), false);
    writeFileSync(join(f.destination, 'app.ts'), 'export const answer = 43;\n');
    assert.equal(readFileSync(join(f.source, 'app.ts'), 'utf8'), 'export const answer = 42;\n');
    const result = inspectProjectWorkspace(f.destination, snapshot);
    assert.deepEqual(result.changes, [{ status: 'M', path: 'app.ts' }]);
    assert.match(result.diff, /-export const answer = 42;/); assert.match(result.diff, /\+export const answer = 43;/);
  } finally { f.close(); }
});

test('registry accepts only configured IDs and project continuation cannot switch or clear a selection', async () => {
  const f = fixture();
  const jobsDir = join(f.root, 'jobs'), store = new RoomStore({ directory: join(f.root, 'rooms'), legacyDirectory: join(f.root, 'legacy') });
  const jobs = new WorkJobs({ directory: jobsDir, store, projects: f.registry, run: async input => ({ output: JSON.stringify({ title: 'Done', format: 'markdown', body: 'Done.' }), execution: { boundary: 'local-workspace', continued: input.state.threadId !== null, commands: [], files: [] } }) });
  const base = { roomId: 'd'.repeat(32), actor: 'human', title: 'Change source', owner: 'Human', prompt: 'Change app.', provider: 'spark' as const };
  try {
    assert.throws(() => jobs.start({ ...base, requestId: 'escape', projectId: 'other' }), /registered project/);
    const first = jobs.start({ ...base, requestId: 'first', projectId: 'demo' }); await jobs.settled();
    assert.equal(jobs.get(base.roomId, first.jobId).project?.id, 'demo');
    assert.throws(() => jobs.start({ ...base, requestId: 'cleared', objectId: first.objectId }), /original selected project/);
    assert.throws(() => jobs.start({ ...base, requestId: 'switch', objectId: first.objectId, projectId: 'other' }), /original selected project/);
  } finally { jobs.close(); await jobs.settled(); store.close(); f.close(); }
});
