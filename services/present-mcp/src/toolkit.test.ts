import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { listArtifacts, openWorkspaceSession, resetKernelStateForTests } from '@present/kernel';
import { listPresentMcpResources, presentMcpTools } from './toolkit';

describe('present MCP toolkit', () => {
  let workspacePath: string;

  beforeEach(() => {
    process.env.PRESENT_RESET_STATE_PATH = path.join(
      process.cwd(),
      '.tmp',
      `present-reset-state-mcp-${Date.now()}-${Math.random()}.json`,
    );
    resetKernelStateForTests();
    workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'present-reset-mcp-'));
    fs.writeFileSync(path.join(workspacePath, 'README.md'), '# PRESENT\n', 'utf8');
  });

  afterEach(() => {
    resetKernelStateForTests();
    delete process.env.PRESENT_RESET_STATE_PATH;
    fs.rmSync(workspacePath, { recursive: true, force: true });
  });

  it('exposes expanded resources and artifact tools', async () => {
    const workspace = openWorkspaceSession({
      workspacePath,
      title: 'MCP Test',
      branch: 'codex/reset',
    });

    const workspaceFiles = await presentMcpTools.workspaceFiles.run({
      workspaceSessionId: workspace.id,
    });
    const workspaceDocument = await presentMcpTools.workspaceReadFile.run({
      workspaceSessionId: workspace.id,
      filePath: 'README.md',
    });
    const widgetResult = await presentMcpTools.widgetCreate.run({
      workspaceSessionId: workspace.id,
      title: 'Widget',
      html: '<html><body>widget</body></html>',
    });
    const patchResult = await presentMcpTools.workspaceCreatePatch.run({
      workspaceSessionId: workspace.id,
      filePath: 'README.md',
      nextContent: '# PRESENT RESET\n',
    });

    const artifactResult = await presentMcpTools.artifactGet.run({
      artifactId: widgetResult.artifact.id,
    });

    const resources = await listPresentMcpResources();

    expect(artifactResult.artifact.id).toBe(widgetResult.artifact.id);
    expect(workspaceFiles.files.map((entry) => entry.name)).toContain('README.md');
    expect(workspaceDocument.document.content).toContain('# PRESENT');
    expect(patchResult.artifact.kind).toBe('file_patch');
    expect(listArtifacts(workspace.id)).toHaveLength(2);
    expect(resources.map((resource) => resource.uri)).toEqual(
      expect.arrayContaining([
        'present://runtime/manifest',
        'present://workspace/files',
        'present://artifact/diff',
        'present://executors/state',
        'present://approvals/state',
        'present://models/status',
      ]),
    );
  });
});
