const getCodexBrokerSessionMock = jest.fn();
const deleteCodexBrokerSessionMock = jest.fn();
const findRemoteExecutorBySessionIdMock = jest.fn();
const persistDisconnectedRemoteWorkspaceMock = jest.fn();
const flushResetKernelWritesMock = jest.fn();
const hydrateResetKernelMock = jest.fn();

jest.mock('@present/codex-broker/client', () => ({
  getCodexBrokerSession: (...args: unknown[]) => getCodexBrokerSessionMock(...args),
  deleteCodexBrokerSession: (...args: unknown[]) => deleteCodexBrokerSessionMock(...args),
}));

jest.mock('../../_lib/remote-session', () => ({
  findRemoteExecutorBySessionId: (...args: unknown[]) => findRemoteExecutorBySessionIdMock(...args),
  persistDisconnectedRemoteWorkspace: (...args: unknown[]) => persistDisconnectedRemoteWorkspaceMock(...args),
}));

jest.mock('../../../_lib/persistence', () => ({
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
    constructor(public url: string) {}
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

describe('/api/reset/codex/sessions/[sessionId]', () => {
  beforeEach(() => {
    installFetchPrimitives();
    getCodexBrokerSessionMock.mockReset();
    deleteCodexBrokerSessionMock.mockReset();
    findRemoteExecutorBySessionIdMock.mockReset();
    persistDisconnectedRemoteWorkspaceMock.mockReset();
    flushResetKernelWritesMock.mockReset();
    hydrateResetKernelMock.mockReset();
  });

  it('returns broker session status and linked executor id', async () => {
    getCodexBrokerSessionMock.mockResolvedValue({
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
    findRemoteExecutorBySessionIdMock.mockReturnValue({ id: 'exec_123' });

    const { GET } = await import('./route');
    const response = await GET(new Request('http://localhost/api/reset/codex/sessions/cxs_123') as never, {
      params: Promise.resolve({ sessionId: 'cxs_123' }),
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(hydrateResetKernelMock).toHaveBeenCalled();
    expect(payload.executorSessionId).toBe('exec_123');
    expect(payload.remoteWorkingDirectory).toBe('/srv/codex/repos/PRESENT');
  });

  it('tears down the session and disconnects the hosted executor', async () => {
    deleteCodexBrokerSessionMock.mockResolvedValue({ deleted: true });
    findRemoteExecutorBySessionIdMock.mockReturnValue({
      id: 'exec_123',
      workspaceSessionId: 'ws_123',
    });

    const { DELETE } = await import('./route');
    const response = await DELETE(new Request('http://localhost/api/reset/codex/sessions/cxs_123') as never, {
      params: Promise.resolve({ sessionId: 'cxs_123' }),
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(deleteCodexBrokerSessionMock).toHaveBeenCalledWith('cxs_123');
    expect(persistDisconnectedRemoteWorkspaceMock).toHaveBeenCalledWith('ws_123', 'cxs_123');
    expect(flushResetKernelWritesMock).toHaveBeenCalled();
    expect(payload.deleted).toBe(true);
  });
});
