import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { setTimeout as pause } from 'node:timers/promises';
import { backupData, createBackupKey, restoreData } from '../server/operations/data-backup';
import { acquireWriterLock, WRITER_LEASE } from '../server/operations/writer-lock';

function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'present-backup-test-')));
  chmodSync(root, 0o700);
  const data = join(root, 'data'), key = join(root, 'operator.key'), archive = join(root, 'backup.present');
  mkdirSync(data, { mode: 0o700 });
  for (const folder of ['access', 'assets', 'tldraw', 'work-jobs', 'work-jobs/workspaces', 'work-jobs/workspaces/existing', 'work-jobs/workspaces/existing/files']) mkdirSync(join(data, folder), { mode: 0o700 });
  const files = { 'access/grants.json': Buffer.from('{"revoked":true,"role":"viewer"}'), 'assets/pixels.png': Buffer.from([0, 255, 23, 80]), 'tldraw/room.json': Buffer.from('{"correction":"human retained"}'), 'work-jobs/saved.json': Buffer.from('{"threadId":"existing","status":"interrupted"}'), 'work-jobs/workspaces/existing/files/main.ts': Buffer.from('export const retained = true;\n') };
  for (const [path, bytes] of Object.entries(files)) writeFileSync(join(data, path), bytes, { mode: 0o600 });
  createBackupKey(key);
  return { root, data, key, archive, files, close: () => rmSync(root, { recursive: true, force: true }) };
}

test('encrypted stopped-data roundtrip retains exact private grant, asset, room, job and workspace bytes', () => {
  const f = fixture();
  try {
    const before = backupData(f.data, f.archive, f.key), restored = join(f.root, 'restored');
    assert.equal(lstatSync(f.key).mode & 0o777, 0o600); assert.equal(lstatSync(f.archive).mode & 0o777, 0o600);
    assert.equal(readFileSync(f.archive).includes(Buffer.from('human retained')), false);
    const after = restoreData(f.archive, restored, f.key);
    assert.equal(before.manifestSha256, after.manifestSha256); assert.equal(after.files, 5);
    assert.equal(lstatSync(restored).mode & 0o777, 0o700);
    assert.equal(existsSync(join(restored, WRITER_LEASE)), false);
    for (const [path, bytes] of Object.entries(f.files)) { assert.deepEqual(readFileSync(join(restored, path)), bytes); assert.equal(lstatSync(join(restored, path)).mode & 0o077, 0); }
    const lease = acquireWriterLock(restored); lease.release();
    assert.throws(() => backupData(f.data, f.archive, f.key), /already exists/);
    assert.throws(() => createBackupKey(f.key));
    assert.throws(() => restoreData(f.archive, restored, f.key), /already exists/);
  } finally { f.close(); }
});

test('wrong key, tamper and preexisting dangling destination refuse without publishing data', () => {
  const f = fixture();
  try {
    backupData(f.data, f.archive, f.key);
    const wrong = join(f.root, 'wrong.key'); createBackupKey(wrong);
    const destination = join(f.root, 'unpublished');
    assert.throws(() => restoreData(f.archive, destination, wrong), /authentication failed/); assert.equal(existsSync(destination), false);
    const bytes = readFileSync(f.archive); bytes[bytes.length - 1] ^= 1; const altered = join(f.root, 'altered.present'); writeFileSync(altered, bytes, { mode: 0o600 });
    assert.throws(() => restoreData(altered, destination, f.key), /authentication failed/); assert.equal(existsSync(destination), false);
    symlinkSync('never-existing-target', destination);
    assert.throws(() => restoreData(f.archive, destination, f.key), /already exists/); assert.equal(lstatSync(destination).isSymbolicLink(), true);
    assert.equal(readdirSync(f.root).some(name => name.startsWith('.present-restore-')), false);
  } finally { f.close(); }
});

