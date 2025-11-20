const makeKey = (roomId, sessionId) => `${roomId}:${sessionId}`;
const latest = new Map();
const TTL_MS = 45000;
export async function saveViewportSelection(entry) {
    latest.set(makeKey(entry.roomId, entry.sessionId), entry);
}
export async function getLatestViewportSelection(roomId, sessionId) {
    const entry = latest.get(makeKey(roomId, sessionId));
    if (!entry)
        return null;
    if (Date.now() - entry.ts > TTL_MS) {
        latest.delete(makeKey(roomId, sessionId));
        return null;
    }
    return entry;
}
export function gcViewportEntries() {
    const now = Date.now();
    for (const [key, entry] of latest.entries()) {
        if (now - entry.ts > TTL_MS) {
            latest.delete(key);
        }
    }
}
//# sourceMappingURL=viewport.js.map