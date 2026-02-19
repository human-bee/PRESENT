/**
 * @jest-environment node
 */

const createClientMock = jest.fn();
const createServerClientMock = jest.fn();
const cookiesMock = jest.fn();

jest.mock('@supabase/supabase-js', () => ({
  createClient: createClientMock,
}));

jest.mock('@supabase/ssr', () => ({
  createServerClient: createServerClientMock,
}));

jest.mock('next/headers', () => ({
  cookies: cookiesMock,
}));

const loadRoute = async () => {
  let GET: ((req: import('next/server').NextRequest) => Promise<Response>) | null = null;
  let POST: ((req: import('next/server').NextRequest) => Promise<Response>) | null = null;
  await jest.isolateModulesAsync(async () => {
    const route = await import('./route');
    GET = route.GET;
    POST = route.POST;
  });
  return {
    GET: GET as (req: import('next/server').NextRequest) => Promise<Response>,
    POST: POST as (req: import('next/server').NextRequest) => Promise<Response>,
  };
};

const buildQuery = (result: { data: unknown; error: unknown }) => {
  const query: any = Promise.resolve(result);
  query.select = jest.fn(() => query);
  query.eq = jest.fn(() => query);
  query.gte = jest.fn(() => query);
  query.order = jest.fn(() => query);
  query.limit = jest.fn(() => query);
  query.maybeSingle = jest.fn(() => Promise.resolve(result));
  query.upsert = jest.fn(() => Promise.resolve(result));
  query.delete = jest.fn(() => query);
  query.lt = jest.fn(() => query);
  return query;
};

describe('/api/session-transcripts', () => {
  beforeEach(() => {
    jest.resetModules();
    createClientMock.mockReset();
    createServerClientMock.mockReset();
    cookiesMock.mockReset();
    process.env.NODE_ENV = 'development';
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-test-key';
  });

  it('falls back to in-memory transcript store when persistence lookup fails', async () => {
    const sessionLookup = buildQuery({
      data: null,
      error: { message: 'relation "canvas_sessions" does not exist' },
    });
    createClientMock.mockReturnValue({
      from: jest.fn(() => sessionLookup),
    });

    const { POST } = await loadRoute();
    const response = await POST({
      headers: new Headers({ Authorization: 'Bearer test-token' }),
      json: async () => ({
        sessionId: '11111111-1111-4111-8111-111111111111',
        entries: [
          {
            eventId: 'event-12345678',
            participantId: 'voice-agent',
            participantName: 'voice-agent',
            text: 'hello fallback',
            timestamp: Date.now(),
            manual: true,
          },
        ],
      }),
    } as unknown as import('next/server').NextRequest);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.fallback).toBe(true);
  });

  it('serves GET from in-memory fallback when transcript table is unavailable', async () => {
    const transcriptLookup = buildQuery({
      data: null,
      error: { message: 'relation "canvas_session_transcripts" does not exist' },
    });
    createClientMock.mockReturnValue({
      from: jest.fn(() => transcriptLookup),
    });

    const { GET } = await loadRoute();
    const response = await GET({
      headers: new Headers({ Authorization: 'Bearer test-token' }),
      url: 'http://localhost/api/session-transcripts?sessionId=11111111-1111-4111-8111-111111111111&limit=20',
    } as unknown as import('next/server').NextRequest);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(Array.isArray(json.transcript)).toBe(true);
    expect(json.transcript.some((entry: { eventId?: string }) => entry.eventId === 'event-12345678')).toBe(
      true,
    );
  });
});

