import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { lockAccessDirectory } from '../server/access/process-lock';

test('an abrupt owner crash releases the writer lock, while a live second writer is denied', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'present-lock-crash-'));
  const source = `import { lockAccessDirectory } from './server/access/process-lock.ts'; lockAccessDirectory(process.argv[1]); console.log('locked'); setInterval(() => {}, 1000);`;
  const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', source, directory], { stdio: ['ignore', 'pipe', 'pipe'] });
  const exited = once(child, 'exit');
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Lock owner did not start')), 5000);
      child.stdout.once('data', data => { clearTimeout(timer); assert.match(data.toString(), /locked/); resolve(); });
      child.once('error', error => { clearTimeout(timer); reject(error); });
    });
    assert.throws(() => lockAccessDirectory(directory), /Another server/);
    child.kill('SIGKILL'); await exited;
    const release = lockAccessDirectory(directory); release(); release();
    lockAccessDirectory(directory)();
  } finally { if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await exited; } rmSync(directory, { recursive: true, force: true }); }
});

test('a legacy writer fence is preserved until an operator finishes the upgrade', () => {
  const directory = mkdtempSync(join(tmpdir(), 'present-lock-legacy-'));
  try { writeFileSync(join(directory, 'access.lock'), ''); assert.throws(() => lockAccessDirectory(directory), /Legacy access lock/); }
  finally { rmSync(directory, { recursive: true, force: true }); }
});
