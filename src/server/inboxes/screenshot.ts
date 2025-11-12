import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
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

const inbox = new Map<string, ScreenshotPayload>();
const SCREENSHOT_ROOT = process.env.CANVAS_AGENT_SCREENSHOT_DIR || join(process.cwd(), '.present', 'screenshots');

function sanitize(segment: string) {
  return segment.replace(/[^a-zA-Z0-9_-]/g, '_');
}

function ensureDir(sessionId?: string) {
  try {
    mkdirSync(SCREENSHOT_ROOT, { recursive: true });
    if (sessionId) {
      mkdirSync(join(SCREENSHOT_ROOT, sanitize(sessionId)), { recursive: true });
    }
  } catch {
    // best-effort; if mkdir fails we still keep the in-memory entry
  }
}

function filePath(sessionId: string, requestId: string) {
  return join(SCREENSHOT_ROOT, sanitize(sessionId), `${sanitize(requestId)}.json`);
}

function persist(payload: ScreenshotPayload) {
  if (!payload.sessionId || !payload.requestId) return;
  ensureDir(payload.sessionId);
  try {
    writeFileSync(filePath(payload.sessionId, payload.requestId), JSON.stringify(payload));
  } catch {
    // ignore disk errors; in-memory cache still works for this process
  }
}

function readPersisted(sessionId: string, requestId: string): ScreenshotPayload | null {
  const file = filePath(sessionId, requestId);
  if (!existsSync(file)) return null;
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as ScreenshotPayload;
    return parsed;
  } catch {
    return null;
  } finally {
    try {
      rmSync(file, { force: true });
    } catch {}
  }
}

export function storeScreenshot(payload: ScreenshotPayload) {
  const key = `${payload.sessionId}::${payload.requestId}`;
  inbox.set(key, payload);
  persist(payload);
}

export function takeScreenshot(sessionId: string, requestId: string): ScreenshotPayload | null {
  const key = `${sessionId}::${requestId}`;
  const payload = inbox.get(key);
  if (payload) {
    inbox.delete(key);
    return payload;
  }
  const persisted = readPersisted(sessionId, requestId);
  return persisted;
}

export function clearScreenshots() {
  inbox.clear();
  try {
    rmSync(SCREENSHOT_ROOT, { recursive: true, force: true });
  } catch {}
}


