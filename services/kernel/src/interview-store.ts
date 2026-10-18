import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import * as Y from 'yjs';
import type { LatestBriefUpdate, PipelineTrace } from '@present/contracts/interview-studio';
import { briefFields, type BriefProfile, type InterviewEnvelope, type InterviewRole } from '@present/contracts/interviews';
import { decodeState, encodeState, readBrief } from '@/lib/interviews/document';
import { createBriefDocument } from '@/lib/interviews/seed';

export class InterviewError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export type InterviewRecord = {
  latestUpdate?: LatestBriefUpdate;
  pipeline?: PipelineTrace[];
  id: string;
  recruiterHash: string;
  candidateToken: string;
  example: boolean;
  replay?: boolean;
  replayMode?: 'scripted' | 'audio';
  encodedState: string;
  revision: string;
  approvals: Partial<Record<InterviewRole, string>>;
  collaborators: InterviewEnvelope['collaborators'];
  notesConsent: Record<InterviewRole, boolean>;
  processed: Record<string, { startedAt: number; complete: boolean }>;
};
let lock: Promise<unknown> = Promise.resolve();
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const storePath = () => process.env.PRESENT_INTERVIEW_STORE_PATH
  || path.join(process.cwd(), '.present', 'interviews.json');
const contentRevision = (doc: Y.Doc) => {
  const { fields, sources, studio } = readBrief(doc);
  const orderedSources = Object.fromEntries(briefFields.map((field) => [field, sources[field] ?? null]));
  const materials = studio.assets.filter((item) => item.included).map(({ x: _x, y: _y, createdAt: _at, createdBy: _by, ...asset }) => asset);
  return digest(JSON.stringify({ fields, sources: orderedSources, materials }));
};

export function withInterviewStore<T>(operation: (records: Record<string, InterviewRecord>) => T): Promise<T> {
  const task = lock.then(() => {
    const file = storePath();
    const records = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, InterviewRecord> : {};
    const result = operation(records);
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const temporary = `${file}.${randomUUID()}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(records), { mode: 0o600 });
    fs.renameSync(temporary, file);
    return result;
  });
  lock = task.catch(() => undefined);
  return task;
}

export function authorizeInterview(record: InterviewRecord | undefined, token: string): InterviewRole {
  if (!record || !token || token.length > 200) throw new InterviewError(404, 'This brief is unavailable. Check your invitation link.');
  const hash = Buffer.from(digest(token));
  if (timingSafeEqual(hash, Buffer.from(record.recruiterHash))) return 'recruiter';
  if (timingSafeEqual(hash, Buffer.from(digest(record.candidateToken)))) return 'candidate';
  throw new InterviewError(404, 'This brief is unavailable. Check your invitation link.');
}

export function interviewEnvelope(record: InterviewRecord, role: InterviewRole): InterviewEnvelope {
  return {
    latestUpdate: record.latestUpdate, pipeline: record.pipeline ?? [],
    id: record.id, encodedState: record.encodedState, role, example: record.example, replay: Boolean(record.replay),
    replayMode: record.replayMode || 'scripted',
    revision: record.revision, approvals: record.approvals, notesConsent: record.notesConsent,
    collaborators: record.collaborators.filter((member) => Date.now() - member.seenAt < 15000),
    ...(role === 'recruiter' ? { candidateToken: record.candidateToken } : {}),
    agentAvailable: Boolean(process.env.OPENAI_API_KEY),
    callAvailable: Boolean(process.env.LIVEKIT_URL && process.env.LIVEKIT_API_KEY && process.env.LIVEKIT_API_SECRET),
  };
}

export function loadInterviewDocument(record: InterviewRecord) {
  const doc = new Y.Doc();
  try { Y.applyUpdate(doc, decodeState(record.encodedState)); }
  catch { doc.destroy(); throw new InterviewError(400, 'The document update is invalid.'); }
  return doc;
}

export function saveInterviewDocument(record: InterviewRecord, doc: Y.Doc, actor: 'recruiter' | 'candidate' | 'agent' = 'recruiter') {
  const snapshot = readBrief(doc);
  const previous = loadInterviewDocument(record);
  const before = readBrief(previous); previous.destroy();
  const changed = briefFields.filter((field) => before.fields[field] !== snapshot.fields[field]);
  const field = changed.at(-1);
  if (Object.values(snapshot.fields).some((value) => value.length > 20000)
    || snapshot.transcripts.length > 1000 || snapshot.suggestions.length > 1000 || snapshot.studio.assets.length > 40) {
    throw new InterviewError(413, 'This brief has reached its document limit.');
  }
  const encoded = encodeState(doc);
  if (encoded.length > 900000) throw new InterviewError(413, 'This brief has reached its document limit.');
  const revision = contentRevision(doc);
  if (field) record.latestUpdate = { field, text: snapshot.fields[field].slice(0, 1600), timestamp: Date.now(), actor };
  else if (record.revision !== revision && JSON.stringify(before.studio.assets.filter((item) => item.included)) !== JSON.stringify(snapshot.studio.assets.filter((item) => item.included))) {
    const material = snapshot.studio.assets.find((item) => item.included && JSON.stringify(item) !== JSON.stringify(before.studio.assets.find((previous) => previous.id === item.id)));
    const removed = before.studio.assets.find((item) => item.included && !snapshot.studio.assets.some((next) => next.id === item.id && next.included));
    record.latestUpdate = { field: material?.field || removed?.field || 'work', text: material ? `Work sample: ${material.title}` : removed ? `Removed ${removed.title} from the brief.` : 'Updated the included work samples.', timestamp: Date.now(), actor };
  }
  if (record.revision !== revision) record.approvals = {};
  record.revision = revision;
  record.encodedState = encoded;
}

export async function createInterview(profile: BriefProfile, example: boolean, replay = false, replayMode: 'scripted' | 'audio' = 'scripted') {
  const doc = createBriefDocument(profile, example);
  const token = randomBytes(32).toString('base64url');
  const record: InterviewRecord = {
    id: randomUUID(), recruiterHash: digest(token), candidateToken: randomBytes(32).toString('base64url'),
    example, replay, replayMode, encodedState: encodeState(doc), revision: contentRevision(doc), approvals: {},
    collaborators: [], notesConsent: { recruiter: false, candidate: false }, processed: {},
  };
  doc.destroy();
  await withInterviewStore((records) => { records[record.id] = record; });
  return { token, interview: interviewEnvelope(record, 'recruiter') };
}

export function accessInterview<T>(id: string, token: string, operation: (record: InterviewRecord, role: InterviewRole) => T) {
  return withInterviewStore((records) => {
    const record = records[id];
    const role = authorizeInterview(record, token);
    return operation(record, role);
  });
}
