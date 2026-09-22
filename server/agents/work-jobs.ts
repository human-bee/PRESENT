import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getIndexAbove } from '@tldraw/utils';
import type { TLShape } from '@tldraw/tlschema';
import { makeObject } from '../../shared/room';
import { objectToShape, patchNativeShape, shapeIdForObject } from '../../shared/tldraw-adapter';
import { markdownArtifactHtml, storedWorkJobSchema, workArtifactSchema, workInstructions, workJobSchema, workOutputSchema, workRequestSchema, workSummary, type StoredWorkJob, type WorkJob } from '../../shared/work';
import { applyOperation, getCanvasRecords, getRoom, transactCanvas, type RoomStore } from '../room-store';
import { requireCanvasPage } from '../tldraw-operations';
import type { generateWithCodex } from './codex';
import { AgentError, agentModels } from './contract';
import { createRunWorkspaceWork, type WorkspaceRunner } from './workspace-work';

type WorkStore = Pick<RoomStore, 'getRoom' | 'applyOperation' | 'transactCanvas'> & Partial<Pick<RoomStore, 'getCanvasRecords'>>;
type Options = { directory?: string; store?: WorkStore; run?: WorkspaceRunner; generate?: typeof generateWithCodex; now?: () => number; persist?: (path: string, content: string) => void };
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const activeStatus = (status: WorkJob['status']) => status === 'queued' || status === 'running';
const artifactId = (job: WorkJob) => `artifact-${job.jobId}`;
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const ownerOf = (value: unknown, fallback: string) => typeof value === 'string' ? value.slice(0, 200) : fallback;
const atomicWrite = (path: string, content: string) => { const temporary = `${path}.${randomUUID()}.tmp`; writeFileSync(temporary, content, { mode: 0o600 }); renameSync(temporary, path); };

