/**
 * @jest-environment node
 */

const recordAckMock = jest.fn();
const verifyAgentTokenMock = jest.fn();
const recordAgentTraceEventMock = jest.fn();

jest.mock('@/server/inboxes/ack', () => ({
  recordAck: (...args: unknown[]) => recordAckMock(...args),
}));

jest.mock('@/lib/agents/canvas-agent/server/auth/agentTokens', () => ({
  verifyAgentToken: (...args: unknown[]) => verifyAgentTokenMock(...args),
}));

jest.mock('@/lib/agents/shared/trace-events', () => ({
  recordAgentTraceEvent: (...args: unknown[]) => recordAgentTraceEventMock(...args),
}));

jest.mock('@/lib/logging', () => ({
  createLogger: () => ({
    warn: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  }),
}));

const loadPost = async () => {
  let post: ((req: import('next/server').NextRequest) => Promise<Response>) | null = null;
  await jest.isolateModulesAsync(async () => {
    const route = await import('./route');
    post = route.POST;
  });
  return post as (req: import('next/server').NextRequest) => Promise<Response>;
};

const toNextRequest = (request: Request): import('next/server').NextRequest =>
  request as unknown as import('next/server').NextRequest;

describe('/api/canvas-agent/ack', () => {
  beforeEach(() => {
    delete process.env.CANVAS_AGENT_REQUIRE_TOKEN;
    recordAckMock.mockReset();
    verifyAgentTokenMock.mockReset();
    recordAgentTraceEventMock.mockReset();
    verifyAgentTokenMock.mockReturnValue(true);
    recordAgentTraceEventMock.mockResolvedValue(undefined);
  });

  it('records acks without waiting for trace storage', async () => {
    recordAgentTraceEventMock.mockReturnValueOnce(new Promise(() => {}));
    const POST = await loadPost();
    const request = new Request('http://localhost/api/canvas-agent/ack', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: 'canvas-session-1',
        seq: 7,
        clientId: 'client-1',
        ts: 1234,
        roomId: 'canvas-room',
        traceId: 'trace-1',
        requestId: 'request-1',
      }),
    });

    const response = await POST(toNextRequest(request));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toEqual({ ok: true });
    expect(recordAckMock).toHaveBeenCalledWith(
      'canvas-session-1',
      7,
      'client-1',
      1234,
      expect.objectContaining({
        traceId: 'trace-1',
        requestId: 'request-1',
      }),
    );
    expect(recordAgentTraceEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: 'ack_received',
        traceId: 'trace-1',
        requestId: 'request-1',
      }),
    );
  });
});
