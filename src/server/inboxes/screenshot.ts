import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'fs';
import { writeFile } from 'fs/promises';
import { join } from 'path';

export type ScreenshotPayload = {
  sessionId: string;
  requestId: string;
  image: { mime: string; dataUrl: string; bytes: number; width?: number; height?: number };
  bounds: { x: number; y: number; w: number; h: number };
  viewport: { x: number; y: number; w: number; h: number };
  selection: string[];
  docVersion: string;
};

type ScreenshotRecord = {
  payload: ScreenshotPayload;
  storedAt: number;
};

const inbox = new Map<string, ScreenshotRecord>();
const SCREENSHOT_ROOT =
  process.env.CANVAS_AGENT_SCREENSHOT_DIR || join(process.cwd(), '.present', 'screenshots');
const SCREENSHOT_TTL_MS = Math.max(
  60_000,
  Number(process.env.CANVAS_SCREENSHOT_RETENTION_MS ?? 24 * 60 * 60 * 1000),
);
let lastCleanupAt = 0;

function sanitize(segment: string) {
  return segment.replace(/[^a-zA-Z0-9_-]/g, '_');
}

function ensureDir(sessionId?: string) {
  try {
    mkdirSync(SCREENSHOT_ROOT, { recursive: true });
    if (sessionId) {
      mkdirSync(join(SCREENSHOT_ROOT, sanitize(sessionId)), { recursive: true });
    }
  } catch {}
}

function filePath(sessionId: string, requestId: string) {
  return join(SCREENSHOT_ROOT, sanitize(sessionId), `${sanitize(requestId)}.json`);
}

function persist(record: ScreenshotRecord) {
  if (!record.payload.sessionId || !record.payload.requestId) return;
  ensureDir(record.payload.sessionId);
  void writeFile(filePath(record.payload.sessionId, record.payload.requestId), JSON.stringify(record)).catch(
    () => {
      // in-memory record remains available even if disk write fails
    },
  );
}

function isExpired(storedAt: number, now = Date.now()) {
  return now - storedAt > SCREENSHOT_TTL_MS;
}

function readPersisted(sessionId: string, requestId: string): ScreenshotRecord | null {
  const file = filePath(sessionId, requestId);
  if (!existsSync(file)) return null;
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as ScreenshotRecord | ScreenshotPayload;
    if ('payload' in parsed && parsed.payload && typeof parsed.storedAt === 'number') {
      return parsed as ScreenshotRecord;
    }
    return { payload: parsed as ScreenshotPayload, storedAt: Date.now() };
  } catch {
    return null;
  } finally {
    try {
      rmSync(file, { force: true });
    } catch {}
  }
}

function pruneInMemory(now = Date.now()) {
  for (const [key, record] of inbox) {
    if (isExpired(record.storedAt, now)) {
      inbox.delete(key);
    }
  }
}

function prunePersisted(now = Date.now()) {
  if (!existsSync(SCREENSHOT_ROOT)) return;
  try {
    const sessions = readdirSync(SCREENSHOT_ROOT);
    for (const sessionDir of sessions) {
      const dirPath = join(SCREENSHOT_ROOT, sessionDir);
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

export function storeScreenshot(payload: ScreenshotPayload) {
  const key = `${payload.sessionId}::${payload.requestId}`;
  const record: ScreenshotRecord = { payload, storedAt: Date.now() };
  inbox.set(key, record);
  persist(record);
  maybeCleanup();
}

export function takeScreenshot(sessionId: string, requestId: string): ScreenshotPayload | null {
  maybeCleanup();
  const key = `${sessionId}::${requestId}`;
  const record = inbox.get(key);
  if (record) {
    inbox.delete(key);
    if (isExpired(record.storedAt)) return null;
    return record.payload;
  }

  const persisted = readPersisted(sessionId, requestId);
  if (!persisted) return null;
  if (isExpired(persisted.storedAt)) return null;
  return persisted.payload;
}

export function clearScreenshots() {
  inbox.clear();
  try {
    rmSync(SCREENSHOT_ROOT, { recursive: true, force: true });
  } catch {}
}
