const getTaskRunMock = jest.fn();
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
    private rawBody: ArrayBuffer | Blob | ReadableStream<Uint8Array> | Uint8Array | string | null;
    private textBody: string | null;

    constructor(
      body: ArrayBuffer | Blob | ReadableStream<Uint8Array> | Uint8Array | string = '',
      init: { status?: number; headers?: Record<string, string> } = {},
    ) {
      this.status = init.status ?? 200;
      this.headers = new MockHeaders(init.headers ?? {});
      this.body = body instanceof ReadableStream ? body : null;
      this.rawBody = body;
      this.textBody =
        typeof body === 'string'
          ? body
          : body instanceof Uint8Array
            ? new TextDecoder().decode(body)
            : body instanceof ArrayBuffer
              ? new TextDecoder().decode(new Uint8Array(body))
              : null;
    }

    static json(data: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
      return new MockResponse(JSON.stringify(data), {
        ...init,
        headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
      });
    }

    async text() {
      if (this.textBody !== null) return this.textBody;
      if (this.rawBody instanceof Blob) {
        this.textBody = await this.rawBody.text();
        return this.textBody;
      }
      if (this.rawBody instanceof ReadableStream) {
        const reader = this.rawBody.getReader();
        const decoder = new TextDecoder();
        let text = '';
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          text += decoder.decode(chunk.value, { stream: true });
        }
        this.textBody = text + decoder.decode();
        return this.textBody;
      }
      this.textBody = this.rawBody == null ? '' : String(this.rawBody);
      return this.textBody;
    }

    async json() {
      return JSON.parse(await this.text());
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
}));

jest.mock('next/server', () => ({
  NextResponse: {
    json: (data: unknown, init?: { status?: number; headers?: Record<string, string> }) =>
      Response.json(data, init),
  },
}));

jest.mock('../../_lib/persistence', () => ({
  hydrateResetKernel: (...args: unknown[]) => hydrateResetKernelMock(...args),
}));

describe('/api/reset/tasks/[taskId]', () => {
  beforeEach(() => {
    installFetchPrimitives();
    getTaskRunMock.mockReset();
    hydrateResetKernelMock.mockReset();
  });

  it('returns the requested task run', async () => {
    const { GET } = await import('./route');
    getTaskRunMock.mockResolvedValue({
      id: 'task_123',
      workspaceSessionId: 'ws_123',
      summary: 'Canvas task',
    });

    const response = await GET(new Request('http://localhost/api/reset/tasks/task_123') as never, {
      params: Promise.resolve({ taskId: 'task_123' }),
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(hydrateResetKernelMock).toHaveBeenCalled();
    expect(getTaskRunMock).toHaveBeenCalledWith('task_123');
    expect(payload.taskRun.id).toBe('task_123');
  });

  it('returns 404 when the task is missing', async () => {
    const { GET } = await import('./route');
    getTaskRunMock.mockResolvedValue(null);

    const response = await GET(new Request('http://localhost/api/reset/tasks/task_missing') as never, {
      params: Promise.resolve({ taskId: 'task_missing' }),
    });

    expect(response.status).toBe(404);
  });
});
