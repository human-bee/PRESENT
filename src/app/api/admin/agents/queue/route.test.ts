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

  it('applies traceId filter to queue query when trace_id column exists', async () => {
    requireAgentAdminSignedInUserIdMock.mockResolvedValue({ ok: true, userId: 'admin-1' });
    const taskQuery = buildQuery({ data: [], error: null });
    getAdminSupabaseClientMock.mockReturnValue({
      from: jest.fn(() => taskQuery.query),
    });

    const GET = await loadGet();
    const response = await GET({
      nextUrl: new URL('http://localhost/api/admin/agents/queue?traceId=trace-123'),
    } as import('next/server').NextRequest);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(taskQuery.getFilters()).toEqual([{ column: 'trace_id', value: 'trace-123' }]);
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
          trace_id: 'trace-1',
          request_id: 'req-1',
          room: 'canvas-room-1',
          task: 'fairy.intent',
          stage: 'executing',
          status: 'running',
          provider: 'openai',
          model: 'gpt-5-mini',
          provider_source: 'task_params',
          provider_path: 'primary',
          provider_request_id: 'provider-req-1',
          created_at: '2026-02-17T12:00:02.000Z',
          payload: { workerId: 'worker-1' },
        },
        {
          task_id: 'task-1',
          trace_id: 'trace-1',
          request_id: 'req-1',
          room: 'canvas-room-1',
          task: 'fairy.intent',
          stage: 'failed',
          status: 'failed',
          provider: 'openai',
          model: 'gpt-5-mini',
          provider_source: 'task_params',
          provider_path: 'primary',
          provider_request_id: 'provider-req-1',
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
      provider: 'openai',
      model: 'gpt-5-mini',
      provider_source: 'task_params',
      provider_path: 'primary',
    });
    expect(traceQuery.getInFilters()).toEqual([
      { column: 'task_id', value: ['task-1'] },
    ]);
  });

  it('suppresses stale failure diagnostics after task succeeds', async () => {
    requireAgentAdminSignedInUserIdMock.mockResolvedValue({ ok: true, userId: 'admin-2b' });
    const taskQuery = buildQuery({
      data: [
        {
          id: 'task-2',
          room: 'canvas-room-2',
          task: 'fairy.intent',
          status: 'succeeded',
          priority: 100,
          attempt: 2,
          error: 'stale fallback error',
          request_id: 'req-2',
          trace_id: 'trace-2',
          resource_keys: ['room:canvas-room-2'],
          lease_expires_at: null,
          created_at: '2026-02-17T12:00:00.000Z',
          updated_at: '2026-02-17T12:00:06.000Z',
        },
      ],
      error: null,
    });
    const traceQuery = buildQuery({
      data: [
        {
          task_id: 'task-2',
          trace_id: 'trace-2',
          request_id: 'req-2',
          room: 'canvas-room-2',
          task: 'fairy.intent',
          stage: 'completed',
          status: 'succeeded',
          provider: 'anthropic',
          model: 'claude-haiku-4-5',
          provider_source: 'task_params',
          provider_path: 'primary',
          provider_request_id: 'provider-req-2',
          created_at: '2026-02-17T12:00:05.000Z',
          payload: { workerId: 'worker-2' },
        },
        {
          task_id: 'task-2',
          trace_id: 'trace-2',
          request_id: 'req-2',
          room: 'canvas-room-2',
          task: 'fairy.intent',
          stage: 'failed',
          status: 'failed',
          provider: 'anthropic',
          model: 'claude-haiku-4-5',
          provider_source: 'task_params',
          provider_path: 'primary',
          provider_request_id: 'provider-req-2',
          created_at: '2026-02-17T12:00:03.000Z',
          payload: { error: 'old failure' },
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
      nextUrl: new URL('http://localhost/api/admin/agents/queue?room=canvas-room-2'),
    } as import('next/server').NextRequest);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.tasks).toHaveLength(1);
    expect(json.tasks[0]).toMatchObject({
      id: 'task-2',
      worker_id: 'worker-2',
      last_failure_stage: null,
      last_failure_reason: null,
      last_failure_at: null,
    });
  });

  it('filters queue rows by provider', async () => {
    requireAgentAdminSignedInUserIdMock.mockResolvedValue({ ok: true, userId: 'admin-3' });
    const taskQuery = buildQuery({
      data: [
        {
          id: 'task-1',
          room: 'canvas-room-1',
          task: 'fairy.intent',
          status: 'running',
          priority: 100,
          attempt: 1,
          error: null,
          request_id: 'req-1',
          trace_id: 'trace-1',
          params: {},
          resource_keys: ['room:canvas-room-1'],
          lease_expires_at: null,
          created_at: '2026-02-17T12:00:00.000Z',
          updated_at: '2026-02-17T12:00:01.000Z',
        },
        {
          id: 'task-2',
          room: 'canvas-room-1',
          task: 'fairy.intent',
          status: 'running',
          priority: 100,
          attempt: 1,
          error: null,
          request_id: 'req-2',
          trace_id: 'trace-2',
          params: {},
          resource_keys: ['room:canvas-room-1'],
          lease_expires_at: null,
          created_at: '2026-02-17T12:01:00.000Z',
          updated_at: '2026-02-17T12:01:01.000Z',
        },
      ],
      error: null,
    });
    const traceQuery = buildQuery({
      data: [
        {
          task_id: 'task-1',
          trace_id: 'trace-1',
          request_id: 'req-1',
          room: 'canvas-room-1',
          task: 'fairy.intent',
          stage: 'executing',
          status: 'running',
          provider: 'openai',
          model: 'gpt-5-mini',
          provider_source: 'task_params',
          provider_path: 'primary',
          provider_request_id: null,
          created_at: '2026-02-17T12:00:02.000Z',
          payload: { workerId: 'worker-1' },
        },
        {
          task_id: 'task-2',
          trace_id: 'trace-2',
          request_id: 'req-2',
          room: 'canvas-room-1',
          task: 'fairy.intent',
          stage: 'executing',
          status: 'running',
          provider: 'anthropic',
          model: 'claude-3-5-sonnet',
          provider_source: 'task_params',
          provider_path: 'primary',
          provider_request_id: null,
          created_at: '2026-02-17T12:01:02.000Z',
          payload: { workerId: 'worker-2' },
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
      nextUrl: new URL('http://localhost/api/admin/agents/queue?provider=openai'),
    } as import('next/server').NextRequest);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.tasks).toHaveLength(1);
    expect(json.tasks[0]).toMatchObject({
      id: 'task-1',
      provider: 'openai',
    });
  });

  it('supports traceId filtering in compat mode when trace_id column is missing', async () => {
    requireAgentAdminSignedInUserIdMock.mockResolvedValue({ ok: true, userId: 'admin-4' });
    const withTraceQuery = buildQuery({
      data: [],
      error: {
        code: '42703',
        message: 'column "trace_id" does not exist',
      },
    });
    const compatTaskQuery = buildQuery({
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
          trace_id: 'trace-compat-1',
          stage: 'failed',
          status: 'failed',
          created_at: '2026-02-17T12:00:01.000Z',
          payload: { error: 'tool crashed' },
        },
      ],
      error: null,
    });

    let taskCallCount = 0;
    getAdminSupabaseClientMock.mockReturnValue({
      from: jest.fn((table: string) => {
        if (table === 'agent_tasks') {
          taskCallCount += 1;
          return taskCallCount === 1 ? withTraceQuery.query : compatTaskQuery.query;
        }
        if (table === 'agent_trace_events') return traceQuery.query;
        throw new Error(`Unexpected table ${table}`);
      }),
    });

    const GET = await loadGet();
    const response = await GET({
      nextUrl: new URL('http://localhost/api/admin/agents/queue?traceId=trace-compat-1'),
    } as import('next/server').NextRequest);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.tasks).toHaveLength(1);
    expect(json.tasks[0].trace_id).toBe('trace-compat-1');
  });

  it('expands compat traceId scans when the first page has no matches', async () => {
    requireAgentAdminSignedInUserIdMock.mockResolvedValue({ ok: true, userId: 'admin-4b' });
    const withTraceQuery = buildQuery({
      data: [],
      error: {
        code: '42703',
        message: 'column "trace_id" does not exist',
      },
    });
    const firstCompatTaskPage = buildQuery({
      data: [
        {
          id: 'task-1',
          room: 'canvas-room-1',
          task: 'fairy.intent',
          status: 'failed',
          priority: 100,
          attempt: 1,
          error: 'first page miss',
          request_id: 'req-1',
          resource_keys: ['room:canvas-room-1'],
          lease_expires_at: null,
          created_at: '2026-02-17T12:00:00.000Z',
          updated_at: '2026-02-17T12:00:01.000Z',
        },
      ],
      error: null,
    });
    const expandedCompatTaskPage = buildQuery({
      data: [
        {
          id: 'task-1',
          room: 'canvas-room-1',
          task: 'fairy.intent',
          status: 'failed',
          priority: 100,
          attempt: 1,
          error: 'first page miss',
          request_id: 'req-1',
          resource_keys: ['room:canvas-room-1'],
          lease_expires_at: null,
          created_at: '2026-02-17T12:00:00.000Z',
          updated_at: '2026-02-17T12:00:01.000Z',
        },
        {
          id: 'task-2',
          room: 'canvas-room-1',
          task: 'fairy.intent',
          status: 'failed',
          priority: 100,
          attempt: 1,
          error: 'second page hit',
          request_id: 'req-2',
          resource_keys: ['room:canvas-room-1'],
          lease_expires_at: null,
          created_at: '2026-02-17T12:01:00.000Z',
          updated_at: '2026-02-17T12:01:01.000Z',
        },
      ],
      error: null,
    });
    const traceQuery = buildQuery({
      data: [
        {
          task_id: 'task-2',
          trace_id: 'trace-compat-expanded',
          stage: 'failed',
          status: 'failed',
          created_at: '2026-02-17T12:01:02.000Z',
          payload: { error: 'expanded match' },
        },
      ],
      error: null,
    });

    let taskCallCount = 0;
    getAdminSupabaseClientMock.mockReturnValue({
      from: jest.fn((table: string) => {
        if (table === 'agent_tasks') {
          taskCallCount += 1;
          if (taskCallCount === 1) return withTraceQuery.query;
          if (taskCallCount === 2) return firstCompatTaskPage.query;
          return expandedCompatTaskPage.query;
        }
        if (table === 'agent_trace_events') return traceQuery.query;
        throw new Error(`Unexpected table ${table}`);
      }),
    });

    const GET = await loadGet();
    const response = await GET({
      nextUrl: new URL('http://localhost/api/admin/agents/queue?traceId=trace-compat-expanded&limit=1'),
    } as import('next/server').NextRequest);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.tasks).toHaveLength(1);
    expect(json.tasks[0].id).toBe('task-2');
    expect(expandedCompatTaskPage.getLimit()).toBe(2);
  });

  it('falls back when agent_tasks.params column is unavailable', async () => {
    requireAgentAdminSignedInUserIdMock.mockResolvedValue({ ok: true, userId: 'admin-5' });
    const taskQueries = [
      buildQuery({ data: [], error: { code: '42703', message: 'column "params" does not exist' } }),
      buildQuery({ data: [], error: null }),
    ];

    getAdminSupabaseClientMock.mockReturnValue({
      from: jest.fn((table: string) => {
        if (table !== 'agent_tasks') throw new Error(`Unexpected table ${table}`);
        const next = taskQueries.shift();
        if (!next) throw new Error('Unexpected extra query');
        return next.query;
      }),
    });

    const GET = await loadGet();
    const response = await GET({
      nextUrl: new URL('http://localhost/api/admin/agents/queue'),
    } as import('next/server').NextRequest);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.tasks).toEqual([]);
  });
});
