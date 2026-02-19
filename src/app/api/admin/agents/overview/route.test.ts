/**
 * @jest-environment node
 */

const requireAgentAdminUserIdMock = jest.fn();
const getAdminSupabaseClientMock = jest.fn();

jest.mock('@/lib/agents/admin/auth', () => ({
  requireAgentAdminUserId: requireAgentAdminUserIdMock,
  isAgentAdminDetailGlobalScopeEnabled: () => true,
  isAgentAdminDetailMaskDefaultEnabled: () => true,
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

type QueryResult = {
  data?: unknown;
  count?: number | null;
  error: null | { message: string; code?: string };
};

type QueryBuilder = Promise<QueryResult> & {
  select: jest.MockedFunction<(columns?: string, options?: Record<string, unknown>) => QueryBuilder>;
  eq: jest.MockedFunction<(column: string, value: string) => QueryBuilder>;
  in: jest.MockedFunction<(column: string, value: string[]) => QueryBuilder>;
  gte: jest.MockedFunction<(column: string, value: string) => QueryBuilder>;
  order: jest.MockedFunction<(column: string, options?: { ascending?: boolean }) => QueryBuilder>;
  limit: jest.MockedFunction<(value: number) => QueryBuilder>;
};

const buildQuery = (result: QueryResult): QueryBuilder => {
  const query = Promise.resolve(result) as QueryBuilder;
  query.select = jest.fn(() => query);
  query.eq = jest.fn(() => query);
  query.in = jest.fn(() => query);
  query.gte = jest.fn(() => query);
  query.order = jest.fn(() => query);
  query.limit = jest.fn(() => query);
  return query;
};

describe('/api/admin/agents/overview', () => {
  beforeEach(() => {
    requireAgentAdminUserIdMock.mockReset();
    getAdminSupabaseClientMock.mockReset();
  });

  it('returns provider mix and provider failure aggregates', async () => {
    requireAgentAdminUserIdMock.mockResolvedValue({ ok: true, userId: 'admin-1', mode: 'allowlist' });

    const queryResults: QueryResult[] = [
      { count: 5, error: null },
      { count: 3, error: null },
      { count: 2, error: null },
      { count: 7, error: null },
      { count: 1, error: null },
      { data: [{ created_at: '2026-02-17T12:00:00.000Z' }], error: null },
      { count: 20, error: null },
      { count: 7, error: null },
      { count: 20, error: null },
      { count: 10, error: null },
      { count: 3, error: null },
      { count: 2, error: null },
      { count: 1, error: null },
      { count: 1, error: null },
      { count: 1, error: null },
      { count: 4, error: null },
      { count: 1, error: null },
      { count: 1, error: null },
      { count: 0, error: null },
      { count: 0, error: null },
      { count: 0, error: null },
      {
        data: [
          { worker_id: 'worker-1', updated_at: '2026-02-17T12:00:00.000Z' },
          { worker_id: 'worker-2', updated_at: '2026-02-17T12:00:01.000Z' },
        ],
        error: null,
      },
    ];

    getAdminSupabaseClientMock.mockReturnValue({
      from: jest.fn(() => {
        const next = queryResults.shift();
        if (!next) {
          throw new Error('Unexpected query invocation');
        }
        return buildQuery(next);
      }),
    });

    const GET = await loadGet();
    const response = await GET({
      nextUrl: new URL('http://localhost/api/admin/agents/overview'),
    } as import('next/server').NextRequest);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.providerMix).toMatchObject({
      openai: 10,
      anthropic: 3,
      google: 2,
      cerebras: 1,
      together: 1,
      debug: 1,
      unknown: 2,
    });
    expect(json.providerFailures).toMatchObject({
      openai: 4,
      anthropic: 1,
      google: 1,
      cerebras: 0,
      together: 0,
      debug: 0,
      unknown: 1,
    });
    expect(json.activeWorkers).toBe(2);
  });

  it('falls back to unknown provider buckets when provider queries error', async () => {
    requireAgentAdminUserIdMock.mockResolvedValue({ ok: true, userId: 'admin-1', mode: 'allowlist' });

    const queryResults: QueryResult[] = [
      { count: 0, error: null },
      { count: 1, error: null },
      { count: 0, error: null },
      { count: 4, error: null },
      { count: 0, error: null },
      { data: [], error: null },
      { count: 9, error: null },
      { count: 2, error: null },
      { error: { message: '' } },
      {
        data: [{ worker_id: 'worker-1', updated_at: '2026-02-19T00:00:00.000Z' }],
        error: null,
      },
    ];

    getAdminSupabaseClientMock.mockReturnValue({
      from: jest.fn(() => {
        const next = queryResults.shift();
        if (!next) {
          throw new Error('Unexpected query invocation');
        }
        return buildQuery(next);
      }),
    });

    const GET = await loadGet();
    const response = await GET({
      nextUrl: new URL('http://localhost/api/admin/agents/overview'),
    } as import('next/server').NextRequest);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.providerMix).toMatchObject({
      openai: 0,
      anthropic: 0,
      google: 0,
      cerebras: 0,
      together: 0,
      debug: 0,
      unknown: 9,
    });
    expect(json.providerFailures).toMatchObject({
      openai: 0,
      anthropic: 0,
      google: 0,
      cerebras: 0,
      together: 0,
      debug: 0,
      unknown: 2,
    });
    expect(json.activeWorkers).toBe(1);
  });
});
