import {
  agentInteropPackSchema,
  artifactSchema,
  connectorRegistrySnapshotSchema,
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
    expect(manifest.primarySurface).toBe('canvas');
    expect(manifest.registry.uri).toBe('present://runtime/registry');
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

  it('parses connector registry snapshots for canvas-native runtimes', () => {
    const registry = connectorRegistrySnapshotSchema.parse({
      generatedAt: new Date().toISOString(),
      workspaceSessionId: 'ws_123',
      roomId: 'reset-ws_123',
      connectors: [
        {
          id: 'codex-app-server',
          label: 'Codex App Server',
          lane: 'codex',
          transport: 'app_server',
          endpoint: 'http://127.0.0.1:4096',
          health: 'healthy',
          capabilities: ['code_edit'],
          metadata: {},
        },
      ],
      resources: [
        {
          id: 'runtime.registry',
          uri: 'present://runtime/registry',
          label: 'Connector Registry',
          kind: 'registry',
          modelVisible: false,
          metadata: {},
        },
      ],
      events: [
        {
          id: 'task.stream',
          channel: '/api/reset/tasks/{taskId}/events',
          label: 'Task Event Stream',
          transport: 'sse',
          durable: false,
          metadata: {},
        },
      ],
      approvalPolicies: [
        {
          id: 'approval.git_action',
          kind: 'git_action',
          label: 'Git writes require approval.',
          requiresSingleUseToken: true,
          defaultTtlSeconds: 900,
          metadata: {},
        },
      ],
    });

    expect(registry.connectors[0]?.id).toBe('codex-app-server');
  });

  it('accepts BYO-agent interop packs', () => {
    const pack = agentInteropPackSchema.parse({
      generatedAt: new Date().toISOString(),
      surface: 'canvas',
      workspaceSessionId: 'ws_123',
      workspacePath: '/tmp/present-reset',
      manifestUri: 'present://runtime/manifest',
      registryUri: 'present://runtime/registry',
      resourceUris: {
        manifest: 'present://runtime/manifest',
        registry: 'present://runtime/registry',
        workspace: 'present://workspaces/state',
        artifacts: 'present://artifacts/state',
        approvals: 'present://approvals/state',
        presence: 'present://presence/state',
        traces: 'present://traces/state',
        models: 'present://models/status',
      },
      eventUris: {
        taskStreamTemplate: '/api/reset/tasks/{taskId}/events',
        traces: '/api/reset/traces',
        presence: '/api/reset/presence',
        livekitCommentary: 'livekit:data-channel:reset-ws_123',
      },
      approvalUris: {
        state: 'present://approvals/state',
        resolve: '/api/reset/approvals',
      },
      roomId: 'reset-ws_123',
      mcpServer: {
        name: 'present-mcp',
        transport: 'stdio',
        command: 'npm',
        args: ['run', 'present:mcp'],
        cwd: '/tmp/present-reset',
        env: {
          PRESENT_RESET_WORKSPACE_SESSION_ID: 'ws_123',
        },
      },
      commands: {
        openWorkspace: {
          command: 'npm',
          args: ['run', 'fairy:cli', '--', 'reset', 'open', '--workspacePath', '/tmp/present-reset'],
          cwd: '/tmp/present-reset',
        },
        inspectWorkspace: {
          command: 'npm',
          args: ['run', 'fairy:cli', '--', 'reset', 'status', '--workspaceSessionId', 'ws_123'],
          cwd: '/tmp/present-reset',
        },
        startTurn: {
          command: 'npm',
          args: ['run', 'fairy:cli', '--', 'reset', 'turn', '--workspaceSessionId', 'ws_123', '--prompt', '<prompt>'],
          cwd: '/tmp/present-reset',
        },
        printManifest: {
          command: 'npm',
          args: ['run', 'fairy:cli', '--', 'reset', 'manifest', '--workspaceSessionId', 'ws_123'],
          cwd: '/tmp/present-reset',
        },
      },
      connectorHints: [
        {
          connectorId: 'codex-app-server',
          purpose: 'Primary coding lane.',
          preferWhen: 'You need code edits and artifacts.',
        },
      ],
      recommendedClients: ['OpenClaw', 'Codex desktop'],
      notes: ['ChatGPT auth remains local-companion only.'],
    });

    expect(pack.recommendedClients).toContain('OpenClaw');
    expect(pack.surface).toBe('canvas');
  });
});
