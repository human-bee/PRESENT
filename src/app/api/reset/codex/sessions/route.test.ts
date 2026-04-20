const getWorkspaceSessionMock = jest.fn();
const createCodexBrokerSessionMock = jest.fn();
const persistConnectedRemoteWorkspaceMock = jest.fn();
const resolveRemoteWorkingDirectoryMock = jest.fn();
const upsertRemoteExecutorMock = jest.fn();
const flushResetKernelWritesMock = jest.fn();
const hydrateResetKernelMock = jest.fn();

jest.mock('@present/kernel', () => ({
  getWorkspaceSession: (...args: unknown[]) => getWorkspaceSessionMock(...args),
}));

jest.mock('@present/codex-broker/client', () => ({
  createCodexBrokerSession: (...args: unknown[]) => createCodexBrokerSessionMock(...args),
}));

jest.mock('../_lib/remote-session', () => ({
  persistConnectedRemoteWorkspace: (...args: unknown[]) => persistConnectedRemoteWorkspaceMock(...args),
  resolveRemoteWorkingDirectory: (...args: unknown[]) => resolveRemoteWorkingDirectoryMock(...args),
  upsertRemoteExecutor: (...args: unknown[]) => upsertRemoteExecutorMock(...args),
}));

jest.mock('../../_lib/persistence', () => ({
  flushResetKernelWrites: (...args: unknown[]) => flushResetKernelWritesMock(...args),
  hydrateResetKernel: (...args: unknown[]) => hydrateResetKernelMock(...args),
}));

const installFetchPrimitives = () => {
  class MockHeaders {
    constructor(public init: Record<string, string> = {}) {}
    get(name: string) {
      return this.init[name] ?? this.init[name.toLowerCase()] ?? null;
    }
  }

  class MockRequest {
    url: string;
    private body: string;

    constructor(input: string, init: { body?: string } = {}) {
      this.url = input;
      this.body = init.body ?? '';
    }

    async json() {
      return JSON.parse(this.body);
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

describe('POST /api/reset/codex/sessions', () => {
  beforeEach(() => {
    installFetchPrimitives();
    getWorkspaceSessionMock.mockReset();
    createCodexBrokerSessionMock.mockReset();
    persistConnectedRemoteWorkspaceMock.mockReset();
    resolveRemoteWorkingDirectoryMock.mockReset();
    upsertRemoteExecutorMock.mockReset();
    flushResetKernelWritesMock.mockReset();
    hydrateResetKernelMock.mockReset();
  });

  it('creates a broker session, registers a hosted executor, and persists workspace metadata', async () => {
    getWorkspaceSessionMock.mockReturnValue({
      id: 'ws_123',
      workspacePath: '/Users/bsteinher/PRESENT',
      metadata: {},
    });
    resolveRemoteWorkingDirectoryMock.mockReturnValue('/srv/codex/repos/PRESENT');
    createCodexBrokerSessionMock.mockResolvedValue({
      session: {
        sessionId: 'cxs_123',
        workspaceSessionId: 'ws_123',
        remoteWorkingDirectory: '/srv/codex/repos/PRESENT',
        proxyBaseUrl: 'http://127.0.0.1:4101/sessions/cxs_123/proxy',
        frameUrl: 'http://127.0.0.1:4101/sessions/cxs_123/proxy/',
        status: 'ready',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        lastHeartbeatAt: new Date().toISOString(),
      },
    });
    upsertRemoteExecutorMock.mockReturnValue({ id: 'exec_123' });

    const { POST } = await import('./route');
    const response = await POST(
      new Request('http://localhost/api/reset/codex/sessions', {
        method: 'POST',
        body: JSON.stringify({
          workspaceSessionId: 'ws_123',
          remoteWorkspacePath: '/srv/codex/repos/PRESENT',
          reconnect: true,
        }),
      }) as never,
    );
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(hydrateResetKernelMock).toHaveBeenCalled();
    expect(resolveRemoteWorkingDirectoryMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'ws_123' }),
      '/srv/codex/repos/PRESENT',
    );
    expect(createCodexBrokerSessionMock).toHaveBeenCalledWith({
      workspaceSessionId: 'ws_123',
      remoteWorkingDirectory: '/srv/codex/repos/PRESENT',
      reconnect: true,
    });
    expect(upsertRemoteExecutorMock).toHaveBeenCalledWith(
      'ws_123',
      expect.objectContaining({ sessionId: 'cxs_123' }),
    );
    expect(persistConnectedRemoteWorkspaceMock).toHaveBeenCalledWith(
      'ws_123',
      expect.objectContaining({ sessionId: 'cxs_123' }),
      'exec_123',
    );
    expect(flushResetKernelWritesMock).toHaveBeenCalled();
    expect(payload.executorSessionId).toBe('exec_123');
    expect(payload.remoteWorkingDirectory).toBe('/srv/codex/repos/PRESENT');
  });
});
