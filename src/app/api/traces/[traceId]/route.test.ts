/**
 * @jest-environment node
 */

const requireAgentAdminSignedInUserIdMock = jest.fn();
const getAdminSupabaseClientMock = jest.fn();

jest.mock('@/lib/agents/admin/auth', () => ({
  requireAgentAdminSignedInUserId: requireAgentAdminSignedInUserIdMock,
}));

jest.mock('@/lib/agents/admin/supabase-admin', () => ({
  getAdminSupabaseClient: getAdminSupabaseClientMock,
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

type QueryResult = { data: unknown[]; error: null | { message: string } };
type QueryBuilder = Promise<QueryResult> & {
  select: jest.MockedFunction<(columns?: string) => QueryBuilder>;
  eq: jest.MockedFunction<(column: string, value: string) => QueryBuilder>;
  order: jest.MockedFunction<(column: string, options?: { ascending?: boolean }) => QueryBuilder>;
  limit: jest.MockedFunction<(value: number) => QueryBuilder>;
};

const buildQuery = (result: QueryResult) => {
  const query = Promise.resolve(result) as QueryBuilder;
  query.select = jest.fn(() => query);
  query.eq = jest.fn(() => query);
  query.order = jest.fn(() => query);
  query.limit = jest.fn(() => query);
  return query;
};

describe('/api/traces/[traceId]', () => {
  beforeEach(() => {
    requireAgentAdminSignedInUserIdMock.mockReset();
    getAdminSupabaseClientMock.mockReset();
  });

  it('enforces signed-in access', async () => {
    requireAgentAdminSignedInUserIdMock.mockResolvedValue({ ok: false, status: 401, error: 'unauthorized' });
    const GET = await loadGet();
    const response = await GET(
      { nextUrl: new URL('http://localhost/api/traces/trace-1') } as import('next/server').NextRequest,
      { params: Promise.resolve({ traceId: 'trace-1' }) },
    );
    const json = await response.json();

    expect(response.status).toBe(401);
    expect(json).toEqual({ error: 'unauthorized' });
  });

  it('returns enriched trace event payload', async () => {
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
          created_at: '2026-02-17T12:00:00.000Z',
          latency_ms: 22,
          payload: { error: 'model timeout', workerId: 'worker-1' },
        },
      ],
      error: null,
    });
    getAdminSupabaseClientMock.mockReturnValue({
      from: jest.fn(() => traceQuery),
    });

    const GET = await loadGet();
    const response = await GET(
      { nextUrl: new URL('http://localhost/api/traces/trace-1') } as import('next/server').NextRequest,
      { params: Promise.resolve({ traceId: 'trace-1' }) },
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.traceId).toBe('trace-1');
    expect(json.events).toHaveLength(1);
    expect(json.events[0]).toMatchObject({
      subsystem: 'worker',
      worker_id: 'worker-1',
      failure_reason: 'model timeout',
    });
  });
});
