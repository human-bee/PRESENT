/**
 * @jest-environment node
 */

const enqueueTaskMock = jest.fn();
const recordTaskTraceFromParamsMock = jest.fn();
const resolveRequestUserIdMock = jest.fn();
const assertCanvasMemberMock = jest.fn();
const parseCanvasIdFromRoomMock = jest.fn();

let byokEnabled = false;

jest.mock('@/lib/agents/shared/queue', () => ({
  AgentTaskQueue: jest.fn().mockImplementation(() => ({
    enqueueTask: enqueueTaskMock,
  })),
}));

jest.mock('@/lib/agents/shared/byok-flags', () => ({
  get BYOK_ENABLED() {
    return byokEnabled;
  },
}));

jest.mock('@/lib/supabase/server/resolve-request-user', () => ({
  resolveRequestUserId: (...args: unknown[]) => resolveRequestUserIdMock(...args),
}));

jest.mock('@/lib/agents/shared/canvas-billing', () => ({
  assertCanvasMember: (...args: unknown[]) => assertCanvasMemberMock(...args),
  parseCanvasIdFromRoom: (...args: unknown[]) => parseCanvasIdFromRoomMock(...args),
}));

jest.mock('@/lib/agents/shared/trace-events', () => ({
  recordTaskTraceFromParams: (...args: unknown[]) => recordTaskTraceFromParamsMock(...args),
}));

jest.mock('@/lib/logging', () => ({
  createLogger: () => ({
    warn: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  }),
}));

const loadPost = async (options?: { byok?: boolean }) => {
  byokEnabled = options?.byok ?? false;
  let post: ((req: import('next/server').NextRequest) => Promise<Response>) | null = null;
  await jest.isolateModulesAsync(async () => {
    const route = await import('./route');
    post = route.POST;
  });
  return post as (req: import('next/server').NextRequest) => Promise<Response>;
};

const toNextRequest = (request: Request): import('next/server').NextRequest =>
  request as unknown as import('next/server').NextRequest;

describe('/api/agent/enqueue', () => {
  beforeEach(() => {
    byokEnabled = false;
    enqueueTaskMock.mockReset();
    recordTaskTraceFromParamsMock.mockReset();
    resolveRequestUserIdMock.mockReset();
    assertCanvasMemberMock.mockReset();
    parseCanvasIdFromRoomMock.mockReset();

    enqueueTaskMock.mockResolvedValue({ id: 'task-1', status: 'queued' });
    recordTaskTraceFromParamsMock.mockResolvedValue(undefined);
    resolveRequestUserIdMock.mockResolvedValue('user-1');
    parseCanvasIdFromRoomMock.mockReturnValue('canvas-1');
    assertCanvasMemberMock.mockResolvedValue({ ownerUserId: 'owner-1' });
  });

  it('queues tasks without waiting for trace storage', async () => {
    recordTaskTraceFromParamsMock.mockReturnValueOnce(new Promise(() => {}));
    const POST = await loadPost();
    const request = new Request('http://localhost/api/agent/enqueue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        room: 'canvas-room',
        task: 'canvas.agent_prompt',
        params: {
          message: 'draw a map',
          requestId: 'request-1',
        },
      }),
    });

    const response = await POST(toNextRequest(request));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toMatchObject({
      status: 'queued',
      task: { id: 'task-1' },
    });
    expect(recordTaskTraceFromParamsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: 'api_received',
        task: 'canvas.agent_prompt',
        room: 'canvas-room',
      }),
    );
    expect(enqueueTaskMock).toHaveBeenCalledWith(
      expect.objectContaining({
        room: 'canvas-room',
        task: 'canvas.agent_prompt',
      }),
    );
  });

  it('keeps BYOK auth and billing injection ahead of enqueue while trace storage is pending', async () => {
    recordTaskTraceFromParamsMock.mockReturnValueOnce(new Promise(() => {}));
    const POST = await loadPost({ byok: true });
    const request = new Request('http://localhost/api/agent/enqueue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        room: 'canvas-canvas-1',
        task: 'canvas.agent_prompt',
        params: {
          message: 'draw a map',
        },
      }),
    });

    const response = await POST(toNextRequest(request));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toMatchObject({
      status: 'queued',
      task: { id: 'task-1' },
    });
    expect(resolveRequestUserIdMock).toHaveBeenCalledWith(expect.any(Request));
    expect(assertCanvasMemberMock).toHaveBeenCalledWith({
      canvasId: 'canvas-1',
      requesterUserId: 'user-1',
    });
    expect(enqueueTaskMock).toHaveBeenCalledWith(
      expect.objectContaining({
        params: expect.objectContaining({
          billingUserId: 'owner-1',
        }),
      }),
    );
  });
});
