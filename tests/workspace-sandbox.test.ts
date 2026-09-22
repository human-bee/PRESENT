import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmodSync, linkSync, lstatSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { prepareWorkspace, readWorkspaceFiles } from '../server/agents/workspace-sandbox';

const ID = 'a'.repeat(32);
function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'present-workspace-'))), base = join(root, 'workspaces');
  return { root, base, close: () => rmSync(root, { recursive: true, force: true }) };
}

test('workspace provisioning isolates cards, reuses files, and grants only the intended shell capabilities', () => {
  const f = fixture();
  try {
    const prepared = prepareWorkspace(f.base, ID), sibling = prepareWorkspace(f.base, 'b'.repeat(32));
    assert.equal(prepared.cwd, join(f.base, ID, 'files')); assert.notEqual(prepared.cwd, sibling.cwd);
    assert.deepEqual(readWorkspaceFiles(prepared.cwd), []);
    writeFileSync(join(prepared.cwd, 'result.txt'), 'persist');
    chmodSync(prepared.cwd, 0o755);
    assert.equal(prepareWorkspace(f.base, ID).cwd, prepared.cwd);
    assert.deepEqual(readWorkspaceFiles(prepared.cwd).map(file => file.path), ['result.txt']);
    for (const path of [f.base, dirname(prepared.cwd), prepared.cwd, join(prepared.cwd, '.tmp')]) assert.equal(lstatSync(path).mode & 0o777, 0o700);
    assert.deepEqual(prepared.config.permissions, { 'present-work': { filesystem: { ':minimal': 'read', ':workspace_roots': 'write', '/opt/homebrew/Cellar': 'read', '/opt/homebrew/opt': 'read' }, network: { enabled: false } } });
    assert.deepEqual(prepared.config.shell_environment_policy, { inherit: 'none', set: { PATH: `${dirname(prepared.nodePath)}:/usr/bin:/bin`, HOME: prepared.cwd, TMPDIR: join(prepared.cwd, '.tmp'), OPENSSL_CONF: '/dev/null' } });
    assert.equal(prepared.nodePath, realpathSync(process.execPath));
    assert.deepEqual(prepared.config.mcp_servers, {}); assert.equal(prepared.config.project_doc_max_bytes, 0); assert.equal(prepared.config.web_search, 'disabled');
    const features = prepared.config.features as Record<string, boolean>;
    for (const name of ['shell_tool', 'unified_exec', 'skip_host_skill_discovery']) assert.equal(features[name], true);
    for (const name of ['apps', 'plugins', 'hooks', 'memories', 'skill_search', 'browser_use', 'computer_use', 'image_generation', 'shell_snapshot', 'shell_zsh_fork']) assert.equal(features[name], false);
  } finally { f.close(); }
});

test('provisioning rejects traversal IDs and symlinks at every relevant directory level', () => {
  const f = fixture();
  try {
    for (const id of ['../outside', '.', 'a'.repeat(31), 'A'.repeat(32), `${ID}/child`]) assert.throws(() => prepareWorkspace(f.base, id), /Workspace ID/);
    assert.throws(() => prepareWorkspace(`${f.root}/../escape`, ID), /canonical/);
    const outside = join(f.root, 'outside'); mkdirSync(outside);
    symlinkSync(outside, f.base); assert.throws(() => prepareWorkspace(f.base, ID), /unsafe/); unlinkSync(f.base);
    mkdirSync(f.base); symlinkSync(outside, join(f.base, ID)); assert.throws(() => prepareWorkspace(f.base, ID), /unsafe/); unlinkSync(join(f.base, ID));
    mkdirSync(join(f.base, ID)); symlinkSync(outside, join(f.base, ID, 'files')); assert.throws(() => prepareWorkspace(f.base, ID), /unsafe/); unlinkSync(join(f.base, ID, 'files'));
    mkdirSync(join(f.base, ID, 'files')); symlinkSync(outside, join(f.base, ID, 'files', '.tmp')); assert.throws(() => prepareWorkspace(f.base, ID), /unsafe/);
  } finally { f.close(); }
});

