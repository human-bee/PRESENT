const getTaskRunMock = jest.fn();
const listTraceEventsMock = jest.fn();
const hydrateResetKernelMock = jest.fn();

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
    signal: AbortSignal;

    constructor(input: string) {
      this.url = input;
      this.nextUrl = new URL(input);
      this.signal = new AbortController().signal;
    }
  }

  class MockResponse {
    status: number;
    headers: MockHeaders;
    body: ReadableStream<Uint8Array> | null;
    private textBody: string;

    constructor(
      body: ReadableStream<Uint8Array> | string = '',
      init: { status?: number; headers?: Record<string, string> } = {},
    ) {
      this.status = init.status ?? 200;
      this.headers = new MockHeaders(init.headers ?? {});
      this.body = body instanceof ReadableStream ? body : null;
      this.textBody = typeof body === 'string' ? body : '';
    }

    async json() {
      return JSON.parse(this.textBody);
    }
  }

  Object.assign(global, {
    Headers: MockHeaders,
    Request: MockRequest,
    Response: MockResponse,
  });
};

jest.mock('@present/kernel', () => ({
  getTaskRun: (...args: unknown[]) => getTaskRunMock(...args),
  listTraceEvents: (...args: unknown[]) => listTraceEventsMock(...args),
}));

jest.mock('../../../_lib/persistence', () => ({
  hydrateResetKernel: (...args: unknown[]) => hydrateResetKernelMock(...args),
}));

async function readResponseBody(response: Response) {
  const reader = response.body?.getReader();
  if (!reader) return '';
  const decoder = new TextDecoder();
  let text = '';

  while (true) {
    const result = await reader.read();
    if (result.done) break;
    text += decoder.decode(result.value, { stream: true });
  }

  return text + decoder.decode();
}

describe('/api/reset/tasks/[taskId]/events', () => {
  beforeEach(() => {
    installFetchPrimitives();
    getTaskRunMock.mockReset();
    listTraceEventsMock.mockReset();
    hydrateResetKernelMock.mockReset();
  });

  it('streams task and trace events until terminal completion', async () => {
    const { GET } = await import('./route');
    getTaskRunMock.mockResolvedValue({
      id: 'task_123',
      traceId: 'trace_123',
      status: 'succeeded',
      workspaceSessionId: 'ws_123',
      summary: 'Canvas task',
    });
    listTraceEventsMock.mockReturnValue([
      {
        id: 'evt_123',
        traceId: 'trace_123',
        workspaceSessionId: 'ws_123',
        emittedAt: new Date().toISOString(),
        type: 'turn.completed',
        taskRunId: 'task_123',
        title: 'Canvas task',
        detail: null,
        metadata: {},
      },
    ]);

    const request = new Request('http://localhost/api/reset/tasks/task_123/events');
    const response = await GET(request, {
      params: Promise.resolve({ taskId: 'task_123' }),
    });
    const body = await readResponseBody(response);

    expect(response.status).toBe(200);
    expect(hydrateResetKernelMock).toHaveBeenCalled();
    expect(body).toContain('event: task');
    expect(body).toContain('event: trace');
    expect(body).toContain('event: done');
  });

  it('returns 404 when the task does not exist', async () => {
    const { GET } = await import('./route');
    getTaskRunMock.mockResolvedValue(null);

    const response = await GET(new Request('http://localhost/api/reset/tasks/missing/events'), {
      params: Promise.resolve({ taskId: 'missing' }),
    });

    expect(response.status).toBe(404);
  });
});
