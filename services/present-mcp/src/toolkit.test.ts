import path from 'node:path';
import { listArtifacts, openWorkspaceSession, resetKernelStateForTests } from '@present/kernel';
import { listPresentMcpResources, presentMcpTools } from './toolkit';

describe('present MCP toolkit', () => {
  beforeEach(() => {
    process.env.PRESENT_RESET_STATE_PATH = path.join(
      process.cwd(),
      '.tmp',
      `present-reset-state-mcp-${Date.now()}-${Math.random()}.json`,
    );
    resetKernelStateForTests();
  });

  afterEach(() => {
    resetKernelStateForTests();
    delete process.env.PRESENT_RESET_STATE_PATH;
  });

  it('exposes expanded resources and artifact tools', async () => {
    const workspace = openWorkspaceSession({
      workspacePath: `/tmp/present-reset-mcp-${Date.now()}`,
      title: 'MCP Test',
      branch: 'codex/reset',
    });

    const widgetResult = await presentMcpTools.widgetCreate.run({
      workspaceSessionId: workspace.id,
      title: 'Widget',
      html: '<html><body>widget</body></html>',
    });

    const artifactResult = await presentMcpTools.artifactGet.run({
      artifactId: widgetResult.artifact.id,
    });

    const resources = await listPresentMcpResources();

    expect(artifactResult.artifact.id).toBe(widgetResult.artifact.id);
    expect(listArtifacts(workspace.id)).toHaveLength(1);
    expect(resources.map((resource) => resource.uri)).toEqual(
      expect.arrayContaining([
        'present://runtime/manifest',
        'present://executors/state',
        'present://approvals/state',
        'present://models/status',
      ]),
    );
  });
});
