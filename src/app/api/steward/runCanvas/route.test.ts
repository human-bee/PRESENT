/**
 * @jest-environment node
 */

const enqueueTaskMock = jest.fn();
const broadcastAgentPromptMock = jest.fn();
const runCanvasStewardMock = jest.fn();
const resolveRequestUserIdMock = jest.fn();
const assertCanvasMemberMock = jest.fn();
const parseCanvasIdFromRoomMock = jest.fn();
const getDecryptedUserModelKeyMock = jest.fn();
const recordAgentTraceEventMock = jest.fn();

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

jest.mock('@/lib/agents/shared/supabase-context', () => ({
  broadcastAgentPrompt: broadcastAgentPromptMock,
}));

jest.mock('@/lib/agents/subagents/canvas-steward', () => ({
  runCanvasSteward: runCanvasStewardMock,
}));

jest.mock('@/lib/supabase/server/resolve-request-user', () => ({
  resolveRequestUserId: resolveRequestUserIdMock,
}));

jest.mock('@/lib/agents/shared/canvas-billing', () => ({
  assertCanvasMember: assertCanvasMemberMock,
  parseCanvasIdFromRoom: parseCanvasIdFromRoomMock,
}));

jest.mock('@/lib/agents/shared/user-model-keys', () => ({
  getDecryptedUserModelKey: getDecryptedUserModelKeyMock,
}));

jest.mock('@/lib/agents/shared/trace-events', () => ({
  recordAgentTraceEvent: recordAgentTraceEventMock,
}));

const loadPost = async (options?: { queueFallback?: boolean; byok?: boolean }) => {
  byokEnabled = options?.byok ?? false;
  process.env.CANVAS_QUEUE_DIRECT_FALLBACK = options?.queueFallback ? 'true' : 'false';

  let post: ((req: import('next/server').NextRequest) => Promise<Response>) | null = null;
  await jest.isolateModulesAsync(async () => {
    const route = await import('./route');
    post = route.POST;
  });
  return post as (req: import('next/server').NextRequest) => Promise<Response>;
};

const toNextRequest = (request: Request): import('next/server').NextRequest =>
  request as unknown as import('next/server').NextRequest;

