import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
const inbox = new Map();
const SCREENSHOT_ROOT = process.env.CANVAS_AGENT_SCREENSHOT_DIR || join(process.cwd(), '.present', 'screenshots');
function sanitize(segment) {
    return segment.replace(/[^a-zA-Z0-9_-]/g, '_');
}
function ensureDir(sessionId) {
    try {
        mkdirSync(SCREENSHOT_ROOT, { recursive: true });
        if (sessionId) {
            mkdirSync(join(SCREENSHOT_ROOT, sanitize(sessionId)), { recursive: true });
        }
    }
    catch {
        // best-effort; if mkdir fails we still keep the in-memory entry
    }
}
function filePath(sessionId, requestId) {
    return join(SCREENSHOT_ROOT, sanitize(sessionId), `${sanitize(requestId)}.json`);
}
function persist(payload) {
    if (!payload.sessionId || !payload.requestId)
        return;
    ensureDir(payload.sessionId);
    try {
        writeFileSync(filePath(payload.sessionId, payload.requestId), JSON.stringify(payload));
    }
    catch {
        // ignore disk errors; in-memory cache still works for this process
    }
}
function readPersisted(sessionId, requestId) {
    const file = filePath(sessionId, requestId);
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
export function storeScreenshot(payload) {
    const key = `${payload.sessionId}::${payload.requestId}`;
    inbox.set(key, payload);
    persist(payload);
}
export function takeScreenshot(sessionId, requestId) {
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
    }
    catch { }
}
//# sourceMappingURL=screenshot.js.map