test('backup rejects symlinks, hardlinks, public keys and key/archive inside the data root', () => {
  const f = fixture();
  try {
    const linked = join(f.data, 'linked'); symlinkSync(f.key, linked);
    assert.throws(() => backupData(f.data, f.archive, f.key), /Symlinks/); rmSync(linked);
    linkSync(join(f.data, 'assets/pixels.png'), linked);
    assert.throws(() => backupData(f.data, f.archive, f.key), /link/); rmSync(linked);
    chmodSync(f.key, 0o644); assert.throws(() => backupData(f.data, f.archive, f.key), /private key/); chmodSync(f.key, 0o600);
    assert.throws(() => backupData(f.data, join(f.data, 'backup.present'), f.key), /outside/);
    const innerKey = join(f.data, 'inner.key'); createBackupKey(innerKey);
    assert.throws(() => backupData(f.data, f.archive, innerKey), /outside/);
    assert.equal(existsSync(f.archive), false);
  } finally { f.close(); }
});

test('authenticated malformed archives still reject traversal, missing parents, duplicate paths, false hashes and budgets', () => {
  const f = fixture();
  try {
    const bytes = Buffer.from('retained'), hash = createHash('sha256').update(bytes).digest('hex');
    const good = { version: 1, directories: [], files: [{ path: 'plain.txt', bytes: bytes.length, sha256: hash, executable: false, data: bytes.toString('base64') }], totalBytes: bytes.length };
    const invalid = [
      { ...good, files: [{ ...good.files[0], path: '../escaped.txt' }] },
      { ...good, files: [{ ...good.files[0], path: '/absolute.txt' }] },
      { ...good, files: [{ ...good.files[0], path: 'missing/file.txt' }] },
      { ...good, files: [good.files[0], good.files[0]] },
      { ...good, files: [{ ...good.files[0], sha256: '0'.repeat(64) }] },
      { ...good, files: [{ ...good.files[0], bytes: 64 * 1024 * 1024 + 1 }] },
      { ...good, directories: Array.from({ length: 2049 }, (_, index) => `directory-${index}`) },
      { ...good, totalBytes: 128 * 1024 * 1024 + 1 },
    ];
    for (const [index, manifest] of invalid.entries()) {
      const magic = Buffer.from('PRESENT-BACKUP-1\n'), iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', readFileSync(f.key), iv); cipher.setAAD(magic);
      const ciphertext = Buffer.concat([cipher.update(Buffer.from(JSON.stringify(manifest))), cipher.final()]);
      const path = join(f.root, `malformed-${index}.present`); writeFileSync(path, Buffer.concat([magic, iv, cipher.getAuthTag(), ciphertext]), { mode: 0o600 });
      const target = join(f.root, `unpublished-${index}`); assert.throws(() => restoreData(path, target, f.key)); assert.equal(existsSync(target), false);
    }
    assert.equal(existsSync(join(f.root, 'escaped.txt')), false); assert.equal(readdirSync(f.root).some(name => name.startsWith('.present-restore-')), false);
  } finally { f.close(); }
});

test('writer lease excludes a real live child, preserves killed owner, and allows only one stale successor', { timeout: 12000 }, async () => {
  const f = fixture();
  const code = `import { acquireWriterLock } from './server/operations/writer-lock.ts'; const lease = acquireWriterLock(process.argv[1]); console.log('OWNED'); process.on('SIGTERM',()=>{lease.release();process.exit(0)}); setInterval(()=>{},1000);`;
  const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', code, f.data], { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] });
  let output = ''; child.stdout.on('data', bytes => { output += String(bytes); }); child.stderr.on('data', bytes => { output += String(bytes); });
  try {
    for (let attempt = 0; !output.includes('OWNED'); attempt++) { if (attempt > 200 || child.exitCode !== null) throw new Error(output); await pause(20); }
    assert.throws(() => acquireWriterLock(f.data), /live writer/);
    assert.throws(() => backupData(f.data, f.archive, f.key), /live writer/); assert.equal(existsSync(f.archive), false);
    const stopped = once(child, 'exit'); child.kill('SIGKILL'); await stopped;
    const successor = acquireWriterLock(f.data);
    assert.throws(() => acquireWriterLock(f.data), /live writer/);
    assert.equal(readdirSync(join(f.data, WRITER_LEASE)).filter(name => /^\d{8}\.json$/.test(name)).length, 2);
    successor.release(); const receipt = backupData(f.data, f.archive, f.key); assert.equal(receipt.files, 5);
  } finally { if (child.exitCode === null && child.signalCode === null) { const stopped = once(child, 'exit'); child.kill('SIGKILL'); await stopped; } f.close(); }
});
