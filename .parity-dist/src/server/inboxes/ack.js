import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
const inbox = new Map();
const ACK_ROOT = process.env.CANVAS_AGENT_ACK_DIR || join(process.cwd(), '.present', 'acks');
function sanitizeSegment(segment) {
    return segment.replace(/[^a-zA-Z0-9_-]/g, '_');
}
function ensureAckDir(sessionId) {
    try {
        mkdirSync(ACK_ROOT, { recursive: true });
        if (sessionId) {
            mkdirSync(join(ACK_ROOT, sanitizeSegment(sessionId)), { recursive: true });
        }
    }
    catch {
        // best-effort; fall back to in-memory cache if mkdir fails
    }
}
function persistAck(sessionId, seq, record) {
    ensureAckDir(sessionId);
    try {
        const file = join(ACK_ROOT, sanitizeSegment(sessionId), `${seq}.json`);
        writeFileSync(file, JSON.stringify(record));
    }
    catch {
        // Ignore disk errors; we still retain the ack in-memory for this process
    }
}
function readPersistedAck(sessionId, seq) {
    const file = join(ACK_ROOT, sanitizeSegment(sessionId), `${seq}.json`);
    if (!existsSync(file))
        return null;
    try {
        const parsed = JSON.parse(readFileSync(file, 'utf8'));
        return parsed;
    }
    catch {
        return null;
    }
    finally {
        try {
            rmSync(file, { force: true });
        }
        catch { }
    }
}
export function recordAck(sessionId, seq, clientId, ts) {
    const session = inbox.get(sessionId) ?? new Map();
    if (!session.has(seq)) {
        const record = { seq, clientId, ts };
        session.set(seq, record);
        inbox.set(sessionId, session);
        persistAck(sessionId, seq, record);
    }
}
export function getAck(sessionId, seq) {
    const session = inbox.get(sessionId);
    if (session?.has(seq)) {
        return session.get(seq) ?? null;
    }
    const persisted = readPersistedAck(sessionId, seq);
    if (persisted) {
        const nextSession = session ?? new Map();
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
    }
    catch { }
}
//# sourceMappingURL=ack.js.map