import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';

type AckRecord = {
  seq: number;
  clientId: string;
  ts: number;
};

const inbox = new Map<string, Map<number, AckRecord>>();
const ACK_ROOT = process.env.CANVAS_AGENT_ACK_DIR || join(process.cwd(), '.present', 'acks');

function sanitizeSegment(segment: string) {
  return segment.replace(/[^a-zA-Z0-9_-]/g, '_');
}

function ensureAckDir(sessionId?: string) {
  try {
    mkdirSync(ACK_ROOT, { recursive: true });
    if (sessionId) {
      mkdirSync(join(ACK_ROOT, sanitizeSegment(sessionId)), { recursive: true });
    }
  } catch {
    // best-effort; fall back to in-memory cache if mkdir fails
  }
}

function persistAck(sessionId: string, seq: number, record: AckRecord) {
  ensureAckDir(sessionId);
  try {
    const file = join(ACK_ROOT, sanitizeSegment(sessionId), `${seq}.json`);
    writeFileSync(file, JSON.stringify(record));
  } catch {
    // Ignore disk errors; we still retain the ack in-memory for this process
  }
}

function readPersistedAck(sessionId: string, seq: number): AckRecord | null {
  const file = join(ACK_ROOT, sanitizeSegment(sessionId), `${seq}.json`);
  if (!existsSync(file)) return null;
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as AckRecord;
    return parsed;
  } catch {
    return null;
  } finally {
    try {
      rmSync(file, { force: true });
    } catch {}
  }
}

export function recordAck(sessionId: string, seq: number, clientId: string, ts: number) {
  const session = inbox.get(sessionId) ?? new Map<number, AckRecord>();
  if (!session.has(seq)) {
    const record: AckRecord = { seq, clientId, ts };
    session.set(seq, record);
    inbox.set(sessionId, session);
    persistAck(sessionId, seq, record);
  }
}

export function getAck(sessionId: string, seq: number): AckRecord | null {
  const session = inbox.get(sessionId);
  if (session?.has(seq)) {
    return session.get(seq) ?? null;
  }
  const persisted = readPersistedAck(sessionId, seq);
  if (persisted) {
    const nextSession = session ?? new Map<number, AckRecord>();
    nextSession.set(seq, persisted);
    inbox.set(sessionId, nextSession);
    return persisted;
  }
  return null;
}

export function clearAcks() {
  inbox.clear();
  try {
    rmSync(ACK_ROOT, { recursive: true, force: true });
  } catch {}
}



