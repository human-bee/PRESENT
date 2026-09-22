import { createHash } from 'node:crypto';
import { chmodSync, closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync, opendirSync, readSync, realpathSync, type Stats } from 'node:fs';
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path';

export type WorkspaceFile = { path: string; bytes: number; sha256: string };
export type PreparedWorkspace = { cwd: string; nodePath: string; config: Record<string, unknown> };
const MAX_FILES = 100, MAX_FILE_BYTES = 1024 * 1024, MAX_TOTAL_BYTES = 8 * 1024 * 1024, MAX_ENTRIES = 1000;
class WorkspaceError extends Error {}
const fail = (message: string): never => { throw new WorkspaceError(message); };

/** Check every ancestor before creating a child: realpath alone would accept symlinks. */
function directory(path: string, create: boolean): string {
  if (!isAbsolute(path) || resolve(path) !== path || path === parse(path).root) fail('Workspace directory must be a canonical absolute child path.');
  let cursor = parse(path).root;
  for (const part of path.slice(cursor.length).split(sep)) {
    cursor = join(cursor, part);
    let stat: Stats;
    try { stat = lstatSync(cursor); }
    catch (error) {
      if (!create || (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      mkdirSync(cursor, { mode: 0o700 }); stat = lstatSync(cursor);
    }
    if (!stat.isDirectory() || stat.isSymbolicLink()) fail('Workspace directory contains an unsafe entry.');
  }
  if (realpathSync(path) !== path) fail('Workspace directory escaped its canonical path.');
  return path;
}

/** Reuse only a real, private per-card directory; metadata must live outside cwd. */
export function prepareWorkspace(baseDirectory: string, workspaceId: string): PreparedWorkspace {
  try {
    if (!/^[a-f0-9]{32}$/.test(workspaceId)) fail('Workspace ID must contain exactly 32 lowercase hexadecimal characters.');
    const base = directory(baseDirectory, true), workspace = directory(join(base, workspaceId), true);
    const cwd = directory(join(workspace, 'files'), true), temporary = directory(join(cwd, '.tmp'), true);
    if (relative(base, cwd) !== join(workspaceId, 'files')) fail('Workspace directory escaped its base.');
    for (const path of [base, workspace, cwd, temporary]) chmodSync(path, 0o700);
    const nodePath = realpathSync(process.execPath);
    const disabled = ['apply_patch_freeform', 'view_image', 'apps', 'connectors', 'plugins', 'remote_plugin', 'browser_use', 'computer_use', 'js_repl', 'code_mode', 'multi_agent', 'multi_agent_v2', 'memories', 'memory_tool', 'skill_search', 'tool_search', 'image_generation', 'workspace_dependencies', 'hooks', 'shell_snapshot', 'shell_zsh_fork'];
    return { cwd, nodePath, config: {
      permissions: { 'present-work': { filesystem: { ':minimal': 'read', ':workspace_roots': 'write', '/opt/homebrew/Cellar': 'read', '/opt/homebrew/opt': 'read' }, network: { enabled: false } } },
      shell_environment_policy: { inherit: 'none', set: { PATH: `${dirname(nodePath)}:/usr/bin:/bin`, HOME: cwd, TMPDIR: temporary, OPENSSL_CONF: '/dev/null' } },
      // Project config, hooks and exec policies are never loaded from model-written files.
      projects: { [cwd]: { trust_level: 'untrusted' } }, notify: [], model_provider: 'openai',
      web_search: 'disabled', project_doc_max_bytes: 0, mcp_servers: {},
      features: Object.fromEntries([...disabled.map(name => [name, false]), ['skip_host_skill_discovery', true], ['shell_tool', true], ['unified_exec', true]]),
    } };
  } catch (error) {
    if (error instanceof WorkspaceError) throw error;
    throw new WorkspaceError('Workspace directory could not be prepared safely.');
  }
}

function safePath(path: string) {
  // Backslashes and invisible controls must never become ambiguous displayed paths.
  if (path.length > 240 || /[\\\p{Cc}\p{Cf}]/u.test(path) || path.split('/').some(part => !part || part === '.' || part === '..')) fail('Workspace contains an unsafe relative path (maximum 240 characters; no controls or backslashes).');
}

function inspectFile(path: string): { bytes: number; sha256: string } {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = fstatSync(fd);
    if (!before.isFile() || before.nlink !== 1) fail('Workspace contains a nonregular or hard-linked file.');
    if (before.size > MAX_FILE_BYTES) fail('Workspace file exceeds the 1 MiB limit.');
    const buffer = Buffer.alloc(MAX_FILE_BYTES + 1);
    let bytes = 0;
    while (bytes < buffer.length) {
      const count = readSync(fd, buffer, bytes, buffer.length - bytes, bytes);
      if (!count) break;
      bytes += count;
    }
    if (bytes > MAX_FILE_BYTES) fail('Workspace file exceeds the 1 MiB limit.');
    const after = fstatSync(fd);
    if (bytes !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs) fail('Workspace file changed while its manifest was being read.');
    return { bytes, sha256: createHash('sha256').update(buffer.subarray(0, bytes)).digest('hex') };
  } finally { closeSync(fd); }
}

/** Run after the owned worker has stopped. No symlinks or partial manifests are returned. */
export function readWorkspaceFiles(cwd: string): WorkspaceFile[] {
  try {
    const root = directory(cwd, false), files: WorkspaceFile[] = [];
    let entries = 0, totalBytes = 0;
    const walk = (path: string, prefix: string) => {
      directory(path, false);
      const handle = opendirSync(path);
      try {
        for (let entry = handle.readSync(); entry; entry = handle.readSync()) {
          if (++entries > MAX_ENTRIES) fail('Workspace exceeds the 1000-entry inspection limit.');
          if (entry.name === '.tmp' && !prefix) continue;
          const name = prefix ? `${prefix}/${entry.name}` : entry.name;
          safePath(name);
          const absolute = join(path, entry.name), stat = lstatSync(absolute);
          if (stat.isSymbolicLink()) continue;
          if (stat.isDirectory()) { walk(absolute, name); continue; }
          if (!stat.isFile()) fail('Workspace contains a nonregular file.');
          if (files.length >= MAX_FILES) fail('Workspace exceeds the 100-file manifest limit.');
          const inspected = inspectFile(absolute);
          totalBytes += inspected.bytes;
          if (totalBytes > MAX_TOTAL_BYTES) fail('Workspace files exceed the 8 MiB aggregate limit.');
          files.push({ path: name, ...inspected });
        }
      } finally { handle.closeSync(); }
    };
    walk(root, '');
    return files.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  } catch (error) {
    if (error instanceof WorkspaceError) throw error;
    throw new WorkspaceError('Workspace files could not be read safely.');
  }
}
