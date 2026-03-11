/**
 * @jest-environment node
 */

const enqueueTaskMock = jest.fn();
const resolveRequestUserIdMock = jest.fn();
const assertCanvasMemberMock = jest.fn();
const parseCanvasIdFromRoomMock = jest.fn();
const getTimelineDocumentMock = jest.fn();
const commitTimelineDocumentMock = jest.fn();
const runTimelineStewardFastMock = jest.fn();

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
  get DEV_BYPASS_ENABLED() {
    return process.env.NEXT_PUBLIC_CANVAS_DEV_BYPASS === 'true';
  },
}));

jest.mock('@/lib/supabase/server/resolve-request-user', () => ({
  resolveRequestUserId: resolveRequestUserIdMock,
}));

jest.mock('@/lib/agents/shared/canvas-billing', () => ({
  assertCanvasMember: assertCanvasMemberMock,
  parseCanvasIdFromRoom: parseCanvasIdFromRoomMock,
}));

jest.mock('@/lib/agents/shared/supabase-context', () => ({
  getTimelineDocument: getTimelineDocumentMock,
  commitTimelineDocument: commitTimelineDocumentMock,
}));

jest.mock('@/lib/agents/subagents/timeline-steward-fast', () => ({
  runTimelineStewardFast: runTimelineStewardFastMock,
}));

const loadPost = async (options?: { queueFallback?: boolean; byok?: boolean }) => {
  byokEnabled = options?.byok ?? false;
  process.env.TIMELINE_QUEUE_DIRECT_FALLBACK = options?.queueFallback ? 'true' : 'false';

  let post: ((req: import('next/server').NextRequest) => Promise<Response>) | null = null;
  await jest.isolateModulesAsync(async () => {
    const route = await import('./route');
    post = route.POST;
  });
  return post as (req: import('next/server').NextRequest) => Promise<Response>;
};

const toNextRequest = (request: Request): import('next/server').NextRequest =>
  request as unknown as import('next/server').NextRequest;

