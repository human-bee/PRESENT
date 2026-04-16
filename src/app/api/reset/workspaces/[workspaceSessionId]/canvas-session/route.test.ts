import path from 'node:path';
import { createTaskRun, openWorkspaceSession, resetKernelStateForTests } from '@present/kernel';

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

describe('GET /api/reset/workspaces/[workspaceSessionId]/canvas-session', () => {
  beforeEach(() => {
    process.env.PRESENT_RESET_STATE_PATH = path.join(
      process.cwd(),
      '.tmp',
      `present-reset-state-canvas-session-route-${Date.now()}-${Math.random()}.json`,
    );
    resetKernelStateForTests();
  });

  afterEach(() => {
    resetKernelStateForTests();
    delete process.env.PRESENT_RESET_STATE_PATH;
  });

  it('returns a projected canvas session snapshot for the workspace', async () => {
    installFetchPrimitives();
    const { GET } = await import('./route');
    const workspace = openWorkspaceSession({
      workspacePath: process.cwd(),
      title: 'Canvas Session Route',
      branch: 'codex/reset',
    });

    createTaskRun({
      workspaceSessionId: workspace.id,
      summary: 'Projected task',
      taskType: 'canvas.run',
      traceId: 'trace_canvas_route',
      status: 'queued',
    });

    const response = await GET(
      {
        url: `http://localhost/api/reset/workspaces/${workspace.id}/canvas-session?traceLimit=8`,
      } as Request,
      {
        params: Promise.resolve({ workspaceSessionId: workspace.id }),
      },
    );

    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(payload.workspace.id).toBe(workspace.id);
    expect(payload.room.roomId).toBe(`reset-${workspace.id}`);
    expect(Array.isArray(payload.nodes)).toBe(true);
    expect(payload.nodes.some((node: { kind: string }) => node.kind === 'run-lane')).toBe(true);
  });
});
