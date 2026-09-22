import { appendFileSync, mkdirSync, statSync, renameSync } from 'node:fs';
import { join } from 'node:path';
/** Bounded local diagnostics. Never record prompts, screenshots, credentials or model output. */
export function requestTrace(entry: { roomId: string; requestId: string; stage: string; provider: string; elapsedMs?: number; error?: string; nodes?: number; tracks?: number }) {
  try {
    const dir = join(process.cwd(), 'logs'); mkdirSync(dir, { recursive: true });
    const file = join(dir, 'canvas-requests.jsonl');
    try { if (statSync(file).size > 5_000_000) renameSync(file, `${file}.previous`); } catch { /* No previous log. */ }
    appendFileSync(file, JSON.stringify({ ...entry, error: entry.error?.slice(0, 2000), at: new Date().toISOString() }) + '\n', { mode: 0o600 });
  } catch { /* Diagnostics must not prevent canvas work. */ }
}
