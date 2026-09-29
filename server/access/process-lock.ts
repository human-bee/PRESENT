import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

/** OS-backed exclusive lock: a crash releases it without guessing whether a PID is alive. */
export function lockAccessDirectory(directory: string): () => void {
  // An older binary may still own the legacy sentinel. Never bypass that fence.
  if (existsSync(join(directory, 'access.lock'))) throw new Error('Legacy access lock exists. Stop the previous server and verify it released its lock before upgrading.');
  const database = new DatabaseSync(join(directory, 'access-writer.sqlite'), { timeout: 0 });
  try { database.exec('PRAGMA journal_mode=DELETE; BEGIN EXCLUSIVE;'); }
  catch { database.close(); throw new Error('Another server owns this access directory. Only one writer is supported.'); }
  let released = false;
  return () => { if (released) return; released = true; try { database.exec('ROLLBACK;'); } finally { database.close(); } };
}
