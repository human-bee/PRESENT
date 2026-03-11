import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  applyArtifactPatch,
  createWorkspacePatchArtifact,
  listWorkspaceFiles,
  openWorkspaceSession,
  readWorkspaceFile,
  resetKernelStateForTests,
  writeWorkspaceFile,
} from '@present/kernel';

describe('reset workspace files', () => {
  let workspacePath: string;

  beforeEach(() => {
    process.env.PRESENT_RESET_STATE_PATH = path.join(
      process.cwd(),
      '.tmp',
      `present-reset-state-workspace-files-${Date.now()}-${Math.random()}.json`,
    );
    resetKernelStateForTests();

    workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'present-reset-workspace-'));
    execFileSync('git', ['init'], { cwd: workspacePath, stdio: 'ignore' });
    fs.writeFileSync(path.join(workspacePath, 'index.ts'), 'export const value = 1;\n', 'utf8');
    fs.mkdirSync(path.join(workspacePath, 'src'), { recursive: true });
    fs.writeFileSync(path.join(workspacePath, 'src', 'entry.tsx'), 'export default function Entry() {}\n', 'utf8');
  });

  afterEach(() => {
    resetKernelStateForTests();
    delete process.env.PRESENT_RESET_STATE_PATH;
    fs.rmSync(workspacePath, { recursive: true, force: true });
  });

  it('lists workspace files, reads documents, writes content, and applies patch artifacts', () => {
    const workspace = openWorkspaceSession({
      workspacePath,
      title: 'Workspace Files',
      branch: 'codex/reset',
    });

    const entries = listWorkspaceFiles({ workspaceSessionId: workspace.id });
    expect(entries.map((entry) => entry.name)).toEqual(expect.arrayContaining(['index.ts', 'src']));

    const document = readWorkspaceFile({
      workspaceSessionId: workspace.id,
      filePath: 'index.ts',
    });
    expect(document.content).toContain('value = 1');

    const written = writeWorkspaceFile({
      workspaceSessionId: workspace.id,
      filePath: 'index.ts',
      content: 'export const value = 2;\n',
    });
    expect(written.content).toContain('value = 2');

    const artifact = createWorkspacePatchArtifact({
      workspaceSessionId: workspace.id,
      filePath: 'index.ts',
      nextContent: 'export const value = 7;\n',
    });
    expect(artifact.content).toContain('--- a/index.ts');
    expect(artifact.content).toContain('+++ b/index.ts');

    applyArtifactPatch(artifact.id);

    const patched = readWorkspaceFile({
      workspaceSessionId: workspace.id,
      filePath: 'index.ts',
    });
    expect(patched.content).toContain('value = 7');
  });
});
