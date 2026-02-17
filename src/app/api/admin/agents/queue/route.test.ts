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
  let GET: ((req: import('next/server').NextRequest) => Promise<Response>) | null = null;
  await jest.isolateModulesAsync(async () => {
    const route = await import('./route');
    GET = route.GET;
  });
  return GET as (req: import('next/server').NextRequest) => Promise<Response>;
};

type QueryResult = { data: unknown[]; error: null | { message: string; code?: string } };
type QueryBuilder = Promise<QueryResult> & {
  select: jest.MockedFunction<(columns?: string) => QueryBuilder>;
  order: jest.MockedFunction<(column: string, options?: { ascending?: boolean }) => QueryBuilder>;
  limit: jest.MockedFunction<(value: number) => QueryBuilder>;
  eq: jest.MockedFunction<(column: string, value: string) => QueryBuilder>;
  in: jest.MockedFunction<(column: string, value: string[]) => QueryBuilder>;
};

const buildQuery = (result: QueryResult) => {
  let limitValue: number | null = null;
  const filters: Array<{ column: string; value: string }> = [];
  const inFilters: Array<{ column: string; value: string[] }> = [];
  const query = Promise.resolve(result) as QueryBuilder;
  query.select = jest.fn(() => query);
  query.order = jest.fn(() => query);
  query.limit = jest.fn((value: number) => {
    limitValue = value;
    return query;
  });
  query.eq = jest.fn((column: string, value: string) => {
    filters.push({ column, value });
    return query;
  });
  query.in = jest.fn((column: string, value: string[]) => {
    inFilters.push({ column, value });
    return query;
  });
  return {
    query,
    getLimit: () => limitValue,
    getFilters: () => filters,
    getInFilters: () => inFilters,
  };
};

describe('/api/admin/agents/queue', () => {
  beforeEach(() => {
    requireAgentAdminSignedInUserIdMock.mockReset();
    getAdminSupabaseClientMock.mockReset();
  });

  it('falls back to safe default limit when query param is not numeric', async () => {
    requireAgentAdminSignedInUserIdMock.mockResolvedValue({ ok: true, userId: 'admin-1' });
    const taskQuery = buildQuery({ data: [], error: null });
    getAdminSupabaseClientMock.mockReturnValue({
      from: jest.fn(() => taskQuery.query),
    });

    const GET = await loadGet();
    const response = await GET({
      nextUrl: new URL('http://localhost/api/admin/agents/queue?limit=foo'),
    } as import('next/server').NextRequest);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(taskQuery.getLimit()).toBe(100);
    expect(json.ok).toBe(true);
    expect(json.tasks).toEqual([]);
  });

  it('enriches queue rows with worker and failure diagnostics', async () => {
    requireAgentAdminSignedInUserIdMock.mockResolvedValue({ ok: true, userId: 'admin-2' });
    const taskQuery = buildQuery({
      data: [
        {
          id: 'task-1',
          room: 'canvas-room-1',
          task: 'fairy.intent',
          status: 'failed',
          priority: 100,
          attempt: 2,
          error: 'fallback failure',
          request_id: 'req-1',
          trace_id: 'trace-1',
          resource_keys: ['room:canvas-room-1'],
          lease_expires_at: null,
          created_at: '2026-02-17T12:00:00.000Z',
          updated_at: '2026-02-17T12:00:03.000Z',
        },
      ],
      error: null,
    });
    const traceQuery = buildQuery({
      data: [
        {
          task_id: 'task-1',
          stage: 'executing',
          status: 'running',
          created_at: '2026-02-17T12:00:02.000Z',
          payload: { workerId: 'worker-1' },
        },
        {
          task_id: 'task-1',
          stage: 'failed',
          status: 'failed',
          created_at: '2026-02-17T12:00:01.000Z',
          payload: { error: 'tool crashed' },
        },
      ],
      error: null,
    });
    getAdminSupabaseClientMock.mockReturnValue({
      from: jest.fn((table: string) => {
        if (table === 'agent_tasks') return taskQuery.query;
        if (table === 'agent_trace_events') return traceQuery.query;
        throw new Error(`Unexpected table ${table}`);
      }),
    });

    const GET = await loadGet();
    const response = await GET({
      nextUrl: new URL('http://localhost/api/admin/agents/queue?room=canvas-room-1'),
    } as import('next/server').NextRequest);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.tasks).toHaveLength(1);
    expect(json.tasks[0]).toMatchObject({
      id: 'task-1',
      worker_id: 'worker-1',
      last_failure_stage: 'failed',
      last_failure_reason: 'tool crashed',
      last_failure_at: '2026-02-17T12:00:01.000Z',
    });
    expect(traceQuery.getInFilters()).toEqual([
      { column: 'task_id', value: ['task-1'] },
    ]);
  });
});
