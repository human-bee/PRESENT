const createArtifactMock = jest.fn();
const listArtifactsMock = jest.fn();
const hydrateResetKernelMock = jest.fn();
const flushResetKernelWritesMock = jest.fn();

jest.mock('@present/kernel', () => ({
  createArtifact: (...args: unknown[]) => createArtifactMock(...args),
  listArtifacts: (...args: unknown[]) => listArtifactsMock(...args),
}));

jest.mock('../_lib/persistence', () => ({
  hydrateResetKernel: (...args: unknown[]) => hydrateResetKernelMock(...args),
  flushResetKernelWrites: (...args: unknown[]) => flushResetKernelWritesMock(...args),
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
    nextUrl: URL;
    private body: string;

    constructor(input: string, init: { body?: string } = {}) {
      this.url = input;
      this.nextUrl = new URL(input);
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

describe('/api/reset/artifacts', () => {
  beforeEach(() => {
    installFetchPrimitives();
    createArtifactMock.mockReset();
    listArtifactsMock.mockReset();
    hydrateResetKernelMock.mockReset();
    flushResetKernelWritesMock.mockReset();
  });

  it('lists artifacts for a workspace', async () => {
    const { GET } = await import('./route');
    listArtifactsMock.mockReturnValue([{ id: 'artifact_123' }]);

    const response = await GET(new Request('http://localhost/api/reset/artifacts?workspaceSessionId=ws_123') as never);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(listArtifactsMock).toHaveBeenCalledWith('ws_123');
    expect(payload.artifacts[0]?.id).toBe('artifact_123');
  });

  it('creates server-owned artifacts', async () => {
    const { POST } = await import('./route');
    createArtifactMock.mockReturnValue({
      id: 'artifact_123',
      workspaceSessionId: 'ws_123',
      kind: 'widget_bundle',
    });

    const request = new Request('http://localhost/api/reset/artifacts', {
      body: JSON.stringify({
        workspaceSessionId: 'ws_123',
        kind: 'widget_bundle',
        title: 'Widget',
        mimeType: 'text/html',
        content: '<html></html>',
      }),
    });
    const response = await POST(request as never);
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(createArtifactMock).toHaveBeenCalledWith({
      workspaceSessionId: 'ws_123',
      kind: 'widget_bundle',
      title: 'Widget',
      mimeType: 'text/html',
      content: '<html></html>',
    });
    expect(flushResetKernelWritesMock).toHaveBeenCalled();
    expect(payload.artifact.id).toBe('artifact_123');
  });
});
