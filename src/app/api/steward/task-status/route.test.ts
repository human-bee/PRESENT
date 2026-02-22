/**
 * @jest-environment node
 */

const getAdminSupabaseClientMock = jest.fn();
const assertCanvasMemberMock = jest.fn();
const parseCanvasIdFromRoomMock = jest.fn();
const resolveRequestUserIdMock = jest.fn();

jest.mock('@/lib/agents/admin/supabase-admin', () => ({
  getAdminSupabaseClient: getAdminSupabaseClientMock,
}));

jest.mock('@/lib/agents/shared/canvas-billing', () => ({
  assertCanvasMember: assertCanvasMemberMock,
  parseCanvasIdFromRoom: parseCanvasIdFromRoomMock,
}));

jest.mock('@/lib/supabase/server/resolve-request-user', () => ({
  resolveRequestUserId: resolveRequestUserIdMock,
}));

const loadGet = async () => {
  let GET: ((req: import('next/server').NextRequest) => Promise<Response>) | null = null;
  await jest.isolateModulesAsync(async () => {
    const route = await import('./route');
    GET = route.GET;
  });
  return GET as (req: import('next/server').NextRequest) => Promise<Response>;
};

describe('/api/steward/task-status', () => {
  beforeEach(() => {
    getAdminSupabaseClientMock.mockReset();
    assertCanvasMemberMock.mockReset();
    parseCanvasIdFromRoomMock.mockReset();
    resolveRequestUserIdMock.mockReset();

    resolveRequestUserIdMock.mockResolvedValue('user-1');
    assertCanvasMemberMock.mockResolvedValue({ ownerUserId: 'owner-1' });
    parseCanvasIdFromRoomMock.mockReturnValue('canvas-1');
  });

  it('returns 401 when requester is not authenticated', async () => {
    resolveRequestUserIdMock.mockResolvedValueOnce(null);
    const GET = await loadGet();
    const response = await GET({
      nextUrl: new URL('http://localhost/api/steward/task-status?taskId=task-1&room=canvas-1'),
    } as import('next/server').NextRequest);
    const json = await response.json();

    expect(response.status).toBe(401);
    expect(json.error).toBe('unauthorized');
  });

  it('returns 404 when task id is not found', async () => {
    const maybeSingleMock = jest.fn().mockResolvedValue({ data: null, error: null });
    const eqMock = jest.fn(() => ({ maybeSingle: maybeSingleMock }));
    const selectMock = jest.fn(() => ({ eq: eqMock }));
    getAdminSupabaseClientMock.mockReturnValue({
      from: jest.fn(() => ({ select: selectMock })),
    });

    const GET = await loadGet();
    const response = await GET({
      nextUrl: new URL(
        'http://localhost/api/steward/task-status?taskId=task-missing&room=canvas-1',
      ),
    } as import('next/server').NextRequest);
    const json = await response.json();

    expect(response.status).toBe(404);
    expect(json.error).toBe('task not found');
  });

  it('falls back when agent_tasks.trace_id column is missing', async () => {
    const taskRowWithoutTrace = {
      id: 'task-no-trace-column',
      room: 'canvas-1',
      task: 'fairy.intent',
      status: 'succeeded',
      attempt: 1,
      error: null,
      result: { ok: true },
      request_id: 'req-no-trace-column',
      created_at: '2026-02-22T01:00:00.000Z',
      updated_at: '2026-02-22T01:00:05.000Z',
    };

    const firstMaybeSingleMock = jest.fn().mockResolvedValue({
      data: null,
      error: { code: '42703', message: 'column "trace_id" does not exist' },
    });
    const secondMaybeSingleMock = jest.fn().mockResolvedValue({
      data: taskRowWithoutTrace,
      error: null,
    });
    const taskEqMock = jest
      .fn()
      .mockReturnValueOnce({ maybeSingle: firstMaybeSingleMock })
      .mockReturnValueOnce({ maybeSingle: secondMaybeSingleMock });
    const taskSelectMock = jest.fn(() => ({ eq: taskEqMock }));

    const traceLimitMock = jest.fn().mockResolvedValue({
      data: [{ trace_id: 'trace-fallback' }],
      error: null,
    });
    const traceOrderMock = jest.fn(() => ({ limit: traceLimitMock }));
    const traceEqMock = jest.fn(() => ({ order: traceOrderMock }));
    const traceSelectMock = jest.fn(() => ({ eq: traceEqMock }));

    getAdminSupabaseClientMock.mockReturnValue({
      from: jest.fn((table: string) => {
        if (table === 'agent_tasks') return { select: taskSelectMock };
        if (table === 'agent_trace_events') return { select: traceSelectMock };
        throw new Error(`unexpected table ${table}`);
      }),
    });

    const GET = await loadGet();
    const response = await GET({
      nextUrl: new URL(
        'http://localhost/api/steward/task-status?taskId=task-no-trace-column&room=canvas-1',
      ),
    } as import('next/server').NextRequest);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.task.id).toBe('task-no-trace-column');
    expect(json.task.traceId).toBe('trace-fallback');
    expect(json.task.traceIntegrity).toBe('resolved_from_events');
    expect(taskSelectMock).toHaveBeenCalledTimes(2);
  });

  it('returns task status when requester is a canvas member', async () => {
    const maybeSingleMock = jest.fn().mockResolvedValue({
      data: {
        id: 'task-1',
        room: 'canvas-1',
        task: 'fairy.intent',
        status: 'succeeded',
        attempt: 1,
        error: null,
        result: { ok: true },
        request_id: 'req-1',
        trace_id: 'trace-1',
        created_at: '2026-02-17T01:00:00.000Z',
        updated_at: '2026-02-17T01:00:05.000Z',
      },
      error: null,
    });
    const eqMock = jest.fn(() => ({ maybeSingle: maybeSingleMock }));
    const selectMock = jest.fn(() => ({ eq: eqMock }));
    getAdminSupabaseClientMock.mockReturnValue({
      from: jest.fn(() => ({ select: selectMock })),
    });

    const GET = await loadGet();
    const response = await GET({
      nextUrl: new URL('http://localhost/api/steward/task-status?taskId=task-1&room=canvas-1'),
    } as import('next/server').NextRequest);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.task.id).toBe('task-1');
    expect(json.task.status).toBe('succeeded');
    expect(json.task.requestId).toBe('req-1');
    expect(json.task.traceId).toBe('trace-1');
    expect(json.task.traceIntegrity).toBe('direct');
    expect(assertCanvasMemberMock).toHaveBeenCalledWith({
      canvasId: 'canvas-1',
      requesterUserId: 'user-1',
    });
  });

  it('allows room-scoped polling when canvas row is not yet persisted', async () => {
    const maybeSingleMock = jest.fn().mockResolvedValue({
      data: {
        id: 'task-ephemeral',
        room: 'canvas-ephemeral',
        task: 'fairy.intent',
        status: 'running',
        attempt: 1,
        error: null,
        result: null,
        request_id: 'req-ephemeral',
        trace_id: 'trace-ephemeral',
        created_at: '2026-02-17T01:00:00.000Z',
        updated_at: '2026-02-17T01:00:05.000Z',
      },
      error: null,
    });
    const eqMock = jest.fn(() => ({ maybeSingle: maybeSingleMock }));
    const selectMock = jest.fn(() => ({ eq: eqMock }));
    getAdminSupabaseClientMock.mockReturnValue({
      from: jest.fn(() => ({ select: selectMock })),
    });
    parseCanvasIdFromRoomMock.mockReturnValueOnce('ephemeral');
    assertCanvasMemberMock.mockRejectedValueOnce(new Error('Canvas not found'));

    const GET = await loadGet();
    const response = await GET({
      nextUrl: new URL(
        'http://localhost/api/steward/task-status?taskId=task-ephemeral&room=canvas-ephemeral',
      ),
    } as import('next/server').NextRequest);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.task.id).toBe('task-ephemeral');
    expect(json.task.status).toBe('running');
    expect(json.task.traceId).toBe('trace-ephemeral');
    expect(json.task.traceIntegrity).toBe('direct');
  });

  it('resolves trace id from trace events when task row trace_id is null', async () => {
    const maybeSingleMock = jest.fn().mockResolvedValue({
      data: {
        id: 'task-2',
        room: 'canvas-1',
        task: 'fairy.intent',
        status: 'succeeded',
        attempt: 1,
        error: null,
        result: { ok: true },
        request_id: 'req-2',
        trace_id: null,
        created_at: '2026-02-17T01:00:00.000Z',
        updated_at: '2026-02-17T01:00:05.000Z',
      },
      error: null,
    });
    const taskEqMock = jest.fn(() => ({ maybeSingle: maybeSingleMock }));
    const taskSelectMock = jest.fn(() => ({ eq: taskEqMock }));

    const traceLimitMock = jest.fn().mockResolvedValue({
      data: [{ trace_id: 'trace-2' }],
      error: null,
    });
    const traceOrderMock = jest.fn(() => ({ limit: traceLimitMock }));
    const traceEqMock = jest.fn(() => ({ order: traceOrderMock }));
    const traceSelectMock = jest.fn(() => ({ eq: traceEqMock }));

    getAdminSupabaseClientMock.mockReturnValue({
      from: jest.fn((table: string) => {
        if (table === 'agent_tasks') return { select: taskSelectMock };
        if (table === 'agent_trace_events') return { select: traceSelectMock };
        throw new Error(`unexpected table ${table}`);
      }),
    });

    const GET = await loadGet();
    const response = await GET({
      nextUrl: new URL('http://localhost/api/steward/task-status?taskId=task-2&room=canvas-1'),
    } as import('next/server').NextRequest);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.task.traceId).toBe('trace-2');
    expect(json.task.traceIntegrity).toBe('resolved_from_events');
  });
});
