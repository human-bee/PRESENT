import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, relative, resolve, sep } from 'node:path';
import { z } from 'zod';
import { dataPath } from '../data-path';
import { projectIdSchema, projectSnapshotSchema, projectSummarySchema, type ProjectSnapshot, type ProjectSummary } from '../../shared/project-work';

const registrySchema = z.object({ projects: z.array(z.object({ id: projectIdSchema, name: z.string().trim().min(1).max(120), description: z.string().max(300).default(''), directory: z.string().min(1).max(4096), include: z.array(z.string().min(1).max(240)).max(100).optional() }).strict()).max(32) }).strict();
type RegisteredProject = z.infer<typeof registrySchema>['projects'][number] & { directory: string; sourceFingerprint: string };
const MAX_FILES = 100, MAX_BYTES = 8 * 1024 * 1024, MAX_FILE_BYTES = 1024 * 1024;
export const privateProjectName = (name: string) => /^(?:\.env(?:\.|$)|\.npmrc$|\.netrc$|\.pypirc$|id_rsa(?:\.|$)|credentials?(?:\.|$)|secrets?(?:\.|$)|tokens?(?:\.|$)|passwords?(?:\.|$)|auth(?:entication)?\.(?:json|ya?ml|toml)$)|\.(?:pem|key|p12|pfx)$/i.test(name);
export const safeProjectPath = (path: string) => path.length > 0 && path.length <= 240 && !/[\\\p{Cc}\p{Cf}]/u.test(path) && path.split('/').every(part => part && part !== '.' && part !== '..' && part !== '.git' && part !== 'node_modules');
export class ProjectRegistryError extends Error {}
const fail = (message: string): never => { throw new ProjectRegistryError(message); };
function git(directory: string, args: string[]): Buffer {
  try { return execFileSync('git', ['-C', directory, ...args], { encoding: 'buffer', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 2 * 1024 * 1024 }) as Buffer; }
  catch { return fail('Selected project is not available as a committed local source repository.'); }
}
function hash(value: unknown) { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }

/** Reads only a private server configuration; browser inputs resolve an ID against this table. */
export class ProjectRegistry {
  constructor(private configPath = dataPath('projects.json')) {}
  private projects(): RegisteredProject[] {
    if (!existsSync(this.configPath)) return [];
    let raw: unknown;
    try { raw = JSON.parse(readFileSync(this.configPath, 'utf8')); } catch { fail('Project registry configuration is invalid.'); }
    const parsed = registrySchema.safeParse(raw); if (!parsed.success || !parsed.data) fail('Project registry configuration is invalid.');
    const configuration = parsed.data!;
    const ids = new Set<string>();
    return configuration.projects.map(project => {
      if (ids.has(project.id)) fail('Project registry configuration contains duplicate IDs.'); ids.add(project.id);
      let directory = '';
      try { directory = realpathSync(project.directory); } catch { fail('A registered project source is unavailable.'); }
      if (project.include && new Set(project.include).size !== project.include.length) fail('Project source selection contains duplicates.');
      if (project.include?.some(path => !safeProjectPath(path) || path.split('/').some(privateProjectName))) fail('Project selection contains an unsafe path.');
      if (!resolve(directory).startsWith(sep) || !lstatSync(directory).isDirectory()) fail('A registered project source is unavailable.');
      const top = git(directory, ['rev-parse', '--show-toplevel']).toString('utf8').trim();
      if (top !== directory) fail('A registered project must point at its repository root.');
      return { ...project, directory, sourceFingerprint: project.include ? hash({ directory, include: project.include }) : hash(directory) };
    });
  }
  list(): ProjectSummary[] { return this.projects().map(({ id, name, description }) => projectSummarySchema.parse({ id, name, description })); }
  resolve(id: string): RegisteredProject {
    if (!projectIdSchema.safeParse(id).success) fail('Choose a registered project.');
    const project = this.projects().find(candidate => candidate.id === id); if (!project) return fail('Choose a registered project.');
    return project;
  }
  snapshot(id: string): ProjectSnapshot {
    const project = this.resolve(id), commit = git(project.directory, ['rev-parse', 'HEAD']).toString('utf8').trim();
    const entries = git(project.directory, ['ls-tree', '-r', '-z', '--full-tree', 'HEAD']).toString('utf8').split('\0').filter(Boolean);
    const files: { path: string; blob: string; bytes: number }[] = [];
    let bytes = 0;
    for (const entry of entries) {
      const match = /^(100644|100755) blob ([a-f0-9]{40,64})\t(.+)$/s.exec(entry); if (!match) continue;
      const [, , blob, path] = match;
      if (!safeProjectPath(path) || path.split('/').some(privateProjectName) || (project.include && !project.include.includes(path))) continue;
      const content = git(project.directory, ['cat-file', 'blob', blob]);
      if (content.length > MAX_FILE_BYTES) continue;
      if (files.length >= MAX_FILES || bytes + content.length > MAX_BYTES) fail('Selected project exceeds the bounded snapshot limit. Configure an explicit source selection.');
      files.push({ path, blob, bytes: content.length }); bytes += content.length;
    }
    if (project.include && files.length !== project.include.length) fail('An explicitly selected source file is missing, unsafe or exceeds the file limit.');
    const snapshotId = hash({ id: project.id, sourceFingerprint: project.sourceFingerprint, commit, files });
    return projectSnapshotSchema.parse({ id: project.id, name: project.name, description: project.description, sourceFingerprint: project.sourceFingerprint, commit, snapshotId, files: files.length, bytes });
  }
  materialize(snapshot: ProjectSnapshot, destination: string) {
    const parsed = projectSnapshotSchema.parse(snapshot), project = this.resolve(parsed.id);
    if (project.sourceFingerprint !== parsed.sourceFingerprint) fail('The selected project changed. Start a new work card and authorize it again.');
    const root = realpathSync(destination);
    if (relative(root, destination) !== '' || !lstatSync(root).isDirectory()) fail('Project workspace is unavailable.');
    const entries = git(project.directory, ['ls-tree', '-r', '-z', '--full-tree', parsed.commit]).toString('utf8').split('\0').filter(Boolean);
    const files: { path: string; blob: string; bytes: number }[] = [];
    let bytes = 0;
    for (const entry of entries) {
      const match = /^(100644|100755) blob ([a-f0-9]{40,64})\t(.+)$/s.exec(entry); if (!match) continue;
      const [, mode, blob, path] = match;
      if (!safeProjectPath(path) || path.split('/').some(privateProjectName) || (project.include && !project.include.includes(path))) continue;
      const content = git(project.directory, ['cat-file', 'blob', blob]);
      if (content.length > MAX_FILE_BYTES) continue;
      if (files.length >= MAX_FILES || bytes + content.length > MAX_BYTES) fail('Selected project exceeds the bounded snapshot limit. Configure an explicit source selection.');
      files.push({ path, blob, bytes: content.length }); bytes += content.length;
      const target = resolve(root, path); if (!target.startsWith(`${root}${sep}`)) fail('Project source contains an unsafe path.');
      const parent = resolve(target, '..');
      mkdirSync(parent, { recursive: true, mode: 0o700 }); writeFileSync(target, content, { mode: 0o600 }); if (mode === '100755') chmodSync(target, 0o700);
    }
    if (project.include && files.length !== project.include.length) fail('An explicitly selected source file is missing, unsafe or exceeds the file limit.');
    const snapshotId = hash({ id: project.id, sourceFingerprint: project.sourceFingerprint, commit: parsed.commit, files });
    if (snapshotId !== parsed.snapshotId) fail('The selected committed source could not be reconstructed.');
  }
}
