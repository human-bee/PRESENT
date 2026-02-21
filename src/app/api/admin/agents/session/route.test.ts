/**
 * @jest-environment node
 */

const requireAgentAdminUserIdMock = jest.fn();
const getAdminSupabaseClientMock = jest.fn();

jest.mock('@/lib/agents/admin/auth', () => ({
  requireAgentAdminUserId: requireAgentAdminUserIdMock,
}));

jest.mock('@/lib/agents/admin/supabase-admin', () => ({
  getAdminSupabaseClient: getAdminSupabaseClientMock,
}));

const loadGet = async () => {
  let GET: ((req: import('next/server').NextRequest) => Promise<Response>) | null = null;
  await jest.isolateModulesAsync(async () => {
    const route = await import('./route');
    GET = route.GET;
  });
  return GET as (req: import('next/server').NextRequest) => Promise<Response>;
};

describe('/api/admin/agents/session', () => {
  beforeEach(() => {
    requireAgentAdminUserIdMock.mockReset();
    getAdminSupabaseClientMock.mockReset();
    requireAgentAdminUserIdMock.mockResolvedValue({ ok: true, userId: 'admin-1' });
  });

  it('returns 400 when no room or canvas id provided', async () => {
    const GET = await loadGet();
    const response = await GET({
      nextUrl: new URL('http://localhost/api/admin/agents/session'),
    } as import('next/server').NextRequest);
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.error).toMatch(/room or canvasId is required/i);
  });

  it('builds room from canvasId and returns correlated payload', async () => {
    const queueLimitMock = jest.fn().mockResolvedValue({
      data: [
        {
          id: 'task-1',
          room: 'canvas-abc',
          task: 'fairy.intent',
          status: 'queued',
          request_id: 'req-1',
          trace_id: 'trace-1',
        },
      ],
      error: null,
    });
    const queueOrderMock = jest.fn(() => ({ limit: queueLimitMock }));
    const queueEqMock = jest.fn(() => ({ order: queueOrderMock }));
    const queueSelectMock = jest.fn(() => ({ eq: queueEqMock }));

    const tracesLimitMock = jest.fn().mockResolvedValue({
      data: [
        {
          id: 'evt-1',
          room: 'canvas-abc',
          stage: 'queued',
          request_id: 'req-1',
          trace_id: 'trace-1',
        },
      ],
      error: null,
    });
    const tracesOrderMock = jest.fn(() => ({ limit: tracesLimitMock }));
    const tracesEqMock = jest.fn(() => ({ order: tracesOrderMock }));
    const tracesSelectMock = jest.fn(() => ({ eq: tracesEqMock }));

    getAdminSupabaseClientMock.mockReturnValue({
      from: jest.fn((table: string) => {
        if (table === 'agent_tasks') return { select: queueSelectMock };
        if (table === 'agent_trace_events') return { select: tracesSelectMock };
        throw new Error(`unexpected table: ${table}`);
      }),
    });

    const GET = await loadGet();
    const response = await GET({
      nextUrl: new URL('http://localhost/api/admin/agents/session?canvasId=abc&limit=50'),
    } as import('next/server').NextRequest);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.room).toBe('canvas-abc');
    expect(json.summary.tasksTotal).toBe(1);
    expect(json.summary.tracesTotal).toBe(1);
    expect(json.summary.uniqueTraceIds).toBe(1);
    expect(json.summary.uniqueRequestIds).toBe(1);
    expect(json.summary.missingTraceOnTasks).toBe(0);
  });

  it('resolves missing task trace ids from trace events by request id', async () => {
    const queueLimitMock = jest.fn().mockResolvedValue({
      data: [
        {
          id: 'task-2',
          room: 'canvas-abc',
          task: 'fairy.intent',
          status: 'succeeded',
          request_id: 'req-2',
          trace_id: null,
        },
      ],
      error: null,
    });
    const queueOrderMock = jest.fn(() => ({ limit: queueLimitMock }));
    const queueEqMock = jest.fn(() => ({ order: queueOrderMock }));
    const queueSelectMock = jest.fn(() => ({ eq: queueEqMock }));

    const tracesLimitMock = jest.fn().mockResolvedValue({
      data: [
        {
          id: 'evt-2',
          room: 'canvas-abc',
          stage: 'completed',
          request_id: 'req-2',
          trace_id: 'trace-2',
        },
      ],
      error: null,
    });
    const tracesOrderMock = jest.fn(() => ({ limit: tracesLimitMock }));
    const tracesEqMock = jest.fn(() => ({ order: tracesOrderMock }));
    const tracesSelectMock = jest.fn(() => ({ eq: tracesEqMock }));

    getAdminSupabaseClientMock.mockReturnValue({
      from: jest.fn((table: string) => {
        if (table === 'agent_tasks') return { select: queueSelectMock };
        if (table === 'agent_trace_events') return { select: tracesSelectMock };
        throw new Error(`unexpected table: ${table}`);
      }),
    });

    const GET = await loadGet();
    const response = await GET({
      nextUrl: new URL('http://localhost/api/admin/agents/session?room=canvas-abc'),
    } as import('next/server').NextRequest);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.summary.missingTraceOnTasks).toBe(0);
    expect(json.tasks[0]).toMatchObject({
      trace_id: null,
      resolved_trace_id: 'trace-2',
      trace_integrity: 'resolved_from_events',
    });
  });
});
