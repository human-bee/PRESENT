import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProjectRegistry } from '../../server/projects/registry';
import { inspectProjectWorkspace, prepareProjectWorkspace } from '../../server/projects/workspace';

const root = mkdtempSync(join(tmpdir(), 'present-project-benchmark-')), source = join(root, 'source'), workspace = join(root, 'workspace');
try {
  execFileSync('git', ['init', '--quiet', source]);
  for (let index = 0; index < 25; index++) writeFileSync(join(source, `file-${index}.ts`), `export const value${index} = ${index};\n`);
  execFileSync('git', ['-C', source, 'add', '--all']); execFileSync('git', ['-C', source, '-c', 'user.name=benchmark', '-c', 'user.email=benchmark@example.test', 'commit', '--quiet', '-m', 'fixture']);
  const config = join(root, 'projects.json'); writeFileSync(config, JSON.stringify({ projects: [{ id: 'benchmark', name: 'Benchmark', directory: source }] }));
  const registry = new ProjectRegistry(config), first = registry.snapshot('benchmark'), second = registry.snapshot('benchmark');
  assert.deepEqual(first, second); mkdirSync(workspace); prepareProjectWorkspace(workspace, first, registry);
  writeFileSync(join(workspace, 'file-7.ts'), 'export const value7 = 700;\n');
  const result = inspectProjectWorkspace(workspace, first);
  assert.deepEqual(result.changes, [{ status: 'M', path: 'file-7.ts' }]);
  console.log(JSON.stringify({ files: first.files, bytes: first.bytes, snapshotStable: first.snapshotId === second.snapshotId, changes: result.changes, diffBytes: Buffer.byteLength(result.diff) }));
} finally { rmSync(root, { recursive: true, force: true }); }
