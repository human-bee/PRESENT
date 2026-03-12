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
    private payload: unknown;

    constructor(input: string, init: { body?: string } = {}) {
      this.url = input;
      this.nextUrl = new URL(input);
      this.payload = init.body ? JSON.parse(init.body) : null;
    }

    async json() {
      return this.payload;
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

describe('reset workspace collaboration route', () => {
  beforeEach(() => {
    installFetchPrimitives();
    jest.resetModules();
  });

  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  it('returns the shared editor document snapshot and accepts updates', async () => {
    const ensureResetKernelHydratedMock = jest.fn();
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
    const getCollaborationDocumentMock = jest.fn(() => ({
      workspaceSessionId: 'ws_123',
      filePath: 'README.md',
      encodedState: 'Zmlyc3Q=',
      version: 2,
      updatedAt: new Date().toISOString(),
      collaborators: [{ identity: 'op-1', displayName: 'Mission One', updatedAt: new Date().toISOString() }],
    }));
    const upsertCollaborationDocumentMock = jest.fn(() => ({
      workspaceSessionId: 'ws_123',
      filePath: 'README.md',
      encodedState: 'c2Vjb25k',
      version: 3,
      updatedAt: new Date().toISOString(),
      collaborators: [{ identity: 'op-2', displayName: 'Mission Two', updatedAt: new Date().toISOString() }],
    }));

    jest.doMock('@present/kernel', () => ({
      ensureResetKernelHydrated: ensureResetKernelHydratedMock,
      getWorkspaceSession: getWorkspaceSessionMock,
      getCollaborationDocument: getCollaborationDocumentMock,
      upsertCollaborationDocument: upsertCollaborationDocumentMock,
    }));

    const { GET, POST } = await import('./route');

    const getResponse = await GET(
      new Request('http://localhost/api/reset/workspaces/ws_123/collaboration?filePath=README.md') as never,
      { params: Promise.resolve({ workspaceSessionId: 'ws_123' }) },
    );
    const getPayload = await getResponse.json();

    const postResponse = await POST(
      new Request('http://localhost/api/reset/workspaces/ws_123/collaboration', {
        body: JSON.stringify({
          filePath: 'README.md',
          encodedState: 'c2Vjb25k',
          identity: 'op-2',
          displayName: 'Mission Two',
        }),
      }) as never,
      { params: Promise.resolve({ workspaceSessionId: 'ws_123' }) },
    );
    const postPayload = await postResponse.json();

    expect(ensureResetKernelHydratedMock).toHaveBeenCalledTimes(2);
    expect(getWorkspaceSessionMock).toHaveBeenCalledWith('ws_123');
    expect(getCollaborationDocumentMock).toHaveBeenCalledWith('ws_123', 'README.md');
    expect(upsertCollaborationDocumentMock).toHaveBeenCalledWith({
      workspaceSessionId: 'ws_123',
      filePath: 'README.md',
      encodedState: 'c2Vjb25k',
      identity: 'op-2',
      displayName: 'Mission Two',
    });
    expect(getPayload.document.version).toBe(2);
    expect(postPayload.document.version).toBe(3);
  });
});
