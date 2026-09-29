import { randomUUID } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, openSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/** Replace one private file atomically, with data and rename durable before returning. */
export function writeDurableFile(path: string, content: string) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    const file = openSync(temporary, 'wx', 0o600);
    try { writeFileSync(file, content); fsyncSync(file); } finally { closeSync(file); }
    renameSync(temporary, path);
    const directory = openSync(dirname(path), 'r');
    try { fsyncSync(directory); } finally { closeSync(directory); }
  } finally { if (existsSync(temporary)) unlinkSync(temporary); }
}
