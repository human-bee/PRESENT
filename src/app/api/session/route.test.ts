/**
 * @jest-environment node
 */

const createClientMock = jest.fn();

jest.mock('@supabase/supabase-js', () => ({
  createClient: createClientMock,
}));

const loadGet = async () => {
  let GET: ((req: import('next/server').NextRequest) => Promise<Response>) | null = null;
  await jest.isolateModulesAsync(async () => {
    const route = await import('./route');
    GET = route.GET;
  });
  return GET as (req: import('next/server').NextRequest) => Promise<Response>;
};

const buildSessionQuery = (result: { data: unknown; error: unknown }) => {
  const query: any = Promise.resolve(result);
  query.select = jest.fn(() => query);
  query.eq = jest.fn(() => query);
  query.order = jest.fn(() => query);
  query.limit = jest.fn(() => query);
  query.is = jest.fn(() => query);
  query.maybeSingle = jest.fn(() => Promise.resolve(result));
  return query;
};

describe('/api/session', () => {
  beforeEach(() => {
    jest.resetModules();
    createClientMock.mockReset();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-test-key';
    process.env.SESSION_GET_RETRY_ATTEMPTS = '8';
    process.env.SESSION_GET_RETRY_DELAY_MS = '250';
  });

  it('does not retry definitive not-found reads', async () => {
    const sessionQuery = buildSessionQuery({ data: null, error: null });
    createClientMock.mockReturnValue({
      from: jest.fn(() => sessionQuery),
    });

    const GET = await loadGet();
    const response = await GET({
      url: 'http://localhost/api/session?roomName=canvas-room-1',
      nextUrl: new URL('http://localhost/api/session?roomName=canvas-room-1'),
      headers: { get: () => null },
    } as unknown as import('next/server').NextRequest);

    expect(response.status).toBe(404);
    expect(sessionQuery.maybeSingle).toHaveBeenCalledTimes(1);
  });
});

