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
  eq: jest.MockedFunction<() => QueryBuilder>;
};

const buildQuery = (result: { data: unknown[]; error: null | { message: string } }) => {
  let limitValue: number | null = null;
  const query = Promise.resolve(result) as QueryBuilder;
  query.select = jest.fn(() => query);
  query.order = jest.fn(() => query);
  query.limit = jest.fn((value: number) => {
    limitValue = value;
    return query;
  });
  query.eq = jest.fn(() => query);
  return { query, getLimit: () => limitValue };
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
});
