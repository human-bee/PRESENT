import path from 'node:path';
import { openWorkspaceSession, recordKernelEvent, resetKernelStateForTests } from '@present/kernel';

const installFetchPrimitives = () => {
  class MockHeaders {
    constructor(public init: Record<string, string> = {}) {}
    get(name: string) {
      return this.init[name] ?? this.init[name.toLowerCase()] ?? null;
    }
  }

  class MockRequest {
    url: string;
    constructor(input: string) {
      this.url = input;
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

describe('GET /api/reset/workspaces/[workspaceSessionId]/state', () => {
  beforeEach(() => {
    process.env.PRESENT_RESET_STATE_PATH = path.join(
      process.cwd(),
      '.tmp',
      `present-reset-state-route-${Date.now()}-${Math.random()}.json`,
    );
    resetKernelStateForTests();
  });

  afterEach(() => {
    resetKernelStateForTests();
    delete process.env.PRESENT_RESET_STATE_PATH;
  });

  it('returns an aggregated workspace snapshot', async () => {
    installFetchPrimitives();
    const { GET } = await import('./route');
    const workspace = openWorkspaceSession({
      workspacePath: process.cwd(),
      title: 'Snapshot Route',
      branch: 'codex/reset',
    });

    const response = await GET({} as never, {
      params: Promise.resolve({ workspaceSessionId: workspace.id }),
    });

    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(payload.workspace.id).toBe(workspace.id);
    expect(Array.isArray(payload.tasks)).toBe(true);
    expect(Array.isArray(payload.artifacts)).toBe(true);
  });

  it('supports filtered trace windows and can skip heavy snapshot fields', async () => {
    installFetchPrimitives();
    const { GET } = await import('./route');
    const workspace = openWorkspaceSession({
      workspacePath: process.cwd(),
      title: 'Trace Filter Route',
      branch: 'codex/reset',
    });

    recordKernelEvent({
      id: 'evt_turn',
      type: 'approval.requested',
      traceId: 'trace_route',
      workspaceSessionId: workspace.id,
      emittedAt: '2026-03-24T12:00:00.000Z',
      approvalRequestId: 'approval_1',
      state: 'pending',
      summary: 'turn queued',
      metadata: {},
    });
    recordKernelEvent({
      id: 'evt_approval',
      type: 'approval.requested',
      traceId: 'trace_route',
      workspaceSessionId: workspace.id,
      emittedAt: '2026-03-24T12:00:05.000Z',
      approvalRequestId: 'approval_2',
      state: 'pending',
      summary: 'needs approval',
      metadata: {},
    });

    const response = await GET(
      {
        url: `http://localhost/api/reset/workspaces/${workspace.id}/state?traceQuery=approval&traceLimit=1&includeManifest=false`,
      } as Request,
      {
        params: Promise.resolve({ workspaceSessionId: workspace.id }),
      },
    );

    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(payload.traces).toHaveLength(1);
    expect(payload.traces[0].id).toBe('evt_approval');
    expect(payload.manifest).toBeUndefined();
  });
});
