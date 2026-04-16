const installFetchPrimitives = () => {
  class MockHeaders {
    constructor(public init: Record<string, string> = {}) {}
    get(name: string) {
      return this.init[name] ?? this.init[name.toLowerCase()] ?? null;
    }
  }

  class MockRequest {
    url: string;
    nextUrl: URL;

    constructor(input: string) {
      this.url = input;
      this.nextUrl = new URL(input);
    }
  }

  class MockResponse {
    status: number;
    headers: MockHeaders;
    private body: string;

    constructor(body = '', init: { status?: number; headers?: Record<string, string> } = {}) {
      this.body = body;
      this.status = init.status ?? 200;
      this.headers = new MockHeaders(init.headers ?? {});
    }

    static json(data: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
      return new MockResponse(JSON.stringify(data), {
        ...init,
        headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
      });
    }

    async json() {
      return JSON.parse(this.body);
    }
  }

  Object.assign(global, {
    Headers: MockHeaders,
    Request: MockRequest,
    Response: MockResponse,
  });
};

describe('GET /api/reset/runtime-manifest', () => {
  beforeEach(() => {
    installFetchPrimitives();
    jest.resetModules();
  });

  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  it('returns a workspace-scoped BYO-agent interop pack', async () => {
    const hydrateResetKernelMock = jest.fn();
    const manifest = {
      generatedAt: new Date().toISOString(),
      schemaVersion: 'canvas-os/v1',
      runtimeCenter: 'responses',
      primarySurface: 'canvas',
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
      connectors: [],
      resources: [],
      events: [],
      approvalPolicies: [],
      traceSchemaUri: 'present://schemas/trace-linkage',
      registry: {
        uri: 'present://runtime/registry',
        updatedAt: new Date().toISOString(),
        connectorCount: 0,
      },
      media: {
        provider: 'livekit',
        transport: 'webrtc',
        supports: ['audio', 'video', 'screen', 'data_channel'],
        roomIdTemplate: 'reset-{workspaceSessionId}',
      },
      collaboration: {
        livekitEnabled: true,
        canvasEnabled: true,
        widgetsEnabled: true,
        dualClient: true,
        canvasTransport: 'tldraw_sync',
        sharedDocTransport: 'yjs_ws',
        presenceTransport: 'webrtc',
        operatorSurfaces: ['canvas', 'shell', 'archive'],
        defaultRoomId: 'reset-ws_123',
      },
    };
    const registry = {
      generatedAt: new Date().toISOString(),
      workspaceSessionId: 'ws_123',
      roomId: 'reset-ws_123',
      connectors: [],
      resources: [],
      events: [],
      approvalPolicies: [],
    };
    const agentPack = {
      generatedAt: new Date().toISOString(),
      surface: 'canvas',
      workspaceSessionId: 'ws_123',
      workspacePath: '/tmp/present-reset',
      manifestUri: 'present://runtime/manifest',
      registryUri: 'present://runtime/registry',
      resourceUris: {
        manifest: 'present://runtime/manifest',
        registry: 'present://runtime/registry',
        canvasSession: 'present://canvas/session',
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
        cwd: process.cwd(),
        env: {
          PRESENT_RESET_WORKSPACE_SESSION_ID: 'ws_123',
        },
      },
      commands: {
        openWorkspace: { command: 'npm', args: ['run', 'fairy:cli'], cwd: process.cwd() },
        inspectWorkspace: { command: 'npm', args: ['run', 'fairy:cli'], cwd: process.cwd() },
        startTurn: { command: 'npm', args: ['run', 'fairy:cli'], cwd: process.cwd() },
        printManifest: { command: 'npm', args: ['run', 'fairy:cli'], cwd: process.cwd() },
      },
      connectorHints: [],
      recommendedClients: ['OpenClaw'],
      notes: ['ChatGPT auth remains local-companion only.'],
    };
    const buildCanvasRuntimeSurfaceMock = jest.fn(() => ({
      generatedAt: manifest.generatedAt,
      manifest,
      registry,
      agentPack,
    }));
    const resolveKernelModelProfilesMock = jest.fn(async () => []);
    const getWorkspaceSessionMock = jest.fn(() => ({
      id: 'ws_123',
      workspacePath: '/tmp/present-reset',
      branch: 'codex/reset',
      title: 'Reset Workspace',
      state: 'active',
      ownerUserId: null,
      activeExecutorSessionId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      metadata: {},
    }));
    const buildCodexAppServerManifestMock = jest.fn(() => ({ baseUrl: 'http://127.0.0.1:4096' }));

    jest.doMock('../_lib/persistence', () => ({
      hydrateResetKernel: hydrateResetKernelMock,
    }));
    jest.doMock('@present/kernel', () => ({
      buildCanvasRuntimeSurface: buildCanvasRuntimeSurfaceMock,
      getWorkspaceSession: getWorkspaceSessionMock,
      resolveKernelModelProfiles: resolveKernelModelProfilesMock,
    }));
    jest.doMock('@present/codex-adapter', () => ({
      buildCodexAppServerManifest: buildCodexAppServerManifestMock,
    }));

    const { GET } = await import('./route');
    const response = await GET(new Request('http://localhost/api/reset/runtime-manifest?workspaceSessionId=ws_123') as never);
    const payload = await response.json();

    expect(hydrateResetKernelMock).toHaveBeenCalled();
    expect(getWorkspaceSessionMock).toHaveBeenCalledWith('ws_123');
    expect(buildCanvasRuntimeSurfaceMock).toHaveBeenCalledWith(expect.objectContaining({ id: 'ws_123' }));
    expect(payload.agentPack.workspaceSessionId).toBe('ws_123');
    expect(payload.agentPack.recommendedClients).toContain('OpenClaw');
    expect(payload.registry.roomId).toBe('reset-ws_123');
  });
});
