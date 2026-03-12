const createWorkspacePatchArtifactMock = jest.fn();
const listWorkspaceFilesMock = jest.fn();

jest.mock('@present/kernel', () => ({
  createWorkspacePatchArtifact: (...args: unknown[]) => createWorkspacePatchArtifactMock(...args),
  listWorkspaceFiles: (...args: unknown[]) => listWorkspaceFilesMock(...args),
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

describe('/api/reset/workspaces/[workspaceSessionId]/files', () => {
  beforeEach(() => {
    installFetchPrimitives();
    createWorkspacePatchArtifactMock.mockReset();
    listWorkspaceFilesMock.mockReset();
  });

  it('lists workspace directory entries', async () => {
    const { GET } = await import('./route');
    listWorkspaceFilesMock.mockReturnValue([
      {
        path: 'src',
        name: 'src',
        kind: 'directory',
        size: null,
        updatedAt: new Date().toISOString(),
        language: null,
      },
    ]);

    const request = new Request('http://localhost/api/reset/workspaces/ws_123/files?directoryPath=src');
    const response = await GET(request as never, { params: Promise.resolve({ workspaceSessionId: 'ws_123' }) });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(listWorkspaceFilesMock).toHaveBeenCalledWith({
      workspaceSessionId: 'ws_123',
      directoryPath: 'src',
      limit: 200,
    });
    expect(payload.files).toHaveLength(1);
  });

  it('creates a patch artifact from edited content', async () => {
    const { POST } = await import('./route');
    createWorkspacePatchArtifactMock.mockReturnValue({
      id: 'artifact_123',
      workspaceSessionId: 'ws_123',
      traceId: 'trace_123',
      kind: 'file_patch',
      title: 'Patch src/app/page.tsx',
      mimeType: 'text/x-diff',
      content: '--- a/src/app/page.tsx\n+++ b/src/app/page.tsx\n',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      metadata: {},
    });

    const request = new Request('http://localhost/api/reset/workspaces/ws_123/files', {
      method: 'POST',
      body: JSON.stringify({
        filePath: 'src/app/page.tsx',
        nextContent: 'export default function Page() { return null; }\n',
        traceId: 'trace_123',
      }),
    });
    const response = await POST(request as never, { params: Promise.resolve({ workspaceSessionId: 'ws_123' }) });
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(createWorkspacePatchArtifactMock).toHaveBeenCalledWith({
      workspaceSessionId: 'ws_123',
      filePath: 'src/app/page.tsx',
      nextContent: 'export default function Page() { return null; }\n',
      traceId: 'trace_123',
      title: undefined,
    });
    expect(payload.artifact.id).toBe('artifact_123');
  });
});
