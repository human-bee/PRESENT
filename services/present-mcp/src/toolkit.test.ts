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
    delete process.env.PRESENT_RESET_WORKSPACE_SESSION_ID;
    delete process.env.PRESENT_RESET_WORKSPACE_PATH;
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
        'present://runtime/registry',
        'present://runtime/interop',
        'present://workspace/files',
        'present://artifact/diff',
        'present://executors/state',
        'present://approvals/state',
        'present://models/status',
      ]),
    );
  });

  it('scopes runtime resources to the requested workspace session', async () => {
    const firstWorkspace = openWorkspaceSession({
      workspacePath,
      title: 'First Workspace',
      branch: 'codex/reset',
    });
    const secondWorkspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'present-reset-mcp-second-'));
    fs.writeFileSync(path.join(secondWorkspacePath, 'SECOND.md'), '# SECOND\n', 'utf8');
    const secondWorkspace = openWorkspaceSession({
      workspacePath: secondWorkspacePath,
      title: 'Second Workspace',
      branch: 'codex/reset',
    });

    process.env.PRESENT_RESET_WORKSPACE_SESSION_ID = secondWorkspace.id;

    const resources = await listPresentMcpResources();
    const workspaceState = JSON.parse(resources.find((resource) => resource.uri === 'present://workspaces/state')?.text ?? '[]');
    const interop = JSON.parse(resources.find((resource) => resource.uri === 'present://runtime/interop')?.text ?? '{}');

    expect(firstWorkspace.id).not.toBe(secondWorkspace.id);
    expect(workspaceState).toHaveLength(1);
    expect(workspaceState[0]?.id).toBe(secondWorkspace.id);
    expect(interop.workspaceSessionId).toBe(secondWorkspace.id);

    fs.rmSync(secondWorkspacePath, { recursive: true, force: true });
  });

  it('rejects tool access outside the configured workspace scope', async () => {
    const firstWorkspace = openWorkspaceSession({
      workspacePath,
      title: 'First Workspace',
      branch: 'codex/reset',
    });
    const secondWorkspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'present-reset-mcp-guarded-'));
    fs.writeFileSync(path.join(secondWorkspacePath, 'SECOND.md'), '# SECOND\n', 'utf8');
    const secondWorkspace = openWorkspaceSession({
      workspacePath: secondWorkspacePath,
      title: 'Second Workspace',
      branch: 'codex/reset',
    });

    process.env.PRESENT_RESET_WORKSPACE_SESSION_ID = secondWorkspace.id;

    await expect(
      presentMcpTools.workspaceReadFile.run({
        workspaceSessionId: firstWorkspace.id,
        filePath: 'README.md',
      }),
    ).rejects.toThrow('Workspace session is outside the current MCP scope');

    fs.rmSync(secondWorkspacePath, { recursive: true, force: true });
  });

  it('fails closed when the configured workspace scope is stale', async () => {
    openWorkspaceSession({
      workspacePath,
      title: 'Scoped Workspace',
      branch: 'codex/reset',
    });

    process.env.PRESENT_RESET_WORKSPACE_SESSION_ID = 'ws_missing';

    const resources = await listPresentMcpResources();
    const workspaceState = JSON.parse(resources.find((resource) => resource.uri === 'present://workspaces/state')?.text ?? '[]');
    const artifactState = JSON.parse(resources.find((resource) => resource.uri === 'present://artifacts/state')?.text ?? '[]');

    expect(workspaceState).toEqual([]);
    expect(artifactState).toEqual([]);
  });
});
