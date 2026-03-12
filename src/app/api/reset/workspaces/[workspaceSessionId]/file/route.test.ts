const readWorkspaceFileMock = jest.fn();
const writeWorkspaceFileMock = jest.fn();

jest.mock('@present/kernel', () => ({
  readWorkspaceFile: (...args: unknown[]) => readWorkspaceFileMock(...args),
  writeWorkspaceFile: (...args: unknown[]) => writeWorkspaceFileMock(...args),
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

describe('/api/reset/workspaces/[workspaceSessionId]/file', () => {
  beforeEach(() => {
    installFetchPrimitives();
    readWorkspaceFileMock.mockReset();
    writeWorkspaceFileMock.mockReset();
  });

  it('reads a workspace file', async () => {
    const { GET } = await import('./route');
    readWorkspaceFileMock.mockReturnValue({
      path: 'package.json',
      name: 'package.json',
      kind: 'file',
      size: 120,
      updatedAt: new Date().toISOString(),
      language: 'json',
      content: '{ "name": "present" }',
    });

    const request = new Request('http://localhost/api/reset/workspaces/ws_123/file?filePath=package.json');
    const response = await GET(request as never, { params: Promise.resolve({ workspaceSessionId: 'ws_123' }) });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(readWorkspaceFileMock).toHaveBeenCalledWith({
      workspaceSessionId: 'ws_123',
      filePath: 'package.json',
    });
    expect(payload.document.path).toBe('package.json');
  });

  it('writes a workspace file', async () => {
    const { PUT } = await import('./route');
    writeWorkspaceFileMock.mockReturnValue({
      path: 'README.md',
      name: 'README.md',
      kind: 'file',
      size: 10,
      updatedAt: new Date().toISOString(),
      language: 'markdown',
      content: '# Updated\n',
    });

    const request = new Request('http://localhost/api/reset/workspaces/ws_123/file', {
      method: 'PUT',
      body: JSON.stringify({
        filePath: 'README.md',
        content: '# Updated\n',
      }),
    });
    const response = await PUT(request as never, { params: Promise.resolve({ workspaceSessionId: 'ws_123' }) });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(writeWorkspaceFileMock).toHaveBeenCalledWith({
      workspaceSessionId: 'ws_123',
      filePath: 'README.md',
      content: '# Updated\n',
    });
    expect(payload.document.content).toBe('# Updated\n');
  });
});
