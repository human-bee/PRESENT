export type Viewport = { x: number; y: number; w: number; h: number };

export type ViewportEntry = {
  roomId: string;
  sessionId: string;
  viewport: Viewport;
  selection: string[];
  ts: number;
};

const makeKey = (roomId: string, sessionId: string) => `${roomId}:${sessionId}`;
const latest = new Map<string, ViewportEntry>();
const TTL_MS = 45_000;

export async function saveViewportSelection(entry: ViewportEntry) {
  latest.set(makeKey(entry.roomId, entry.sessionId), entry);
}

export async function getLatestViewportSelection(roomId: string, sessionId: string) {
  const entry = latest.get(makeKey(roomId, sessionId));
  if (!entry) return null;
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

