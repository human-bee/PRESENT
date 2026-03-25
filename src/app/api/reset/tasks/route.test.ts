const enqueueTaskRunMock = jest.fn();
const listTaskRunsMock = jest.fn();
const hydrateResetKernelMock = jest.fn();
const flushResetKernelWritesMock = jest.fn();

jest.mock('@present/kernel', () => ({
  enqueueTaskRun: (...args: unknown[]) => enqueueTaskRunMock(...args),
  listTaskRuns: (...args: unknown[]) => listTaskRunsMock(...args),
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

describe('/api/reset/tasks', () => {
  beforeEach(() => {
    installFetchPrimitives();
    enqueueTaskRunMock.mockReset();
    listTaskRunsMock.mockReset();
    hydrateResetKernelMock.mockReset();
    flushResetKernelWritesMock.mockReset();
  });

  it('lists tasks for the requested workspace', async () => {
    const { GET } = await import('./route');
    listTaskRunsMock.mockReturnValue([{ id: 'task_123', summary: 'Canvas task' }]);

    const response = await GET(new Request('http://localhost/api/reset/tasks?workspaceSessionId=ws_123') as never);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(hydrateResetKernelMock).toHaveBeenCalled();
    expect(listTaskRunsMock).toHaveBeenCalledWith('ws_123');
    expect(payload.tasks[0]?.id).toBe('task_123');
  });

  it('queues reset tasks with prompt params', async () => {
    const { POST } = await import('./route');
    enqueueTaskRunMock.mockResolvedValue({
      id: 'task_123',
      workspaceSessionId: 'ws_123',
      summary: 'Canvas task',
      taskType: 'canvas.run',
    });

    const request = new Request('http://localhost/api/reset/tasks', {
      body: JSON.stringify({
        workspaceSessionId: 'ws_123',
        summary: 'Canvas task',
        taskType: 'canvas.run',
        prompt: 'Render a board artifact',
      }),
    });
    const response = await POST(request as never);
    const payload = await response.json();

    expect(response.status).toBe(202);
    expect(enqueueTaskRunMock).toHaveBeenCalledWith({
      workspaceSessionId: 'ws_123',
      summary: 'Canvas task',
      taskType: 'canvas.run',
      room: undefined,
      requestId: undefined,
      dedupeKey: undefined,
      params: { prompt: 'Render a board artifact' },
    });
    expect(flushResetKernelWritesMock).toHaveBeenCalled();
    expect(payload.taskRun.id).toBe('task_123');
  });
});