describe('/api/steward/runCanvas', () => {
  beforeEach(() => {
    enqueueTaskMock.mockReset();
    broadcastAgentPromptMock.mockReset();
    runCanvasStewardMock.mockReset();
    resolveRequestUserIdMock.mockReset();
    assertCanvasMemberMock.mockReset();
    parseCanvasIdFromRoomMock.mockReset();
    getDecryptedUserModelKeyMock.mockReset();
    recordAgentTraceEventMock.mockReset();

    enqueueTaskMock.mockResolvedValue({ id: 'task-1' });
    broadcastAgentPromptMock.mockResolvedValue(undefined);
    runCanvasStewardMock.mockResolvedValue('ok');
    resolveRequestUserIdMock.mockResolvedValue('user-1');
    parseCanvasIdFromRoomMock.mockReturnValue('canvas-1');
    assertCanvasMemberMock.mockResolvedValue({ ownerUserId: 'owner-1' });
    getDecryptedUserModelKeyMock.mockResolvedValue('sk-test-123');
    recordAgentTraceEventMock.mockResolvedValue(undefined);
  });

  it('queues canvas tasks and broadcasts prompt payload', async () => {
    const POST = await loadPost({ queueFallback: false, byok: false });
    const request = new Request('http://localhost/api/steward/runCanvas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        room: 'demo-room',
        task: 'canvas.agent_prompt',
        message: 'draw a swimlane',
      }),
    });

    const response = await POST(toNextRequest(request));
    const json = await response.json();

    expect(response.status).toBe(202);
    expect(json.status).toBe('queued');
    expect(json.taskId).toBe('task-1');
    expect(enqueueTaskMock).toHaveBeenCalledTimes(1);
    expect(broadcastAgentPromptMock).toHaveBeenCalledTimes(1);
  });

  it('returns 503 when queue is unavailable and direct fallback is disabled', async () => {
    enqueueTaskMock.mockRejectedValueOnce(new Error('queue down'));
    const POST = await loadPost({ queueFallback: false, byok: false });
    const request = new Request('http://localhost/api/steward/runCanvas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        room: 'demo-room',
        task: 'canvas.quick_text',
        message: 'hello',
      }),
    });

    const response = await POST(toNextRequest(request));
    const json = await response.json();

    expect(response.status).toBe(503);
    expect(json.error).toBe('Queue unavailable');
    expect(runCanvasStewardMock).not.toHaveBeenCalled();
  });

  it('executes direct fallback when queue is unavailable and fallback is enabled', async () => {
    enqueueTaskMock.mockRejectedValueOnce(new Error('queue down'));
    const POST = await loadPost({ queueFallback: true, byok: false });
    const request = new Request('http://localhost/api/steward/runCanvas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        room: 'demo-room',
        task: 'canvas.quick_text',
        message: 'hello',
      }),
    });

    const response = await POST(toNextRequest(request));
    const json = await response.json();

    expect(response.status).toBe(202);
    expect(json.status).toBe('executed_fallback');
    expect(runCanvasStewardMock).toHaveBeenCalledWith(
      expect.objectContaining({
        task: 'canvas.quick_text',
      }),
    );
  });

  it('returns 401 when BYOK is enabled and requester is not authenticated', async () => {
    resolveRequestUserIdMock.mockResolvedValueOnce(null);
    const POST = await loadPost({ queueFallback: false, byok: true });
    const request = new Request('http://localhost/api/steward/runCanvas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        room: 'demo-room',
        task: 'canvas.agent_prompt',
        message: 'draw a swimlane',
      }),
    });

    const response = await POST(toNextRequest(request));
    const json = await response.json();

    expect(response.status).toBe(401);
    expect(json.error).toBe('unauthorized');
  });

  it('prefers explicit trace/intent ids over correlation fallback when enqueuing', async () => {
    const POST = await loadPost({ queueFallback: false, byok: false });
    const request = new Request('http://localhost/api/steward/runCanvas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        room: 'demo-room',
        task: 'canvas.agent_prompt',
        requestId: 'req-123',
        traceId: 'trace-explicit',
        intentId: 'intent-explicit',
        message: 'draw a swimlane',
        params: {
          traceId: 'req-123',
          intentId: 'req-123',
          metadata: { traceId: 'req-123', intentId: 'req-123' },
        },
      }),
    });

    const response = await POST(toNextRequest(request));
    expect(response.status).toBe(202);

    const [enqueued] = enqueueTaskMock.mock.calls[0] as [Record<string, any>];
    expect(enqueued.requestId).toBe('req-123');
    expect(enqueued.params.traceId).toBe('trace-explicit');
    expect(enqueued.params.metadata.traceId).toBe('trace-explicit');
    expect(enqueued.params.metadata.intentId).toBe('intent-explicit');
  });

  it('queues fairy.intent with coalescing resource keys and idempotency envelope', async () => {
    const POST = await loadPost({ queueFallback: false, byok: false });
    const request = new Request('http://localhost/api/steward/runCanvas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        room: 'demo-room',
        task: 'fairy.intent',
        requestId: 'req-fairy-1',
        executionId: 'exec-1',
        idempotencyKey: 'idem-1',
        attempt: 2,
        params: {
          message: 'draw a roadmap',
          contextProfile: 'standard',
        },
      }),
    });

    const response = await POST(toNextRequest(request));
    expect(response.status).toBe(202);

    const [enqueued] = enqueueTaskMock.mock.calls[0] as [Record<string, any>];
    expect(enqueued.task).toBe('fairy.intent');
    expect(enqueued.coalesceByResource).toBe(true);
    expect(enqueued.requestId).toBe('req-fairy-1');
    expect(enqueued.dedupeKey).toBe('idem-1');
    expect(enqueued.idempotencyKey).toBe('idem-1');
    expect(enqueued.resourceKeys).toEqual(expect.arrayContaining(['room:demo-room', 'canvas:intent']));
    expect(enqueued.resourceKeys.join(',')).toContain('lock:');
    expect(enqueued.params.executionId).toBe('exec-1');
    expect(enqueued.params.idempotencyKey).toBe('idem-1');
    expect(enqueued.params.attempt).toBe(2);
  });

  it('maps explicit intent id onto fairy.intent params.id', async () => {
    const POST = await loadPost({ queueFallback: false, byok: false });
    const request = new Request('http://localhost/api/steward/runCanvas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        room: 'demo-room',
        task: 'fairy.intent',
        intentId: 'intent-explicit',
        params: {
          message: 'draw',
        },
      }),
    });

    const response = await POST(toNextRequest(request));
    expect(response.status).toBe(202);

    const [enqueued] = enqueueTaskMock.mock.calls[0] as [Record<string, any>];
    expect(enqueued.params.id).toBe('intent-explicit');
    expect(enqueued.params.metadata.intentId).toBe('intent-explicit');
  });
});
