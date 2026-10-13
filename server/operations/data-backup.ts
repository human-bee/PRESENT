import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { closeSync, constants, existsSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { acquireWriterLock, assertOutsideDataRoot, WRITER_LEASE } from './writer-lock';

export const BACKUP_LIMITS = { files: 10000, directories: 2048, fileBytes: 64 * 1024 * 1024, totalBytes: 128 * 1024 * 1024, archiveBytes: 180 * 1024 * 1024 } as const;
const magic = Buffer.from('PRESENT-BACKUP-1\n');
type FileEntry = { path: string; bytes: number; sha256: string; executable: boolean; data: string };
type Manifest = { version: 1; directories: string[]; files: FileEntry[]; totalBytes: number };
function pathExists(path: string) { try { lstatSync(path); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; } }
function digest(bytes: Buffer) { return createHash('sha256').update(bytes).digest('hex'); }
function safePath(path: unknown): asserts path is string {
  if (typeof path !== 'string' || !path || path.length > 1024 || path.includes('\\') || path.includes('\0') || path.split('/').length > 32 || path.split('/').some(part => !part || part === '.' || part === '..') || path.startsWith('/') || path === WRITER_LEASE || path.startsWith(`${WRITER_LEASE}/`)) throw new Error('Invalid archive path.');
}
function readPrivateFile(file: string, maximum: number, privateMode = false) {
  const before = lstatSync(file);
  if (!before.isFile() || before.nlink !== 1 || before.size > maximum || (privateMode && (before.mode & 0o077) !== 0)) throw new Error('Expected a bounded regular file with no links and private key/archive permissions.');
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(fd);
    if (stat.dev !== before.dev || stat.ino !== before.ino || stat.size !== before.size || stat.nlink !== 1) throw new Error('File changed during inspection.');
    const bytes = readFileSync(fd);
    const after = fstatSync(fd);
    if (bytes.length !== stat.size || after.size !== stat.size || after.mtimeMs !== stat.mtimeMs || after.ctimeMs !== stat.ctimeMs) throw new Error('File changed during backup.');
    return bytes;
  } finally { closeSync(fd); }
}
function syncDirectory(directory: string) { const fd = openSync(directory, constants.O_RDONLY); try { fsyncSync(fd); } finally { closeSync(fd); } }
function writeExclusive(file: string, bytes: Buffer, mode = 0o600) {
  const fd = openSync(file, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, mode);
  try { writeFileSync(fd, bytes); fsyncSync(fd); } finally { closeSync(fd); }
  syncDirectory(dirname(file));
}
export function createBackupKey(file: string) { writeExclusive(resolve(file), randomBytes(32)); }
function readKey(file: string) { const bytes = readPrivateFile(file, 32, true); if (bytes.length !== 32) throw new Error('The operator key must contain exactly 32 random bytes.'); return bytes; }

function validateManifest(value: unknown): Manifest {
  const manifest = value as Manifest;
  if (!manifest || manifest.version !== 1 || !Array.isArray(manifest.directories) || !Array.isArray(manifest.files) || manifest.directories.length > BACKUP_LIMITS.directories || manifest.files.length > BACKUP_LIMITS.files || !Number.isSafeInteger(manifest.totalBytes) || manifest.totalBytes < 0 || manifest.totalBytes > BACKUP_LIMITS.totalBytes) throw new Error('Invalid or oversized backup manifest.');
  const paths = new Set<string>();
  for (const path of [...manifest.directories, ...manifest.files.map(file => file?.path)]) { safePath(path); if (paths.has(path)) throw new Error('Duplicate archive path.'); paths.add(path); }
  const directories = new Set(manifest.directories);
  for (const path of paths) { const parent = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''; if (parent && !directories.has(parent)) throw new Error('Archive parent directory is missing.'); }
  let total = 0;
  for (const file of manifest.files) {
    if (!Number.isSafeInteger(file.bytes) || file.bytes < 0 || file.bytes > BACKUP_LIMITS.fileBytes || typeof file.data !== 'string' || file.data.length > Math.ceil(BACKUP_LIMITS.fileBytes / 3) * 4 || typeof file.executable !== 'boolean' || !/^[a-f0-9]{64}$/.test(file.sha256)) throw new Error('Invalid file manifest.');
    const bytes = Buffer.from(file.data, 'base64');
    if (bytes.toString('base64') !== file.data || bytes.length !== file.bytes || digest(bytes) !== file.sha256) throw new Error('Archive file bytes do not match the manifest.');
    total += file.bytes; if (total > BACKUP_LIMITS.totalBytes) throw new Error('Backup byte budget exceeded.');
  }
  if (total !== manifest.totalBytes) throw new Error('Archive byte total does not match.');
  return manifest;
}
function decryptArchive(bytes: Buffer, key: Buffer) {
  if (bytes.length > BACKUP_LIMITS.archiveBytes || bytes.length < magic.length + 28 || !bytes.subarray(0, magic.length).equals(magic)) throw new Error('Invalid backup envelope.');
  const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(magic.length, magic.length + 12));
  decipher.setAAD(magic); decipher.setAuthTag(bytes.subarray(magic.length + 12, magic.length + 28));
  let plaintext: Buffer;
  try { plaintext = Buffer.concat([decipher.update(bytes.subarray(magic.length + 28)), decipher.final()]); }
  catch { throw new Error('Backup authentication failed; wrong key or altered archive.'); }
  return { plaintext, manifest: validateManifest(JSON.parse(plaintext.toString('utf8'))) };
}

