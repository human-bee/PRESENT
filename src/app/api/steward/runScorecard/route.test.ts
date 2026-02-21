/**
 * @jest-environment node
 */

const enqueueTaskMock = jest.fn();
const resolveRequestUserIdMock = jest.fn();
const assertCanvasMemberMock = jest.fn();
const parseCanvasIdFromRoomMock = jest.fn();
const getDecryptedUserModelKeyMock = jest.fn();
const runDebateScorecardStewardFastMock = jest.fn();
const runDebateScorecardStewardMock = jest.fn();
const isFastStewardReadyMock = jest.fn();

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
  resolveRequestUserId: resolveRequestUserIdMock,
}));

jest.mock('@/lib/agents/shared/canvas-billing', () => ({
  assertCanvasMember: assertCanvasMemberMock,
  parseCanvasIdFromRoom: parseCanvasIdFromRoomMock,
}));

jest.mock('@/lib/agents/shared/user-model-keys', () => ({
  getDecryptedUserModelKey: getDecryptedUserModelKeyMock,
}));

jest.mock('@/lib/agents/subagents/debate-steward-fast', () => ({
  runDebateScorecardStewardFast: runDebateScorecardStewardFastMock,
}));

jest.mock('@/lib/agents/debate-judge', () => ({
  runDebateScorecardSteward: runDebateScorecardStewardMock,
}));

jest.mock('@/lib/agents/fast-steward-config', () => ({
  isFastStewardReady: isFastStewardReadyMock,
}));

const loadPost = async (options?: { queueFallback?: boolean; byok?: boolean }) => {
  byokEnabled = options?.byok ?? false;
  process.env.SCORECARD_QUEUE_DIRECT_FALLBACK = options?.queueFallback ? 'true' : 'false';

  let post: ((req: import('next/server').NextRequest) => Promise<Response>) | null = null;
  await jest.isolateModulesAsync(async () => {
    const route = await import('./route');
    post = route.POST;
  });
  return post as (req: import('next/server').NextRequest) => Promise<Response>;
};

const toNextRequest = (request: Request): import('next/server').NextRequest =>
  request as unknown as import('next/server').NextRequest;

describe('/api/steward/runScorecard', () => {
  beforeEach(() => {
    enqueueTaskMock.mockReset();
    resolveRequestUserIdMock.mockReset();
    assertCanvasMemberMock.mockReset();
    parseCanvasIdFromRoomMock.mockReset();
    getDecryptedUserModelKeyMock.mockReset();
    runDebateScorecardStewardFastMock.mockReset();
    runDebateScorecardStewardMock.mockReset();
    isFastStewardReadyMock.mockReset();

    enqueueTaskMock.mockResolvedValue({ id: 'task-scorecard-1' });
    resolveRequestUserIdMock.mockResolvedValue('user-1');
    assertCanvasMemberMock.mockResolvedValue({ ownerUserId: 'owner-1' });
    parseCanvasIdFromRoomMock.mockReturnValue('canvas-1');
    getDecryptedUserModelKeyMock.mockResolvedValue('csk-test-123');
    runDebateScorecardStewardFastMock.mockResolvedValue({ status: 'ok' });
    runDebateScorecardStewardMock.mockResolvedValue({ status: 'ok' });
    isFastStewardReadyMock.mockReturnValue(true);
  });

  it('queues scorecard tasks', async () => {
    const POST = await loadPost({ queueFallback: false, byok: false });
    const request = new Request('http://localhost/api/steward/runScorecard', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        room: 'demo-room',
        componentId: 'scorecard-1',
        task: 'scorecard.run',
        summary: 'Judge this line',
      }),
    });

    const response = await POST(toNextRequest(request));
    const json = await response.json();

    expect(response.status).toBe(202);
    expect(json.status).toBe('queued');
    expect(enqueueTaskMock).toHaveBeenCalledTimes(1);
  });

  it('returns 503 when queue fails and direct fallback is disabled', async () => {
    enqueueTaskMock.mockRejectedValueOnce(new Error('queue down'));
    const POST = await loadPost({ queueFallback: false, byok: false });
    const request = new Request('http://localhost/api/steward/runScorecard', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        room: 'demo-room',
        componentId: 'scorecard-1',
        task: 'scorecard.run',
      }),
    });

    const response = await POST(toNextRequest(request));
    const json = await response.json();

    expect(response.status).toBe(503);
    expect(json.error).toBe('Queue unavailable');
    expect(runDebateScorecardStewardFastMock).not.toHaveBeenCalled();
    expect(runDebateScorecardStewardMock).not.toHaveBeenCalled();
  });

  it('passes decrypted cerebras key to fast steward in direct fallback mode', async () => {
    enqueueTaskMock.mockRejectedValueOnce(new Error('queue down'));
    const POST = await loadPost({ queueFallback: true, byok: true });
    const request = new Request('http://localhost/api/steward/runScorecard', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        room: 'demo-room',
        componentId: 'scorecard-1',
        task: 'scorecard.run',
      }),
    });

    const response = await POST(toNextRequest(request));
    const json = await response.json();

    expect(response.status).toBe(202);
    expect(json.status).toBe('executed_fallback');
    expect(runDebateScorecardStewardFastMock).toHaveBeenCalledWith(
      expect.objectContaining({
        room: 'demo-room',
        componentId: 'scorecard-1',
        cerebrasApiKey: 'csk-test-123',
      }),
    );
  });

  it('returns 401 when BYOK is enabled and requester is not authenticated', async () => {
    resolveRequestUserIdMock.mockResolvedValueOnce(null);
    const POST = await loadPost({ queueFallback: false, byok: true });
    const request = new Request('http://localhost/api/steward/runScorecard', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        room: 'demo-room',
        componentId: 'scorecard-1',
        task: 'scorecard.run',
      }),
    });

    const response = await POST(toNextRequest(request));
    const json = await response.json();

    expect(response.status).toBe(401);
    expect(json.error).toBe('unauthorized');
  });

  it('adds runtime scope to queued scorecard tasks', async () => {
    const previousLivekitUrl = process.env.LIVEKIT_URL;
    process.env.LIVEKIT_URL = 'ws://localhost:7880';
    try {
      const POST = await loadPost({ queueFallback: false, byok: false });
      const request = new Request('http://localhost/api/steward/runScorecard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          room: 'demo-room',
          componentId: 'scorecard-1',
          task: 'scorecard.run',
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
