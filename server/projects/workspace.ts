import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { projectExecutionSchema, type ProjectExecution, type ProjectSnapshot } from '../../shared/project-work';
import { readWorkspaceFiles } from '../agents/workspace-sandbox';
import { ProjectRegistry, ProjectRegistryError } from './registry';

const git = (cwd: string, args: string[], buffer = false): Buffer | string => {
  try { return execFileSync('git', ['-C', cwd, ...args], { encoding: buffer ? 'buffer' : 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 256 * 1024 }); }
  catch { throw new ProjectRegistryError('The isolated project workspace could not be prepared.'); }
};
const existing = (cwd: string) => readdirSync(cwd).some(name => name !== '.tmp');

/** Materialize committed blobs once, then establish a new local-only Git baseline. */
export function prepareProjectWorkspace(cwd: string, project: ProjectSnapshot, registry: ProjectRegistry) {
  if (existsSync(join(cwd, '.git'))) return;
  if (existing(cwd)) throw new ProjectRegistryError('This workspace belongs to different work. Start a new work card.');
  registry.materialize(project, cwd);
  git(cwd, ['init', '--quiet']);
  git(cwd, ['add', '--all']);
  git(cwd, ['-c', 'user.name=PRESENT workspace', '-c', 'user.email=workspace@local', 'commit', '--quiet', '-m', 'Snapshot baseline']);
}

/** This derives evidence only from the local isolated copy after the worker has stopped. */
export function inspectProjectWorkspace(cwd: string, project: ProjectSnapshot): ProjectExecution {
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
