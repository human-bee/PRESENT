import { randomUUID } from 'node:crypto';
import { closeSync, constants, fsyncSync, linkSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, unlinkSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { join, resolve } from 'node:path';

export const WRITER_LEASE = '.present-writer-lease';
type Lease = { version: 1; pid: number; host: string; token: string; purpose: 'server' | 'backup'; at: string };
function exclusive(file: string, bytes: string) {
  const fd = openSync(file, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { writeFileSync(fd, bytes); fsyncSync(fd); } finally { closeSync(fd); }
}
function readLease(file: string): Lease {
  const stat = lstatSync(file);
  if (!stat.isFile() || stat.size > 1024) throw new Error('Invalid writer lease; preserve it for operator inspection.');
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const lease = JSON.parse(readFileSync(fd, 'utf8'));
    if (lease.version !== 1 || !Number.isSafeInteger(lease.pid) || lease.pid < 1 || lease.host !== hostname() || typeof lease.token !== 'string' || !/^[a-f0-9-]{36}$/.test(lease.token) || !['server', 'backup'].includes(lease.purpose)) throw new Error('Invalid or foreign-host writer lease; preserve it for operator inspection.');
    return lease;
  } finally { closeSync(fd); }
}
function processAlive(pid: number) {
  try { process.kill(pid, 0); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false; return true; }
}

/** Append-only, atomic hard-link publication avoids deleting a successor's lease.
 * A dead PID is reclaimed by the next generation; old receipts remain intact.
 * PID reuse/foreign hosts/unknown state fail closed. This is one-host ownership.
 */
export function acquireWriterLock(directory: string, purpose: Lease['purpose'] = 'server') {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (!lstatSync(directory).isDirectory() || lstatSync(directory).isSymbolicLink()) throw new Error('The data root must be a real directory.');
  const root = realpathSync(directory), folder = join(root, WRITER_LEASE);
  mkdirSync(folder, { recursive: true, mode: 0o700 });
  if (!lstatSync(folder).isDirectory() || lstatSync(folder).isSymbolicLink()) throw new Error('Invalid writer lease directory.');
  const lease: Lease = { version: 1, pid: process.pid, host: hostname(), token: randomUUID(), purpose, at: new Date().toISOString() };
  const candidate = join(folder, `candidate-${lease.token}`);
  exclusive(candidate, JSON.stringify(lease));
  let owned: string | undefined;
  try {
    for (let attempt = 0; attempt < 16; attempt++) {
      const files = readdirSync(folder);
      if (files.length > 4096) throw new Error('Writer lease history is full; stopped-service operator maintenance is required.');
      if (files.some(file => !/^(?:\d{8}\.json(?:\.released)?|candidate-[a-f0-9-]{36})$/.test(file))) throw new Error('Unknown writer lease entry; preserve it for inspection.');
      const generations = files.filter(file => /^\d{8}\.json$/.test(file)).sort();
      const last = generations.at(-1);
      if (last) {
        const current = readLease(join(folder, last));
        let released = false;
        if (files.includes(`${last}.released`)) {
          const release = readLease(join(folder, `${last}.released`));
          if (release.token !== current.token) throw new Error('Writer release identity does not match.');
          released = true;
        }
        if (!released && processAlive(current.pid)) throw new Error('A live writer owns this data directory. Stop it before continuing.');
      }
      const number = last ? Number(last.slice(0, 8)) + 1 : 0;
      if (number > 99_999_999) throw new Error('Writer lease generation exhausted.');
      const target = join(folder, `${String(number).padStart(8, '0')}.json`);
      try { linkSync(candidate, target); owned = target; break; }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    }
    if (!owned) throw new Error('Writer ownership changed repeatedly. Try again after stopping the service.');
  } finally { unlinkSync(candidate); }
  let released = false;
  return {
    root,
    release() {
      if (released) return;
      // Release is an immutable receipt, never an unlink of the shared lease.
      exclusive(`${owned}.released`, JSON.stringify(lease)); released = true;
    },
  };
}

export function assertOutsideDataRoot(root: string, path: string) {
  const target = resolve(path);
  if (target === root || target.startsWith(`${root}/`)) throw new Error('Key and archive paths must be outside the data root.');
}
