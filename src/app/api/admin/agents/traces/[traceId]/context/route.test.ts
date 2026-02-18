/**
 * @jest-environment node
 */

const requireAgentAdminSignedInUserIdMock = jest.fn();
const getAdminSupabaseClientMock = jest.fn();
const recordOpsAuditMock = jest.fn();

jest.mock('@/lib/agents/admin/auth', () => ({
  requireAgentAdminSignedInUserId: requireAgentAdminSignedInUserIdMock,
}));

jest.mock('@/lib/agents/admin/supabase-admin', () => ({
  getAdminSupabaseClient: getAdminSupabaseClientMock,
}));

jest.mock('@/lib/agents/shared/trace-events', () => ({
  recordOpsAudit: (...args: unknown[]) => recordOpsAuditMock(...args),
}));

const loadGet = async () => {
  let GET:
    | ((
        req: import('next/server').NextRequest,
        ctx: { params: Promise<{ traceId: string }> },
      ) => Promise<Response>)
    | null = null;
  await jest.isolateModulesAsync(async () => {
    const route = await import('./route');
    GET = route.GET;
  });
  return GET as (
    req: import('next/server').NextRequest,
    ctx: { params: Promise<{ traceId: string }> },
  ) => Promise<Response>;
};

type QueryResult = {
  data?: unknown;
  error: null | { message: string; code?: string };
  count?: number | null;
};

type QueryBuilder = Promise<QueryResult> & {
  select: jest.MockedFunction<(columns?: string, options?: Record<string, unknown>) => QueryBuilder>;
  eq: jest.MockedFunction<(column: string, value: string) => QueryBuilder>;
  order: jest.MockedFunction<(column: string, options?: { ascending?: boolean }) => QueryBuilder>;
  limit: jest.MockedFunction<(value: number) => QueryBuilder>;
  lt: jest.MockedFunction<(column: string, value: number) => QueryBuilder>;
  gt: jest.MockedFunction<(column: string, value: number) => QueryBuilder>;
  in: jest.MockedFunction<(column: string, value: string[]) => QueryBuilder>;
  maybeSingle: jest.MockedFunction<() => Promise<{ data: unknown; error: null | { message: string; code?: string } }>>;
};

const buildQuery = (result: QueryResult): QueryBuilder => {
  const query = Promise.resolve(result) as QueryBuilder;
  query.select = jest.fn(() => query);
  query.eq = jest.fn(() => query);
  query.order = jest.fn(() => query);
  query.limit = jest.fn(() => query);
  query.lt = jest.fn(() => query);
  query.gt = jest.fn(() => query);
  query.in = jest.fn(() => query);
  query.maybeSingle = jest.fn(async () => {
    const data = Array.isArray(result.data) ? (result.data[0] ?? null) : (result.data ?? null);
    return { data, error: result.error };
  });
  return query;
};

describe('/api/admin/agents/traces/[traceId]/context', () => {
  beforeEach(() => {
    requireAgentAdminSignedInUserIdMock.mockReset();
    getAdminSupabaseClientMock.mockReset();
    recordOpsAuditMock.mockReset();
  });

  it('returns unauthorized when user is not signed in', async () => {
    requireAgentAdminSignedInUserIdMock.mockResolvedValue({ ok: false, status: 401, error: 'unauthorized' });
    const GET = await loadGet();
    const response = await GET(
      { nextUrl: new URL('http://localhost/api/admin/agents/traces/trace-1/context') } as import('next/server').NextRequest,
      { params: Promise.resolve({ traceId: 'trace-1' }) },
    );
    const json = await response.json();

    expect(response.status).toBe(401);
    expect(json).toEqual({ error: 'unauthorized' });
  });

  it('returns failure summary and empty transcript when no session is resolved', async () => {
    requireAgentAdminSignedInUserIdMock.mockResolvedValue({ ok: true, userId: 'admin-1' });
    const traceQuery = buildQuery({
      data: [
        {
          id: 'evt-1',
          trace_id: 'trace-1',
          request_id: 'req-1',
          intent_id: 'intent-1',
          room: 'canvas-room-1',
          task_id: 'task-1',
          task: 'fairy.intent',
          stage: 'failed',
          status: 'failed',
          provider: 'openai',
          model: 'gpt-5-mini',
          provider_source: 'task_params',
          provider_path: 'primary',
          provider_request_id: 'provider-1',
          latency_ms: 15,
          created_at: '2026-02-17T12:00:00.000Z',
          payload: { error: 'model timeout', workerId: 'worker-7' },
        },
      ],
      error: null,
    });
    const taskQuery = buildQuery({
      data: {
        id: 'task-1',
        room: 'canvas-room-1',
        task: 'fairy.intent',
        status: 'failed',
        attempt: 3,
        error: 'model timeout',
        request_id: 'req-1',
        trace_id: 'trace-1',
        created_at: '2026-02-17T11:59:58.000Z',
        updated_at: '2026-02-17T12:00:01.000Z',
      },
      error: null,
    });
    const canvasSessionQuery = buildQuery({
      data: [],
      error: null,
    });

    getAdminSupabaseClientMock.mockReturnValue({
      from: jest.fn((table: string) => {
        if (table === 'agent_trace_events') return traceQuery;
        if (table === 'agent_tasks') return taskQuery;
        if (table === 'canvas_sessions') return canvasSessionQuery;
        throw new Error(`Unexpected table ${table}`);
      }),
    });

    const GET = await loadGet();
    const response = await GET(
      {
        nextUrl: new URL('http://localhost/api/admin/agents/traces/trace-1/context?limit=200'),
      } as import('next/server').NextRequest,
      { params: Promise.resolve({ traceId: 'trace-1' }) },
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.failure).toMatchObject({
      reason: 'model timeout',
      stage: 'failed',
      subsystem: 'worker',
      worker_id: 'worker-7',
      task_id: 'task-1',
      provider: 'openai',
      model: 'gpt-5-mini',
      provider_source: 'task_params',
      provider_path: 'primary',
    });
    expect(json.taskSnapshot).toMatchObject({
      id: 'task-1',
      status: 'failed',
    });
    expect(json.transcriptPage).toMatchObject({
      sessionId: null,
      entries: [],
      hasOlder: false,
      hasNewer: false,
    });
    expect(recordOpsAuditMock).toHaveBeenCalledTimes(1);
  });
});
