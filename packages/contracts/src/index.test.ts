import {
  artifactSchema,
  runtimeManifestSchema,
  workspaceSessionSchema,
} from '@present/contracts';

describe('reset contracts', () => {
  it('accepts reset-era runtime manifests', () => {
    const manifest = runtimeManifestSchema.parse({
      generatedAt: new Date().toISOString(),
      codex: {
        appServerBaseUrl: 'http://127.0.0.1:4096',
        authModes: ['chatgpt', 'api_key', 'shared_key', 'byok'],
        recommendedModels: ['gpt-5.4', 'gpt-5.3-codex', 'gpt-5.3-codex-spark'],
      },
      mcp: {
        serverName: 'present-mcp',
        transport: 'stdio',
        command: ['npm', 'run', 'present:mcp'],
      },
      collaboration: {
        livekitEnabled: true,
        canvasEnabled: true,
        widgetsEnabled: true,
        dualClient: true,
      },
    });

    expect(manifest.codex.recommendedModels).toContain('gpt-5.4');
  });

  it('parses workspace and widget artifact entities', () => {
    const workspace = workspaceSessionSchema.parse({
      id: 'ws_123',
      workspacePath: '/tmp/present-reset',
      branch: 'codex/reset',
      title: 'Reset',
      state: 'active',
      ownerUserId: null,
      activeExecutorSessionId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      metadata: {},
    });

    const artifact = artifactSchema.parse({
      id: 'artifact_123',
      workspaceSessionId: workspace.id,
      traceId: null,
      kind: 'widget_bundle',
      title: 'Preview',
      mimeType: 'text/html',
      content: '<html></html>',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      metadata: {},
    });

    expect(artifact.workspaceSessionId).toBe(workspace.id);
  });
});