describe('/api/steward/runTimeline', () => {
  const originalDevBypass = process.env.NEXT_PUBLIC_CANVAS_DEV_BYPASS;
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    process.env.NEXT_PUBLIC_CANVAS_DEV_BYPASS = 'false';
    process.env.NODE_ENV = 'test';
    enqueueTaskMock.mockReset();
    resolveRequestUserIdMock.mockReset();
    assertCanvasMemberMock.mockReset();
    parseCanvasIdFromRoomMock.mockReset();
    getTimelineDocumentMock.mockReset();
    commitTimelineDocumentMock.mockReset();
    runTimelineStewardFastMock.mockReset();

    enqueueTaskMock.mockResolvedValue({ id: 'task-timeline-1' });
    resolveRequestUserIdMock.mockResolvedValue('user-1');
    assertCanvasMemberMock.mockResolvedValue({ ownerUserId: 'owner-1' });
    parseCanvasIdFromRoomMock.mockReturnValue('canvas-1');
    getTimelineDocumentMock.mockResolvedValue({
      document: {
        componentId: 'timeline-1',
        title: 'Timeline',
        subtitle: 'Roadmap',
        horizonLabel: 'Now',
        lanes: [],
        items: [],
        dependencies: [],
        events: [],
        sync: { status: 'idle', pendingExports: [] },
        version: 0,
        lastUpdated: 0,
      },
      version: 0,
      lastUpdated: 0,
    });
    commitTimelineDocumentMock.mockResolvedValue({
      document: {
        componentId: 'timeline-1',
        title: 'Timeline',
        subtitle: 'Roadmap',
        horizonLabel: 'Now',
        lanes: [],
        items: [],
        dependencies: [],
        events: [],
        sync: { status: 'live', pendingExports: [] },
        version: 1,
        lastUpdated: 1,
      },
      version: 1,
      lastUpdated: 1,
    });
    runTimelineStewardFastMock.mockResolvedValue({
      summary: 'Timeline updated',
      ops: [],
    });
  });

  afterAll(() => {
    if (originalDevBypass === undefined) {
      delete process.env.NEXT_PUBLIC_CANVAS_DEV_BYPASS;
    } else {
      process.env.NEXT_PUBLIC_CANVAS_DEV_BYPASS = originalDevBypass;
    }
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }
  });

  it('queues timeline patch tasks and returns correlation ids', async () => {
    const POST = await loadPost({ queueFallback: false, byok: false });
    const request = new Request('http://localhost/api/steward/runTimeline', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        room: 'demo-room',
        componentId: 'timeline-1',
        task: 'timeline.patch',
        requestId: 'timeline-request-1',
        source: 'tool',
        ops: [
          {
            type: 'set_meta',
            title: 'Launch Roadmap',
          },
        ],
      }),
    });

    const response = await POST(toNextRequest(request));
    const json = await response.json();

    expect(response.status).toBe(202);
    expect(json.status).toBe('queued');
    expect(json.taskId).toBe('task-timeline-1');
    expect(typeof json.requestId).toBe('string');
    expect(typeof json.traceId).toBe('string');
    expect(typeof json.intentId).toBe('string');
    expect(enqueueTaskMock).toHaveBeenCalledTimes(1);
    const [enqueued] = enqueueTaskMock.mock.calls[0] as [Record<string, unknown>];
    expect(enqueued.resourceKeys).toEqual(expect.arrayContaining(['room:demo-room', 'timeline:timeline-1']));
    expect(enqueued.dedupeKey).toBe('timeline-request-1');
    expect(enqueued.idempotencyKey).toBe('timeline-request-1');
  });

  it('returns 503 when queue fails and direct fallback is disabled', async () => {
    enqueueTaskMock.mockRejectedValueOnce(new Error('queue down'));
    const POST = await loadPost({ queueFallback: false, byok: false });
    const request = new Request('http://localhost/api/steward/runTimeline', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        room: 'demo-room',
        componentId: 'timeline-1',
        task: 'timeline.run',
        instruction: 'Turn this into a roadmap',
      }),
    });

    const response = await POST(toNextRequest(request));
    const json = await response.json();

    expect(response.status).toBe(503);
    expect(json.error).toBe('Queue unavailable');
    expect(runTimelineStewardFastMock).not.toHaveBeenCalled();
    expect(commitTimelineDocumentMock).not.toHaveBeenCalled();
  });

  it('executes patch fallback when queue fallback is enabled', async () => {
    enqueueTaskMock.mockRejectedValueOnce(new Error('queue down'));
    const POST = await loadPost({ queueFallback: true, byok: false });
    const request = new Request('http://localhost/api/steward/runTimeline', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        room: 'demo-room',
        componentId: 'timeline-1',
        task: 'timeline.patch',
        ops: [
          {
            type: 'set_meta',
            title: 'Launch Roadmap',
          },
        ],
      }),
    });

    const response = await POST(toNextRequest(request));
    const json = await response.json();

    expect(response.status).toBe(202);
    expect(json.status).toBe('executed_fallback');
    expect(commitTimelineDocumentMock).toHaveBeenCalledWith(
      'demo-room',
      'timeline-1',
      expect.objectContaining({
        componentType: 'McpAppWidget',
      }),
    );
  });

  it('returns 401 when requester is not authenticated', async () => {
    resolveRequestUserIdMock.mockResolvedValueOnce(null);
    const POST = await loadPost({ queueFallback: false, byok: false });
    const request = new Request('http://localhost/api/steward/runTimeline', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        room: 'demo-room',
        componentId: 'timeline-1',
        task: 'timeline.run',
      }),
    });

    const response = await POST(toNextRequest(request));
    const json = await response.json();

    expect(response.status).toBe(401);
    expect(json.error).toBe('unauthorized');
  });

  it('returns 403 when requester is not a canvas member', async () => {
    const err = new Error('Forbidden') as Error & { code?: string };
    err.code = 'forbidden';
    assertCanvasMemberMock.mockRejectedValueOnce(err);

    const POST = await loadPost({ queueFallback: false, byok: false });
    const request = new Request('http://localhost/api/steward/runTimeline', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        room: 'demo-room',
        componentId: 'timeline-1',
        task: 'timeline.patch',
        ops: [{ type: 'set_meta', title: 'Launch Roadmap' }],
      }),
    });

    const response = await POST(toNextRequest(request));
    const json = await response.json();

    expect(response.status).toBe(403);
    expect(json.error).toBe('forbidden');
  });

  it('allows unauthenticated access when dev bypass is enabled outside production', async () => {
    process.env.NEXT_PUBLIC_CANVAS_DEV_BYPASS = 'true';
    resolveRequestUserIdMock.mockResolvedValueOnce(null);

    const POST = await loadPost({ queueFallback: false, byok: false });
    const request = new Request('http://localhost/api/steward/runTimeline', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        room: 'demo-room',
        componentId: 'timeline-1',
        task: 'timeline.patch',
        ops: [{ type: 'set_meta', title: 'Launch Roadmap' }],
      }),
    });

    const response = await POST(toNextRequest(request));
    const json = await response.json();

    expect(response.status).toBe(202);
    expect(json.status).toBe('queued');
    expect(assertCanvasMemberMock).not.toHaveBeenCalled();
  });
});
