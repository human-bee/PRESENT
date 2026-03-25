const applyArtifactPatchMock = jest.fn();
const hydrateResetKernelMock = jest.fn();
const flushResetKernelWritesMock = jest.fn();

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
  applyArtifactPatch: (...args: unknown[]) => applyArtifactPatchMock(...args),
}));

jest.mock('next/server', () => ({
  NextResponse: {
    json: (data: unknown, init?: { status?: number; headers?: Record<string, string> }) =>
      Response.json(data, init),
  },
}));

jest.mock('../../../_lib/persistence', () => ({
  hydrateResetKernel: (...args: unknown[]) => hydrateResetKernelMock(...args),
  flushResetKernelWrites: (...args: unknown[]) => flushResetKernelWritesMock(...args),
}));

describe('/api/reset/artifacts/[artifactId]/apply', () => {
  beforeEach(() => {
    installFetchPrimitives();
    applyArtifactPatchMock.mockReset();
    hydrateResetKernelMock.mockReset();
    flushResetKernelWritesMock.mockReset();
  });

  it('applies a patch artifact and persists the write', async () => {
    const { POST } = await import('./route');
    applyArtifactPatchMock.mockReturnValue({
      id: 'artifact_123',
      appliedAt: new Date().toISOString(),
    });

    const response = await POST(new Request('http://localhost/api/reset/artifacts/artifact_123/apply') as never, {
      params: Promise.resolve({ artifactId: 'artifact_123' }),
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(hydrateResetKernelMock).toHaveBeenCalled();
    expect(applyArtifactPatchMock).toHaveBeenCalledWith('artifact_123');
    expect(flushResetKernelWritesMock).toHaveBeenCalled();
    expect(payload.artifact.id).toBe('artifact_123');
  });

  it('returns 404 when the artifact is missing', async () => {
    const { POST } = await import('./route');
    applyArtifactPatchMock.mockImplementation(() => {
      throw new Error('Artifact not found');
    });

    const response = await POST(new Request('http://localhost/api/reset/artifacts/missing/apply') as never, {
      params: Promise.resolve({ artifactId: 'missing' }),
    });
    const payload = await response.json();

    expect(response.status).toBe(404);
    expect(flushResetKernelWritesMock).not.toHaveBeenCalled();
    expect(payload.error).toBe('Artifact not found');
  });
});
