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

type QueryResult = { data: unknown[]; error: null | { message: string } };
type QueryBuilder = Promise<QueryResult> & {
  select: jest.MockedFunction<() => QueryBuilder>;
  order: jest.MockedFunction<() => QueryBuilder>;
  limit: jest.MockedFunction<(value: number) => QueryBuilder>;
  eq: jest.MockedFunction<(column: string, value: string) => QueryBuilder>;
};

const buildQuery = (result: { data: unknown[]; error: null | { message: string } }) => {
  let limitValue: number | null = null;
  const filters: Array<{ column: string; value: string }> = [];
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
  return {
    query,
    getLimit: () => limitValue,
    getFilters: () => filters,
  };
};

describe('/api/admin/agents/traces', () => {
  beforeEach(() => {
    requireAgentAdminUserIdMock.mockReset();
    getAdminSupabaseClientMock.mockReset();
  });

  it('falls back to safe default limit when query param is not numeric', async () => {
    requireAgentAdminUserIdMock.mockResolvedValue({ ok: true, userId: 'admin-1' });
    const { query, getLimit } = buildQuery({ data: [], error: null });
    getAdminSupabaseClientMock.mockReturnValue({
      from: jest.fn(() => query),
    });

    const GET = await loadGet();
    const response = await GET({
      nextUrl: new URL('http://localhost/api/admin/agents/traces?limit=foo'),
    } as import('next/server').NextRequest);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(getLimit()).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.traces).toEqual([]);
  });

  it('falls back to task-backed traces when trace ledger table is missing', async () => {
    requireAgentAdminUserIdMock.mockResolvedValue({ ok: true, userId: 'admin-2' });
    const tracesQuery = buildQuery({
      data: [],
      error: { message: 'relation "public.agent_trace_events" does not exist' },
    });
    const taskRows = [
      {
        id: 'task-1',
        room: 'canvas-room-1',
        task: 'canvas.agent_prompt',
        status: 'running',
        attempt: 1,
        request_id: 'req-1',
        params: { traceId: 'trace-1', intentId: 'intent-1' },
        created_at: '2026-02-17T00:00:00.000Z',
        updated_at: '2026-02-17T00:00:02.000Z',
      },
      {
        id: 'task-2',
        room: 'canvas-room-2',
        task: 'canvas.agent_prompt',
        status: 'failed',
        attempt: 2,
        request_id: 'req-2',
        params: { traceId: 'trace-2' },
        created_at: '2026-02-17T00:01:00.000Z',
        updated_at: '2026-02-17T00:01:02.000Z',
      },
    ];
    const tasksQuery = buildQuery({ data: taskRows, error: null });
    getAdminSupabaseClientMock.mockReturnValue({
      from: jest.fn((table: string) => {
        if (table === 'agent_trace_events') return tracesQuery.query;
        if (table === 'agent_tasks') return tasksQuery.query;
        throw new Error(`Unexpected table ${table}`);
      }),
    });

    const GET = await loadGet();
    const response = await GET({
      nextUrl: new URL('http://localhost/api/admin/agents/traces?traceId=trace-1&stage=executing'),
    } as import('next/server').NextRequest);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(Array.isArray(json.traces)).toBe(true);
    expect(json.traces).toHaveLength(1);
    expect(json.traces[0]).toMatchObject({
      trace_id: 'trace-1',
      stage: 'executing',
      room: 'canvas-room-1',
      task_id: 'task-1',
    });
    expect(tasksQuery.getLimit()).toBe(2000);
    expect(tasksQuery.getFilters()).toEqual([]);
  });
});
