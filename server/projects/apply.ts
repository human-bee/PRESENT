import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, unlinkSync, chmodSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { z } from 'zod';
import { projectApplyRequestSchema, projectReviewRequestSchema, projectReviewSchema, type ProjectReview } from '../../shared/project-work';
import { storedWorkJobSchema, type StoredWorkJob } from '../../shared/work';
import { dataPath } from '../data-path';
import { writeDurableFile } from '../durable-file';
import { getRoom, type RoomStore } from '../room-store';
import { requireRoomAuthorization } from '../access/context';
import { AccessError } from '../access/store';
import { AgentError } from '../agents/contract';
import { inspectProjectWorkspace } from './workspace';
import { ProjectRegistry, privateProjectName, safeProjectPath } from './registry';
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const bytesHash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const receiptSchema = z.object({ version: z.literal(1), roomId: z.string(), actor: z.string(), objectId: z.string(), snapshotId: hash, changeId: hash, status: z.enum(['applying', 'applied']), at: z.string(), files: z.array(z.object({ path: z.string(), sha256: hash, mode: z.number().int() }).strict()).max(100) }).strict();
type Receipt = z.infer<typeof receiptSchema>;
type Options = { jobsDirectory?: string; receiptDirectory?: string; registry?: ProjectRegistry; store?: Pick<RoomStore, 'getRoom'> };
function sourceGit(cwd: string, args: string[]): string {
  try { return execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', '-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 256000, env: { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))), GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' } }); }
  catch { throw new AgentError('The registered source could not be checked. No source was applied.', 409); }
}
function file(root: string, path: string, missing = false): { bytes: Buffer; sha256: string; mode: number } | null {
  if (realpathSync(root) !== root || !lstatSync(root).isDirectory() || lstatSync(root).isSymbolicLink()) throw new AgentError('The registered source root changed.', 409);
  if (!safeProjectPath(path) || path.split('/').some(privateProjectName)) throw new AgentError('The change contains an unsafe or private path.', 409);
  const target = resolve(root, path); if (!target.startsWith(root + sep)) throw new AgentError('Unsafe source path.', 409);
  let cursor = root;
  for (const component of path.split('/').slice(0, -1)) { cursor = join(cursor, component); if (!existsSync(cursor)) { if (missing) return null; throw new AgentError('A source parent is missing.', 409); } const stat = lstatSync(cursor); if (!stat.isDirectory() || stat.isSymbolicLink()) throw new AgentError('Source parents must be regular directories.', 409); }
  if (!existsSync(target)) { if (missing) return null; throw new AgentError('A reviewed source file is missing.', 409); }
  const stat = lstatSync(target); if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 1024 * 1024) throw new AgentError('Only bounded regular source files can be applied.', 409);
  const bytes = readFileSync(target); if (bytes.includes(0) || !Buffer.from(bytes.toString('utf8')).equals(bytes)) throw new AgentError('Binary or invalid UTF-8 changes cannot be applied.', 409);
  return { bytes, sha256: bytesHash(bytes), mode: stat.mode & 0o777 };
}
/** Explicit reviewed apply to the operator's registered source; no patch/path comes from the client. */
export class ProjectChanges {
  private registry: ProjectRegistry; private jobs: string; private receipts: string; private store: Pick<RoomStore, 'getRoom'>;
  constructor(options: Options = {}) { this.registry = options.registry ?? new ProjectRegistry(); this.jobs = options.jobsDirectory ?? dataPath('work-jobs'); this.receipts = options.receiptDirectory ?? dataPath('project-applies'); this.store = options.store ?? { getRoom }; }
  private authorize(input: { roomId: string; actor: string }) { const grant = requireRoomAuthorization(input.roomId, 'tools'); if (grant && grant.userId !== input.actor) throw new AccessError('Project approval identity must match the signed room member.'); }
  private job(input: z.infer<typeof projectReviewRequestSchema>): StoredWorkJob {
    this.authorize(input);
    let job: StoredWorkJob;
    try { const path = join(this.jobs, input.jobId + '.json'), stat = lstatSync(path); if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 160000) throw new Error(); job = storedWorkJobSchema.parse(JSON.parse(readFileSync(path, 'utf8'))); }
    catch { throw new AgentError('This project work receipt is unavailable.', 404); }
    if (job.roomId !== input.roomId || job.actor !== input.actor) throw new AccessError('Only the initiating participant can review or apply this project work.');
    if (job.status !== 'completed' || !job.project || !job.execution?.project || !job.executionState) throw new AgentError('Only completed selected-project work can be reviewed.', 409);
    const objects = this.store.getRoom(input.roomId).objects, card = objects.find(object => object.id === job.objectId), work = card?.data.work as Record<string, unknown> | undefined;
    const artifact = objects.find(object => object.id === job.artifactIds[0]);
    if (work?.jobId !== job.jobId || work.status !== 'completed' || work.actor !== job.actor || artifact?.data.sourceJobId !== job.jobId || artifact?.data.commitToken !== job.commitToken) throw new AgentError('The completed card or artifact linkage changed. Saved files are retained.', 409);
    this.authorize(input); return job;
  }
  private receiptPath(job: StoredWorkJob) { return join(this.receipts, digest([job.project!.sourceFingerprint, job.project!.snapshotId]) + '.json'); }
  private receipt(job: StoredWorkJob): Receipt | undefined {
    const path = this.receiptPath(job); if (!existsSync(path)) return;
    try { const stat = lstatSync(path); if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) throw new Error(); return receiptSchema.parse(JSON.parse(readFileSync(path, 'utf8'))); }
    catch { throw new AgentError('The private apply receipt cannot be verified. No source was applied.', 409); }
  }
  private plan(input: z.infer<typeof projectReviewRequestSchema>) {
    const job = this.job(input), project = job.project!, registered = this.registry.resolve(project.id);
    if (registered.sourceFingerprint !== project.sourceFingerprint) throw new AgentError('The registered source selection changed.', 409);
    const cwd = realpathSync(join(this.jobs, 'workspaces', job.executionState!.workspaceId, 'files'));
    const execution = inspectProjectWorkspace(cwd, project), previous = this.receipt(job);
    if (/^old mode |^new mode /m.test(execution.diff)) throw new AgentError('Executable mode changes need separate manual review.', 409);
    const files = execution.changes.map(change => { if (change.status === 'D') throw new AgentError('File deletion requires separate manual review; automatic apply supports additions and text edits.', 409); const next = file(cwd, change.path)!; return { ...change, ...next }; });
    if (execution.diff !== job.execution!.project!.diff || execution.diffTruncated !== job.execution!.project!.diffTruncated || JSON.stringify(execution.changes) !== JSON.stringify(job.execution!.project!.changes) || files.some(next => !job.execution!.files.some(saved => saved.path === next.path && saved.sha256 === next.sha256))) throw new AgentError('The isolated files changed after completion. Start an authorized follow-up before reviewing.', 409);
    const changeId = digest({ snapshotId: project.snapshotId, diff: execution.diff, changes: files.map(({ path, status, sha256, mode }) => ({ path, status, sha256, mode })) });
    const view: ProjectReview = { ...execution, jobId: job.jobId, changeId, canApply: false, applied: previous?.status === 'applied' && previous.changeId === changeId };
    if (execution.diffTruncated || !files.length) view.blockedReason = execution.diffTruncated ? 'The diff is truncated. Narrow the work before applying.' : 'There are no source changes to apply.';
    return { job, project, registered, files, previous, view };
  }
  private verifySource(plan: ReturnType<ProjectChanges['plan']>) {
    const { job, registered, previous, project } = plan, source = registered.directory;
    if (sourceGit(source, ['rev-parse', 'HEAD']).trim() !== project.commit || sourceGit(source, ['diff', '--no-ext-diff', '--no-textconv', '--cached', '--name-only', '--']).trim()) throw new AgentError('The registered source commit or index diverged. Human changes are preserved.', 409);
    if (previous && (previous.roomId !== job.roomId || previous.actor !== job.actor || previous.objectId !== job.objectId || previous.snapshotId !== project.snapshotId || previous.status !== 'applied')) throw new AgentError('A prior or interrupted apply requires separate review. No source was changed.', 409);
    const fields = sourceGit(source, ['status', '--porcelain=v1', '-z', '--untracked-files=all']).split('\0').filter(Boolean);
    const expected = new Map(previous?.files.map(value => [value.path, value]) ?? []);
    for (const field of fields) { const path = field.slice(3), before = expected.get(path), actual = file(source, path, true); if (!before || !actual || actual.sha256 !== before.sha256 || actual.mode !== before.mode) throw new AgentError('The registered source diverged from the reviewed snapshot. Human edits are preserved.', 409); }
    if ([...expected.keys()].some(path => !plan.files.some(change => change.path === path))) throw new AgentError('A follow-up removed a previously applied change. Review that reversal manually.', 409);
    for (const before of expected.values()) { const actual = file(source, before.path, true); if (!actual || actual.sha256 !== before.sha256 || actual.mode !== before.mode) throw new AgentError('Previously applied source changed. Human edits are preserved.', 409); }
    for (const change of plan.files) { const actual = file(source, change.path, true); if (change.status === 'A' && actual && !expected.has(change.path)) throw new AgentError('A new source path already exists. Human files are preserved.', 409); }
  }
  private reviewPath(input: z.infer<typeof projectApplyRequestSchema>) { return join(this.receipts, 'review-' + digest([input.roomId, input.actor, input.jobId, input.snapshotId, input.changeId]) + '.json'); }
  review(raw: unknown): ProjectReview {
    const input = projectReviewRequestSchema.parse(raw), plan = this.plan(input);
    try { this.verifySource(plan); plan.view.canApply = !plan.view.blockedReason && !plan.view.applied; }
    catch (error) { if (error instanceof AccessError) throw error; plan.view.blockedReason = error instanceof Error ? error.message.slice(0, 300) : 'Source cannot be verified.'; }
    this.authorize(input);
    if (plan.view.canApply || plan.view.applied) { mkdirSync(this.receipts, { recursive: true, mode: 0o700 }); writeDurableFile(this.reviewPath({ ...input, snapshotId: plan.project.snapshotId, changeId: plan.view.changeId }), JSON.stringify({ version: 1, scopeHash: digest([input.roomId, input.actor, input.jobId]), snapshotId: plan.project.snapshotId, changeId: plan.view.changeId })); }
    return projectReviewSchema.parse(plan.view);
  }
  apply(raw: unknown): ProjectReview {
    const input = projectApplyRequestSchema.parse(raw); this.authorize(input);
    mkdirSync(this.receipts, { recursive: true, mode: 0o700 });
    // One source-snapshot writer across processes; retained crash locks fail closed.
    const initial = this.job(input), lock = this.receiptPath(initial) + '.lock'; let fd: number | undefined;
    try {
      try { fd = openSync(lock, 'wx', 0o600); } catch { throw new AgentError('An apply is already active or needs operator review.', 409); }
      const plan = this.plan(input);
      if (input.snapshotId !== plan.project.snapshotId || input.changeId !== plan.view.changeId) throw new AgentError('The exact reviewed change set changed. Review it again before applying.', 409);
      const ticket = this.reviewPath(input);
      if (!existsSync(ticket) || JSON.parse(readFileSync(ticket, 'utf8')).scopeHash !== digest([input.roomId, input.actor, input.jobId])) throw new AgentError('Review this exact change set before applying it.', 409);
      this.verifySource(plan); this.authorize(input);
      if (plan.view.applied) return projectReviewSchema.parse({ ...plan.view, canApply: false });
      if (plan.view.blockedReason) throw new AgentError(plan.view.blockedReason, 409);
      const beforeFiles = new Map(plan.files.map(next => [next.path, file(plan.registered.directory, next.path, true)]));
      const receipt: Receipt = { version: 1, roomId: input.roomId, actor: input.actor, objectId: plan.job.objectId, snapshotId: input.snapshotId, changeId: input.changeId, status: 'applying', at: new Date().toISOString(), files: plan.files.map(({ path, sha256, mode }) => ({ path, sha256, mode: beforeFiles.get(path)?.mode ?? (mode & 0o111 ? 0o755 : 0o644) })) };
      writeDurableFile(this.receiptPath(plan.job), JSON.stringify(receipt));
      for (const next of plan.files) {
        this.authorize(input);
        const source = plan.registered.directory, current = file(source, next.path, true);
        const before = beforeFiles.get(next.path);
        if (current?.sha256 !== before?.sha256 || current?.mode !== before?.mode) throw new AgentError('Source changed during apply. Saved work and partial application are retained for explicit review.', 409);
        const target = resolve(source, next.path); mkdirSync(dirname(target), { recursive: true });
        writeDurableFile(target, next.bytes.toString('utf8')); chmodSync(target, receipt.files.find(value => value.path === next.path)!.mode);
      }
      this.authorize(input); receipt.status = 'applied'; writeDurableFile(this.receiptPath(plan.job), JSON.stringify(receipt));
      return projectReviewSchema.parse({ ...plan.view, applied: true, canApply: false });
    } finally { if (fd !== undefined) { closeSync(fd); unlinkSync(lock); } }
  }
}
