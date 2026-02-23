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

const loadPost = async (options?: { queueFallback?: boolean; byok?: boolean; strictTrace?: boolean }) => {
  byokEnabled = options?.byok ?? false;
  process.env.CANVAS_QUEUE_DIRECT_FALLBACK = options?.queueFallback ? 'true' : 'false';
  process.env.CANVAS_REQUIRE_TASK_TRACE_ID = options?.strictTrace ? 'true' : 'false';

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

  it('records structured queue error text instead of object cast noise', async () => {
    enqueueTaskMock.mockRejectedValueOnce({
      code: 'PGRST204',
      message: "Could not find the 'trace_id' column in schema cache",
      details: 'agent_tasks.trace_id missing',
    });
    const POST = await loadPost({ queueFallback: false, byok: false });
    const request = new Request('http://localhost/api/steward/runCanvas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        room: 'demo-room',
        task: 'fairy.intent',
        message: 'draw bunny',
      }),
    });

    const response = await POST(toNextRequest(request));
    expect(response.status).toBe(503);

    const queueErrorCall = recordAgentTraceEventMock.mock.calls.find(
      (call) => call?.[0]?.stage === 'fallback',
    );
    expect(queueErrorCall?.[0]?.status).toBe('queue_error');
    expect(String(queueErrorCall?.[0]?.payload?.reason || '')).toContain('trace_id');
    expect(String(queueErrorCall?.[0]?.payload?.reason || '')).not.toContain('[object Object]');
  });

  it('returns strict trace integrity error without direct fallback when queue rejects trace guarantees', async () => {
    enqueueTaskMock.mockRejectedValueOnce(new Error('TRACE_ID_COLUMN_REQUIRED:fairy.intent'));
    const POST = await loadPost({ queueFallback: true, byok: false, strictTrace: true });
    const request = new Request('http://localhost/api/steward/runCanvas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        room: 'demo-room',
        task: 'fairy.intent',
        requestId: 'req-strict-trace',
        params: {
          message: 'draw bunny',
        },
      }),
    });

    const response = await POST(toNextRequest(request));
    const json = await response.json();

    expect(response.status).toBe(503);
    expect(json).toMatchObject({
      error: 'Queue trace integrity check failed',
      code: 'queue_trace_integrity_error',
    });
    const [enqueued] = enqueueTaskMock.mock.calls[0] as [Record<string, unknown>];
    expect(enqueued.requireTraceId).toBe(true);
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

    const [enqueued] = enqueueTaskMock.mock.calls[0] as [Record<string, unknown>];
    const params = enqueued.params as Record<string, unknown>;
    const metadata = params.metadata as Record<string, unknown>;
    expect(enqueued.requestId).toBe('req-123');
    expect(params.traceId).toBe('trace-explicit');
    expect(metadata.traceId).toBe('trace-explicit');
    expect(metadata.intentId).toBe('intent-explicit');
  });

  it('propagates experiment assignment metadata through queue params and response diagnostics', async () => {
    const POST = await loadPost({ queueFallback: false, byok: false });
    const request = new Request('http://localhost/api/steward/runCanvas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        room: 'demo-room',
        task: 'fairy.intent',
        message: 'draw a roadmap',
        experiment_id: 'voice_toolset_factorial_v1',
        variant_id: 'v11',
        assignment_namespace: 'voice_toolset_factorial_v1',
        assignment_unit: 'room_session',
        assignment_ts: '2026-02-23T03:21:00.000Z',
        factor_levels: {
          initial_toolset: 'lean_adaptive',
          lazy_load_policy: 'locked_session',
          instruction_pack: 'capability_explicit',
          harness_mode: 'queue_first',
        },
      }),
    });

    const response = await POST(toNextRequest(request));
    const json = await response.json();

    expect(response.status).toBe(202);
    expect(json.experiment).toMatchObject({
      experimentId: 'voice_toolset_factorial_v1',
      variantId: 'v11',
      assignmentNamespace: 'voice_toolset_factorial_v1',
      assignmentUnit: 'room_session',
    });
    const [enqueued] = enqueueTaskMock.mock.calls[0] as [Record<string, unknown>];
    const params = enqueued.params as Record<string, unknown>;
    const metadata = params.metadata as Record<string, unknown>;
    const experiment = metadata.experiment as Record<string, unknown>;
    expect(experiment.experiment_id).toBe('voice_toolset_factorial_v1');
    expect(experiment.variant_id).toBe('v11');
    expect((experiment.factor_levels as Record<string, unknown>).harness_mode).toBe('queue_first');
  });

  it('queues fairy.intent without resource coalescing and preserves idempotency envelope', async () => {
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

    const [enqueued] = enqueueTaskMock.mock.calls[0] as [Record<string, unknown>];
    const params = enqueued.params as Record<string, unknown>;
    const resourceKeys = enqueued.resourceKeys as string[];
    expect(enqueued.task).toBe('fairy.intent');
    expect(enqueued.coalesceByResource).toBe(false);
    expect(enqueued.requireTraceId).toBe(false);
    expect(enqueued.requestId).toBe('req-fairy-1');
    expect(enqueued.dedupeKey).toBe('idem-1');
    expect(enqueued.idempotencyKey).toBe('idem-1');
    expect(resourceKeys).toEqual(expect.arrayContaining(['room:demo-room', 'canvas:intent']));
    expect(resourceKeys.join(',')).toContain('lock:');
    expect(params.executionId).toBe('exec-1');
    expect(params.idempotencyKey).toBe('idem-1');
    expect(params.attempt).toBe(2);
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

    const [enqueued] = enqueueTaskMock.mock.calls[0] as [Record<string, unknown>];
    const params = enqueued.params as Record<string, unknown>;
    const metadata = params.metadata as Record<string, unknown>;
    expect(params.id).toBe('intent-explicit');
    expect(metadata.intentId).toBe('intent-explicit');
  });

  it('stamps runtime scope onto params and resource keys', async () => {
    const previousLivekitUrl = process.env.LIVEKIT_URL;
    process.env.LIVEKIT_URL = 'ws://localhost:7880';
    try {
      const POST = await loadPost({ queueFallback: false, byok: false });
      const request = new Request('http://localhost/api/steward/runCanvas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          room: 'demo-room',
          task: 'fairy.intent',
          message: 'draw bunny',
        }),
      });

      const response = await POST(toNextRequest(request));
      expect(response.status).toBe(202);

      const [enqueued] = enqueueTaskMock.mock.calls[0] as [Record<string, unknown>];
      const params = enqueued.params as Record<string, unknown>;
      const metadata = params.metadata as Record<string, unknown>;
      const resourceKeys = enqueued.resourceKeys as string[];
      expect(params.runtimeScope).toBe('localhost:7880');
      expect(metadata.runtimeScope).toBe('localhost:7880');
      expect(resourceKeys).toEqual(expect.arrayContaining(['runtime-scope:localhost:7880']));
    } finally {
      if (previousLivekitUrl === undefined) {
        delete process.env.LIVEKIT_URL;
      } else {
        process.env.LIVEKIT_URL = previousLivekitUrl;
      }
    }
  });
});
