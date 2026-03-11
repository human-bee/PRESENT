const startCodexTurnMock = jest.fn();

jest.mock('@present/codex-adapter', () => ({
  startCodexTurn: (...args: unknown[]) => startCodexTurnMock(...args),
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

describe('POST /api/reset/turns', () => {
  beforeEach(() => {
    startCodexTurnMock.mockReset();
  });

  it('starts a turn and returns 202', async () => {
    installFetchPrimitives();
    const { POST } = await import('./route');
    startCodexTurnMock.mockResolvedValue({
      id: 'task_123',
      workspaceSessionId: 'ws_123',
      traceId: 'trace_123',
      taskType: 'codex.turn',
      status: 'queued',
      requestId: null,
      dedupeKey: null,
      summary: 'Turn',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      startedAt: null,
      completedAt: null,
      result: null,
      error: null,
      metadata: {},
    });

    const request = new Request('http://localhost/api/reset/turns', {
      method: 'POST',
      body: JSON.stringify({
        workspaceSessionId: 'ws_123',
        prompt: 'Implement the feature',
        summary: 'Turn',
      }),
      headers: { 'Content-Type': 'application/json' },
    });

    const response = await POST(request as never);
    const payload = await response.json();

    expect(response.status).toBe(202);
    expect(startCodexTurnMock).toHaveBeenCalledWith({
      workspaceSessionId: 'ws_123',
      prompt: 'Implement the feature',
      summary: 'Turn',
    });
    expect(payload.taskRun.id).toBe('task_123');
  });
});
