import { createHash } from 'node:crypto';
import { writeDurableFile } from '../durable-file';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
import { projectExecutionSchema, type ProjectExecution, type ProjectSnapshot } from '../../shared/project-work';
import { readWorkspaceFiles } from '../agents/workspace-sandbox';
import { ProjectRegistry, ProjectRegistryError } from './registry';

const git = (cwd: string, args: string[], buffer = false): Buffer | string => {
  try { return execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', '-C', cwd, ...args], { encoding: buffer ? 'buffer' : 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 256 * 1024, env: { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))), GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' } }); }
  catch { throw new ProjectRegistryError('The isolated project workspace could not be prepared.'); }
};
const existing = (cwd: string) => readdirSync(cwd).some(name => name !== '.tmp');

/** Materialize committed blobs once, then establish a new local-only Git baseline. */
export function prepareProjectWorkspace(cwd: string, project: ProjectSnapshot, registry: ProjectRegistry) {
  if (existsSync(join(cwd, '.git'))) { verifyProjectBaseline(cwd, project); return; }
  if (existing(cwd)) throw new ProjectRegistryError('This workspace belongs to different work. Start a new work card.');
  registry.materialize(project, cwd);
  git(cwd, ['init', '--quiet']);
  git(cwd, ['add', '--all']);
  git(cwd, ['-c', 'user.name=PRESENT workspace', '-c', 'user.email=workspace@local', 'commit', '--quiet', '-m', 'Snapshot baseline']);
  writeDurableFile(cwd + '.project-baseline.json', JSON.stringify({ snapshotId: project.snapshotId, commit: String(git(cwd, ['rev-parse', 'HEAD'])).trim(), configHash: configHash(cwd) }));
}

/** This derives evidence only from the local isolated copy after the worker has stopped. */
export function inspectProjectWorkspace(cwd: string, project: ProjectSnapshot): ProjectExecution {
  verifyProjectBaseline(cwd, project);
  git(cwd, ['add', '--intent-to-add', '--all']);
  const status = Buffer.from(git(cwd, ['diff', '--no-ext-diff', '--no-textconv', '--no-renames', '--name-status', '-z'], true)).toString('utf8');
  const fields = status.split('\0').filter(Boolean), changes: { status: 'A' | 'M' | 'D'; path: string }[] = [];
  for (let index = 0; index < fields.length; index += 2) {
    const rawStatus = fields[index], path = fields[index + 1];
    const change = rawStatus === 'A' || rawStatus === 'M' || rawStatus === 'D' ? rawStatus : null;
    if (!change || !path || path.length > 240 || /[\\\p{Cc}\p{Cf}]/u.test(path)) throw new ProjectRegistryError('The isolated project diff is invalid.');
    changes.push({ status: change, path });
  }
  const raw = Buffer.from(git(cwd, ['diff', '--no-ext-diff', '--no-textconv', '--no-renames', '--unified=3', '--'], true));
  const limit = 48000, diffTruncated = raw.length > limit;
  return projectExecutionSchema.parse({ project, changes, diff: raw.subarray(0, limit).toString('utf8'), diffTruncated });
}

export const projectFiles = (cwd: string) => readWorkspaceFiles(cwd);

function configHash(cwd: string) {
  const directory = lstatSync(join(cwd, '.git'));
  if (!directory.isDirectory() || directory.isSymbolicLink()) throw new ProjectRegistryError('Project Git directory is unsafe.');
  const path = join(cwd, '.git', 'config'), stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 16000) throw new ProjectRegistryError('Project Git configuration is unsafe.');
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}
function verifyProjectBaseline(cwd: string, project: ProjectSnapshot) {
  try {
    const metadata = JSON.parse(readFileSync(cwd + '.project-baseline.json', 'utf8'));
    if (metadata.snapshotId !== project.snapshotId || metadata.configHash !== configHash(cwd)) throw new Error();
    let entries = 0, bytes = 0;
    const walk = (path: string) => { for (const name of readdirSync(path)) { if (++entries > 5000) throw new Error(); const child = join(path, name), stat = lstatSync(child); if (stat.isSymbolicLink()) throw new Error(); if (stat.isDirectory()) walk(child); else if (!stat.isFile() || stat.nlink !== 1 || (bytes += stat.size) > 64 * 1024 * 1024 || ['alternates', 'http-alternates', 'grafts'].includes(name)) throw new Error(); } };
    walk(join(cwd, '.git'));
    git(cwd, ['fsck', '--no-reflogs', '--strict']);
    if (String(git(cwd, ['rev-parse', 'HEAD'])).trim() !== metadata.commit) throw new Error();
  } catch { throw new ProjectRegistryError('The isolated Git baseline changed or cannot be verified. Saved files are retained; start a fresh authorized work card.'); }
}
