const listPresenceMembersMock = jest.fn();
const setPresenceMemberStateMock = jest.fn();
const upsertPresenceMemberMock = jest.fn();

jest.mock('@present/kernel', () => ({
  listPresenceMembers: (...args: unknown[]) => listPresenceMembersMock(...args),
  setPresenceMemberState: (...args: unknown[]) => setPresenceMemberStateMock(...args),
  upsertPresenceMember: (...args: unknown[]) => upsertPresenceMemberMock(...args),
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

describe('/api/reset/presence', () => {
  beforeEach(() => {
    installFetchPrimitives();
    listPresenceMembersMock.mockReset();
    setPresenceMemberStateMock.mockReset();
    upsertPresenceMemberMock.mockReset();
  });

  it('accepts presence metadata during upsert', async () => {
    const { POST } = await import('./route');
    upsertPresenceMemberMock.mockReturnValue({
      id: 'presence_123',
      workspaceSessionId: 'ws_123',
      identity: 'operator-1',
      displayName: 'Mission 0001',
      state: 'connected',
      media: { audio: false, video: false, screen: false },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      metadata: {
        activeFilePath: 'package.json',
      },
    });

    const request = new Request('http://localhost/api/reset/presence', {
      method: 'POST',
      body: JSON.stringify({
        workspaceSessionId: 'ws_123',
        identity: 'operator-1',
        displayName: 'Mission 0001',
        state: 'connected',
        metadata: {
          activeFilePath: 'package.json',
        },
      }),
    });

    const response = await POST(request as never);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(upsertPresenceMemberMock).toHaveBeenCalledWith({
      workspaceSessionId: 'ws_123',
      identity: 'operator-1',
      displayName: 'Mission 0001',
      state: 'connected',
      media: {
        audio: false,
        video: false,
        screen: false,
      },
      metadata: {
        activeFilePath: 'package.json',
      },
    });
    expect(payload.presenceMember.id).toBe('presence_123');
  });
});