export function backupData(directory: string, archive: string, keyFile: string) {
  if (!existsSync(directory) || !lstatSync(directory).isDirectory() || lstatSync(directory).isSymbolicLink()) throw new Error('Backup requires an existing real data directory.');
  const lease = acquireWriterLock(directory, 'backup');
  try {
    assertOutsideDataRoot(lease.root, resolve(realpathSync(dirname(archive)), basename(archive)));
    assertOutsideDataRoot(lease.root, realpathSync(keyFile));
    const key = readKey(keyFile);
    if (existsSync(archive)) throw new Error('Backup archive already exists.');
    const manifest: Manifest = { version: 1, directories: [], files: [], totalBytes: 0 };
    function walk(folder: string) {
      if (realpathSync(folder) !== folder) throw new Error('Directory links or escapes are unsupported.');
      for (const name of readdirSync(folder).sort()) {
        const file = join(folder, name), path = relative(lease.root, file).split('\\').join('/');
        if (path === WRITER_LEASE) continue;
        safePath(path);
        const stat = lstatSync(file);
        if (stat.isSymbolicLink()) throw new Error('Symlinks are not supported in private backups.');
        if (stat.isDirectory()) { if (manifest.directories.length >= BACKUP_LIMITS.directories) throw new Error('Directory budget exceeded.'); manifest.directories.push(path); walk(file); }
        else {
          if (!stat.isFile() || stat.nlink !== 1 || manifest.files.length >= BACKUP_LIMITS.files || stat.size > BACKUP_LIMITS.fileBytes || manifest.totalBytes + stat.size > BACKUP_LIMITS.totalBytes) throw new Error('File type, link or backup budget is unsupported.');
          if (realpathSync(file) !== file) throw new Error('File links or escapes are unsupported.');
          const bytes = readPrivateFile(file, BACKUP_LIMITS.fileBytes);
          manifest.files.push({ path, bytes: bytes.length, sha256: digest(bytes), executable: Boolean(stat.mode & 0o100), data: bytes.toString('base64') }); manifest.totalBytes += bytes.length;
        }
      }
    }
    walk(lease.root); validateManifest(manifest);
    const plaintext = Buffer.from(JSON.stringify(manifest)), iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(magic);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const envelope = Buffer.concat([magic, iv, cipher.getAuthTag(), ciphertext]);
    if (envelope.length > BACKUP_LIMITS.archiveBytes) throw new Error('Archive budget exceeded.');
    writeExclusive(archive, envelope);
    const verified = decryptArchive(readPrivateFile(archive, BACKUP_LIMITS.archiveBytes, true), key);
    if (!verified.plaintext.equals(plaintext)) throw new Error('Written archive verification failed.');
    return { files: manifest.files.length, directories: manifest.directories.length, bytes: manifest.totalBytes, manifestSha256: digest(plaintext), archiveSha256: digest(envelope) };
  } finally { lease.release(); }
}

export function restoreData(archive: string, destination: string, keyFile: string) {
  const target = resolve(destination), parent = dirname(target);
  if (pathExists(target)) throw new Error('Restore destination already exists; choose a new path.');
  const parentStat = lstatSync(parent);
  if (!parentStat.isDirectory() || parentStat.isSymbolicLink() || (parentStat.mode & 0o022) || parentStat.uid !== process.getuid?.()) throw new Error('Restore requires an operator-owned parent without group/world write access.');
  const canonicalParent = realpathSync(parent), finalPath = join(canonicalParent, basename(target));
  const guard = join(canonicalParent, `.present-restore-${basename(target)}.lock`);
  writeExclusive(guard, Buffer.from(randomUUID()));
  let staging: string | undefined;
  try {
    if (pathExists(finalPath)) throw new Error('Restore destination already exists.');
    const key = readKey(keyFile), decoded = decryptArchive(readPrivateFile(archive, BACKUP_LIMITS.archiveBytes, true), key);
    staging = join(canonicalParent, `.present-restore-${randomUUID()}`); mkdirSync(staging, { mode: 0o700 });
    for (const path of [...decoded.manifest.directories].sort((a, b) => a.split('/').length - b.split('/').length)) mkdirSync(join(staging, path), { mode: 0o700 });
    for (const file of decoded.manifest.files) writeExclusive(join(staging, file.path), Buffer.from(file.data, 'base64'), file.executable ? 0o700 : 0o600);
    for (const file of decoded.manifest.files) if (digest(readPrivateFile(join(staging, file.path), BACKUP_LIMITS.fileBytes, true)) !== file.sha256) throw new Error('Restored file verification failed.');
    if (pathExists(finalPath)) throw new Error('Restore destination appeared during verification.');
    for (const path of [...decoded.manifest.directories].sort((a, b) => b.split('/').length - a.split('/').length)) syncDirectory(join(staging, path));
    syncDirectory(staging);
    renameSync(staging, finalPath); staging = undefined; syncDirectory(canonicalParent);
    return { files: decoded.manifest.files.length, directories: decoded.manifest.directories.length, bytes: decoded.manifest.totalBytes, manifestSha256: digest(decoded.plaintext) };
  } finally { if (staging) rmSync(staging, { recursive: true, force: true }); rmSync(guard); }
}
