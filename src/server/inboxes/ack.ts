import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'fs';
import { writeFile } from 'fs/promises';
import { join } from 'path';

type AckRecord = {
  seq: number;
  clientId: string;
  ts: number;
};

type AckEnvelope = {
  record: AckRecord;
  storedAt: number;
};

const inbox = new Map<string, Map<number, AckEnvelope>>();
const ACK_ROOT = process.env.CANVAS_AGENT_ACK_DIR || join(process.cwd(), '.present', 'acks');
const ACK_TTL_MS = Math.max(
  60_000,
  Number(process.env.CANVAS_ACK_RETENTION_MS ?? 24 * 60 * 60 * 1000),
);
let lastCleanupAt = 0;

function sanitizeSegment(segment: string) {
  return segment.replace(/[^a-zA-Z0-9_-]/g, '_');
}

function ensureAckDir(sessionId?: string) {
  try {
    mkdirSync(ACK_ROOT, { recursive: true });
    if (sessionId) {
      mkdirSync(join(ACK_ROOT, sanitizeSegment(sessionId)), { recursive: true });
    }
  } catch {}
}

function filePath(sessionId: string, seq: number) {
  return join(ACK_ROOT, sanitizeSegment(sessionId), `${seq}.json`);
}

function isExpired(storedAt: number, now = Date.now()) {
  return now - storedAt > ACK_TTL_MS;
}

function persistAck(sessionId: string, seq: number, envelope: AckEnvelope) {
  ensureAckDir(sessionId);
  void writeFile(filePath(sessionId, seq), JSON.stringify(envelope)).catch(() => {
    // in-memory ack stays available if disk write fails
  });
}

function readPersistedAck(sessionId: string, seq: number): AckEnvelope | null {
  const file = filePath(sessionId, seq);
  if (!existsSync(file)) return null;
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as AckEnvelope | AckRecord;
    if ('record' in parsed && parsed.record && typeof parsed.storedAt === 'number') {
      return parsed as AckEnvelope;
    }
    return { record: parsed as AckRecord, storedAt: Date.now() };
  } catch {
    return null;
  } finally {
    try {
      rmSync(file, { force: true });
    } catch {}
  }
}

function pruneInMemory(now = Date.now()) {
  for (const [sessionId, entries] of inbox) {
    for (const [seq, envelope] of entries) {
      if (isExpired(envelope.storedAt, now)) {
        entries.delete(seq);
      }
    }
    if (entries.size === 0) {
      inbox.delete(sessionId);
    }
  }
}

function prunePersisted(now = Date.now()) {
  if (!existsSync(ACK_ROOT)) return;
  try {
    const sessions = readdirSync(ACK_ROOT);
    for (const sessionDir of sessions) {
      const dirPath = join(ACK_ROOT, sessionDir);
      const files = readdirSync(dirPath);
      for (const file of files) {
        const path = join(dirPath, file);
        try {
          const stats = statSync(path);
          if (isExpired(stats.mtimeMs, now)) {
            rmSync(path, { force: true });
          }
        } catch {}
      }
    }
  } catch {}
}

function maybeCleanup() {
  const now = Date.now();
  if (now - lastCleanupAt < 60_000) return;
  lastCleanupAt = now;
  pruneInMemory(now);
  prunePersisted(now);
}

export function recordAck(sessionId: string, seq: number, clientId: string, ts: number) {
  const envelope: AckEnvelope = {
    record: { seq, clientId, ts },
    storedAt: Date.now(),
  };
  const session = inbox.get(sessionId) ?? new Map<number, AckEnvelope>();
  if (!session.has(seq)) {
    session.set(seq, envelope);
    inbox.set(sessionId, session);
    persistAck(sessionId, seq, envelope);
  }
  maybeCleanup();
}

export function getAck(sessionId: string, seq: number): AckRecord | null {
  maybeCleanup();
  const session = inbox.get(sessionId);
  const inMemory = session?.get(seq);
  if (inMemory) {
    if (isExpired(inMemory.storedAt)) {
      session?.delete(seq);
      return null;
    }
    return inMemory.record;
  }

  const persisted = readPersistedAck(sessionId, seq);
  if (!persisted || isExpired(persisted.storedAt)) {
    return null;
  }
  const nextSession = session ?? new Map<number, AckEnvelope>();
  nextSession.set(seq, persisted);
  inbox.set(sessionId, nextSession);
  return persisted.record;
}

export function clearAcks() {
  inbox.clear();
  try {
    rmSync(ACK_ROOT, { recursive: true, force: true });
  } catch {}
}