/** Single local server job pool. The native room remains the only canvas authority. */
export class WorkJobs {
  private jobs = new Map<string, StoredWorkJob>();
  private heads = new Map<string, { jobId: string; createdAt: number }>();
  private running = new Map<string, { controller: AbortController; promise: Promise<void> }>();
  private queue: string[] = [];
  private closed = false;
  private directory: string;
  private store: WorkStore;
  private run: WorkspaceRunner;
  private now: () => number;
  private persist: (path: string, content: string) => void;
  constructor(options: Options = {}) {
    this.directory = options.directory ?? join(process.cwd(), '.data', 'work-jobs');
    this.store = options.store ?? { getRoom, getCanvasRecords, applyOperation, transactCanvas };
    this.now = options.now ?? Date.now; this.persist = options.persist ?? atomicWrite;
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    const generate = options.generate;
    this.run = options.run ?? (generate ? async (input, signal) => ({ output: await generate(input.prompt, signal, input.provider, { instructions: workInstructions, outputSchema: workOutputSchema }), execution: { boundary: 'local-workspace', continued: input.state.threadId !== null, commands: [], files: [] } }) : createRunWorkspaceWork({ directory: join(realpathSync(this.directory), 'workspaces') }));
    const files = readdirSync(this.directory).filter(name => /^[a-f0-9]{32}\.json$/.test(name));
    for (const file of files) {
      let job: StoredWorkJob | undefined; try { job = this.readSaved(file.slice(0, -5)); } catch { continue; } // Preserve unreadable files; other jobs remain usable.
      if (!job) continue;
      this.jobs.set(job.jobId, job);
      this.rememberHead(job);
      if (activeStatus(job.status)) {
        const room = this.store.getRoom(job.roomId), artifact = room.objects.find(object => object.id === artifactId(job));
        const card = room.objects.find(object => object.id === job.objectId), work = record(card?.data.work);
        if (job.output && artifact?.data.sourceJobId === job.jobId && artifact.data.commitToken === job.commitToken && work.jobId === job.jobId && work.status === 'completed' && Array.isArray(work.artifactIds) && work.artifactIds.includes(artifact.id)) { job.status = 'completed'; job.artifactIds = [artifact.id]; job.completedAt = typeof work.completedAt === 'number' ? work.completedAt : this.now(); job.error = null; }
        else { job.status = 'interrupted'; job.error = 'The server stopped before this job finished. Resume explicitly to continue.'; }
        this.save(job); this.publish(job);
      }
    }
    this.trimCache();
  }
  private readSaved(jobId: string): StoredWorkJob | undefined {
    if (!/^[a-f0-9]{32}$/.test(jobId)) return;
    const path = join(this.directory, `${jobId}.json`); if (!existsSync(path)) return;
    try { const raw = readFileSync(path, 'utf8'); if (raw.length > 100000) throw new Error(); const job = storedWorkJobSchema.parse(JSON.parse(raw)); if (job.jobId !== jobId) throw new Error(); return job; }
    catch { throw new AgentError('This saved work job could not be restored. Its file has been preserved.', 500); }
  }
  private trimCache() { for (const [id, job] of this.jobs) if (this.jobs.size > 500 && !activeStatus(job.status) && !this.running.has(id)) this.jobs.delete(id); }
  private rememberHead(job: StoredWorkJob) {
    const key = `${job.roomId}:${job.objectId}`, head = this.heads.get(key);
    if (!head || job.createdAt >= head.createdAt) this.heads.set(key, { jobId: job.jobId, createdAt: job.createdAt });
  }
  private save(job: StoredWorkJob) {
    this.persist(join(this.directory, `${job.jobId}.json`), JSON.stringify(storedWorkJobSchema.parse(job)));
  }
  private target(job: WorkJob) { return this.store.getRoom(job.roomId).objects.find(object => object.id === job.objectId); }
  private publish(job: StoredWorkJob) {
    const target = this.target(job);
    if (!target || record(target.data.work).jobId !== job.jobId) return;
    job.owner = ownerOf(target.data.owner, job.owner); job.title = target.title;
    this.store.applyOperation(job.roomId, { type: 'patch', id: job.objectId, patch: { data: { work: workSummary(job) } } }, `agent:${job.provider}`);
  }
  private require(roomId: string, jobId: string, actor?: string) {
    const job = this.jobs.get(jobId) ?? this.readSaved(jobId);
    if (!job || job.roomId !== roomId) throw new AgentError('That work job does not exist in this room.', 404);
    if (actor !== undefined && actor !== job.actor) throw new AgentError('Only this job’s initiating participant can cancel or resume it.', 403);
    this.jobs.set(jobId, job);
    return job;
  }
  get(roomId: string, jobId: string): WorkJob {
    const job = this.require(roomId, jobId), target = this.target(job);
    return structuredClone(workJobSchema.parse({ ...job, ...(target ? { title: target.title, owner: ownerOf(target.data.owner, job.owner) } : {}) }));
  }
  start(raw: unknown): WorkJob {
    const parsed = workRequestSchema.safeParse(raw);
    if (!parsed.success) throw new AgentError('Work needs a room, request ID, participant and deliverable request.', 400);
    if (this.closed) throw new AgentError('The work queue is stopping.', 503);
    const input = parsed.data, jobId = digest([input.roomId, input.requestId]).slice(0, 32), fingerprint = digest(input);
    const previous = this.jobs.get(jobId) ?? this.readSaved(jobId);
    if (previous) { if (previous.fingerprint !== fingerprint) throw new AgentError('This request ID belongs to different work.', 409); return this.get(input.roomId, jobId); }
    if (this.queue.length >= 100) throw new AgentError('The work queue is full.', 429);
    if (input.pageId) requireCanvasPage(this.store.getCanvasRecords ? this.store.getCanvasRecords(input.roomId) : getCanvasRecords(input.roomId), input.pageId);
    const existing = input.objectId ? this.store.getRoom(input.roomId).objects.find(object => object.id === input.objectId) : undefined;
    if (input.objectId && (existing?.kind !== 'widget' || existing.data.capability !== 'work')) throw new AgentError('Select the existing work card to start this job.', 409);
    const head = existing ? this.heads.get(`${input.roomId}:${existing.id}`) : undefined;
    const prior = head ? this.jobs.get(head.jobId) ?? this.readSaved(head.jobId) : undefined;
    if (prior && prior.actor !== input.actor) throw new AgentError('Only this card’s initiating participant can continue its local workspace.', 403);
    if (existing && (activeStatus(record(existing.data.work).status as WorkJob['status']) || (prior && (activeStatus(prior.status) || this.running.has(prior.jobId))))) throw new AgentError('This card already has active work.', 409);
    if (prior?.executionState && ['dispatching', 'running'].includes(prior.executionState.phase)) throw new AgentError('Resume the interrupted run before starting a follow-up in this workspace.', 409);
    const job: StoredWorkJob = { jobId, fingerprint, commitToken: randomUUID().replaceAll('-', ''), roomId: input.roomId, requestId: input.requestId, objectId: existing?.id ?? `work-${jobId}`, actor: input.actor, owner: ownerOf(existing?.data.owner, input.owner ?? input.actor), title: existing?.title ?? input.title, prompt: input.prompt, provider: input.provider, reasoning: input.reasoning, fast: input.fast, status: 'queued', attempt: 0, createdAt: this.now(), startedAt: null, completedAt: null, error: null, artifactIds: [] };
    job.executionState = { workspaceId: prior?.executionState?.workspaceId ?? digest([job.roomId, job.objectId]).slice(0, 32), threadId: prior?.executionState?.threadId ?? null, turnId: null, dispatchId: null, phase: 'ready', commands: [] };
    this.save(job); this.jobs.set(jobId, job); this.rememberHead(job);
    try {
      if (existing) this.store.applyOperation(job.roomId, { type: 'patch', id: job.objectId, patch: { data: { prompt: input.prompt, work: workSummary(job) } } }, input.actor);
      else {
        const card = { ...makeObject('widget', input.actor, input.position, { capability: 'work', owner: job.owner, prompt: job.prompt, work: workSummary(job) }), id: job.objectId, title: job.title, w: 390, h: 390 };
        this.store.applyOperation(job.roomId, { type: 'put', object: card, ...(input.pageId ? { pageId: input.pageId } : {}) }, input.actor, { requestId: `work:${jobId}:card` });
      }
    } catch (error) { job.status = 'failed'; job.error = 'The work card could not be saved.'; this.save(job); throw error; }
    this.queue.push(jobId); queueMicrotask(() => this.drain()); return this.get(job.roomId, jobId);
  }
  cancel(roomId: string, jobId: string, actor: string): WorkJob {
    const job = this.require(roomId, jobId, actor);
    if (activeStatus(job.status)) {
      job.status = 'cancelled'; job.completedAt = this.now(); job.error = null;
      this.queue = this.queue.filter(id => id !== jobId); this.running.get(jobId)?.controller.abort(); this.publish(job); this.save(job);
    }
    return this.get(roomId, jobId);
  }
  resume(roomId: string, jobId: string, actor: string): WorkJob {
    const job = this.require(roomId, jobId, actor);
    if (this.closed) throw new AgentError('The work queue is stopping.', 503);
    if (activeStatus(job.status) || job.status === 'completed') return this.get(roomId, jobId);
    if (this.running.has(jobId)) throw new AgentError('Cancellation is still finishing. Try again shortly.', 409);
    if (record(this.target(job)?.data.work).jobId !== jobId || this.heads.get(`${roomId}:${job.objectId}`)?.jobId !== jobId) throw new AgentError('The original work card is missing or now belongs to another job.', 409);
    if (job.attempt >= 100 || this.queue.length >= 100) throw new AgentError('This work cannot be queued again yet.', 429);
    const next = { ...job, status: 'queued' as const, error: null, completedAt: null }; this.save(next); Object.assign(job, next);
    this.queue.push(jobId); queueMicrotask(() => this.drain()); this.publish(job); return this.get(roomId, jobId);
  }
  private drain() {
    while (!this.closed && this.running.size < 2 && this.queue.length) {
      const id = this.queue.shift(), job = id ? this.jobs.get(id) : undefined;
      if (job?.status !== 'queued') continue;
      const controller = new AbortController();
      const promise = Promise.resolve().then(() => this.execute(job, controller)).finally(() => { this.running.delete(job.jobId); this.trimCache(); this.drain(); });
      this.running.set(job.jobId, { controller, promise }); void promise.catch(() => {});
    }
  }
  private complete(job: StoredWorkJob) {
    const output = job.output; if (!output) throw new AgentError('No work artifact was generated.');
    const finished = { ...job, status: 'completed' as const, completedAt: this.now(), error: null, artifactIds: [artifactId(job)] };
    this.store.transactCanvas(job.roomId, { jobId: job.jobId, output }, `agent:${job.provider}`, records => {
      const target = records.find((record): record is TLShape => record.typeName === 'shape' && record.id === shapeIdForObject(job.objectId));
      if (target?.type !== 'present-widget' || record(target.props.data.work).jobId !== job.jobId) throw new AgentError('The original work card changed or was removed. The artifact was not committed.', 409);
      finished.owner = ownerOf(target.props.data.owner, job.owner); finished.title = target.props.title;
      const data = { capability: 'artifact', sourceJobId: job.jobId, requestId: job.requestId, commitToken: job.commitToken, humanOwner: finished.owner, format: output.format, provider: job.provider, model: agentModels[job.provider], generatedAt: finished.completedAt, completionBoundary: 'artifact-created', ...(job.execution ? { execution: job.execution } : {}), html: output.format === 'html' ? output.body : markdownArtifactHtml, state: output.format === 'markdown' ? { markdown: output.body } : {} };
      const artifact = { ...makeObject('widget', `agent:${job.provider}`, { x: target.x + target.props.w + 40, y: target.y }, data), id: artifactId(job), title: output.title, w: 640, h: 500 };
      const indices = records.filter((record): record is TLShape => record.typeName === 'shape' && record.parentId === target.parentId).map(shape => shape.index).sort();
      return { creates: [objectToShape(artifact, { parentId: target.parentId, index: getIndexAbove(indices.at(-1)) })], updates: [patchNativeShape(target, { data: { work: workSummary(finished) } })] };
    }, { requestId: `work:${job.jobId}:complete` });
    Object.assign(job, finished); this.save(job);
  }
  private async execute(job: StoredWorkJob, controller: AbortController) {
    const timer = setTimeout(() => controller.abort(), job.provider === 'spark' ? 90000 : 180000);
    try {
      if (this.closed || job.status !== 'queued') return;
      if (record(this.target(job)?.data.work).jobId !== job.jobId) throw new AgentError('The original work card is no longer available.', 409);
      job.status = 'running'; job.attempt++; job.startedAt = this.now(); this.publish(job); this.save(job);
      if (!job.output) {
        const state = job.executionState ?? { workspaceId: digest([job.roomId, job.objectId]).slice(0, 32), threadId: null, turnId: null, dispatchId: null, phase: 'ready' as const, commands: [] };
        const result = await this.run({ prompt: JSON.stringify({ deliverable: job.prompt, sourceCard: { id: job.objectId, title: job.title, humanOwner: job.owner }, contextTrust: 'untrusted-meeting-data' }), provider: job.provider, reasoning: job.reasoning, fast: job.fast, jobId: job.jobId, attempt: job.attempt, state, onCheckpoint: next => { job.executionState = next; job.execution = { boundary: 'local-workspace', continued: state.threadId !== null, commands: next.commands, files: [] }; this.save(job); if (activeStatus(job.status)) this.publish(job); } }, controller.signal);
        const output = result.output;
        if (job.status !== 'running' || this.closed) return;
        if (controller.signal.aborted) throw new AgentError('Work generation timed out.', 504);
        if (Buffer.byteLength(output) > 24000) throw new AgentError('The generated artifact was too large. Narrow the request and try again.');
        job.output = workArtifactSchema.parse(JSON.parse(output)); job.execution = result.execution; this.save(job);
      }
      if (!controller.signal.aborted && job.status === 'running' && !this.closed) this.complete(job);
    } catch (error) {
      if (job.status === 'completed' || !activeStatus(job.status) || this.closed) return;
      job.status = 'failed'; job.completedAt = this.now(); job.error = controller.signal.aborted ? 'This work timed out. Resume explicitly to try again.' : (error instanceof AgentError ? error.message : 'The agent did not return a valid artifact.').slice(0, 500);
      this.publish(job); this.save(job);
    } finally { clearTimeout(timer); }
  }
  async settled() { do { await Promise.resolve(); await Promise.allSettled([...this.running.values()].map(entry => entry.promise)); } while (this.queue.length || this.running.size); }
  close() {
    this.closed = true; this.queue = [];
    for (const job of this.jobs.values()) if (activeStatus(job.status)) { job.status = 'interrupted'; job.error = 'The server stopped before this job finished. Resume explicitly to continue.'; this.running.get(job.jobId)?.controller.abort(); this.publish(job); this.save(job); }
  }
}
let jobs: WorkJobs | undefined;
const service = () => jobs ??= new WorkJobs();
export const startWork = (input: unknown) => service().start(input);
export const getWork = (roomId: string, jobId: string) => service().get(roomId, jobId);
export const cancelWork = (roomId: string, jobId: string, actor: string) => service().cancel(roomId, jobId, actor);
export const resumeWork = (roomId: string, jobId: string, actor: string) => service().resume(roomId, jobId, actor);
export const closeWorkJobs = () => { jobs?.close(); jobs = undefined; };