test('manifest hashes actual bytes, sorts relative paths, and excludes temporary files and symlink targets', () => {
  const f = fixture();
  try {
    const { cwd } = prepareWorkspace(f.base, ID), contents = Buffer.from([0, 255, 10, 13]);
    mkdirSync(join(cwd, 'nested')); writeFileSync(join(cwd, 'nested', 'binary.bin'), contents); writeFileSync(join(cwd, 'empty.txt'), '');
    writeFileSync(join(cwd, '.tmp', 'private.txt'), 'temporary'); writeFileSync(join(f.root, 'outside.txt'), 'outside');
    symlinkSync(join(f.root, 'outside.txt'), join(cwd, 'escape')); symlinkSync(cwd, join(cwd, 'loop'));
    assert.deepEqual(readWorkspaceFiles(cwd), [{ path: 'empty.txt', bytes: 0, sha256: createHash('sha256').update('').digest('hex') }, { path: 'nested/binary.bin', bytes: 4, sha256: createHash('sha256').update(contents).digest('hex') }]);
    assert.deepEqual(readWorkspaceFiles(prepareWorkspace(f.base, 'b'.repeat(32)).cwd), []);
    assert.throws(() => readWorkspaceFiles(join(cwd, 'loop')), /unsafe/);
  } finally { f.close(); }
});

test('manifest rejects oversized files and aggregate bytes without returning partial evidence', () => {
  const f = fixture();
  try {
    const { cwd } = prepareWorkspace(f.base, ID);
    writeFileSync(join(cwd, 'large'), Buffer.alloc(1024 * 1024 + 1)); assert.throws(() => readWorkspaceFiles(cwd), /1 MiB/); rmSync(join(cwd, 'large'));
    for (let i = 0; i < 8; i++) writeFileSync(join(cwd, String(i)), Buffer.alloc(1024 * 1024));
    assert.equal(readWorkspaceFiles(cwd).length, 8);
    writeFileSync(join(cwd, 'overflow'), 'x'); assert.throws(() => readWorkspaceFiles(cwd), /8 MiB/);
  } finally { f.close(); }
});

test('manifest bounds file count, directory walking, and displayed path lengths', () => {
  const f = fixture();
  try {
    const { cwd } = prepareWorkspace(f.base, ID);
    for (let i = 0; i < 100; i++) writeFileSync(join(cwd, String(i)), '');
    assert.equal(readWorkspaceFiles(cwd).length, 100);
    writeFileSync(join(cwd, 'overflow'), ''); assert.throws(() => readWorkspaceFiles(cwd), /100-file/);
    for (let i = 0; i < 100; i++) rmSync(join(cwd, String(i))); rmSync(join(cwd, 'overflow'));
    for (let i = 0; i < 1000; i++) mkdirSync(join(cwd, `dir${i}`));
    assert.throws(() => readWorkspaceFiles(cwd), /1000-entry/);
    for (let i = 0; i < 1000; i++) rmSync(join(cwd, `dir${i}`), { recursive: true });
    mkdirSync(join(cwd, 'a'.repeat(120))); writeFileSync(join(cwd, 'a'.repeat(120), 'b'.repeat(120)), '');
    assert.throws(() => readWorkspaceFiles(cwd), /240 characters/);
  } finally { f.close(); }
});

test('manifest rejects ambiguous names, hard links, and redacts filesystem failure paths', () => {
  const f = fixture();
  try {
    const { cwd } = prepareWorkspace(f.base, ID);
    for (const name of ['line\nbreak', 'back\\slash', 'invisible\u202Ename']) {
      writeFileSync(join(cwd, name), ''); assert.throws(() => readWorkspaceFiles(cwd), /unsafe relative path/); rmSync(join(cwd, name));
    }
    writeFileSync(join(f.root, 'outside.txt'), 'outside'); linkSync(join(f.root, 'outside.txt'), join(cwd, 'hardlink'));
    assert.throws(() => readWorkspaceFiles(cwd), /hard-linked/);
    assert.throws(() => readWorkspaceFiles(join(f.root, 'missing')), error => error instanceof Error && error.message === 'Workspace files could not be read safely.');
    writeFileSync(join(f.root, 'not-a-directory'), '');
    assert.throws(() => prepareWorkspace(join(f.root, 'not-a-directory', 'base'), ID), /unsafe entry/);
  } finally { f.close(); }
});
