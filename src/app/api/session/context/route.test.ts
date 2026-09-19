/**
 * @jest-environment node
 */

const createClientMock = jest.fn();

jest.mock('@supabase/supabase-js', () => ({
  createClient: createClientMock,
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

const makeRequest = (
  method: 'GET' | 'POST',
  url: string,
  body?: Record<string, unknown>,
) => ({
  method,
  url,
  nextUrl: new URL(url),
  json: async () => body,
} as unknown as import('next/server').NextRequest);

const buildContextDocumentsQuery = (result: { data: unknown; error: unknown }) => {
  const query: any = Promise.resolve(result);
  query.select = jest.fn(() => query);
  query.eq = jest.fn(() => query);
  query.maybeSingle = jest.fn(() => Promise.resolve(result));
  return query;
};

describe('/api/session/context', () => {
  beforeEach(() => {
    jest.resetModules();
    createClientMock.mockReset();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-test-key';
  });

  it('returns sanitized MCP context documents on GET', async () => {
    const sessionQuery = buildContextDocumentsQuery({
      data: {
        context_documents: [
          {
            id: 'doc-1',
            title: 'MCP Context',
            content: 'summary',
            type: 'text',
            timestamp: 123,
            source: 'mcp',
          },
          {
            id: 'doc-2',
            title: 'Bad Context',
            content: 'summary',
            type: 'text',
            timestamp: 123,
            source: 'email',
          },
        ],
      },
      error: null,
    });
    createClientMock.mockReturnValue({
      from: jest.fn(() => sessionQuery),
    });

    const { GET } = await loadRoute();
    const response = await GET(
      makeRequest('GET', 'http://localhost/api/session/context?sessionId=canvas-room-1'),
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toEqual({
      contextDocuments: [
        {
          id: 'doc-1',
          title: 'MCP Context',
          content: 'summary',
          type: 'text',
          timestamp: 123,
          source: 'mcp',
        },
      ],
    });
  });

  it('rejects invalid context document payloads on POST', async () => {
    const sessionQuery = buildContextDocumentsQuery({ data: null, error: null });
    createClientMock.mockReturnValue({
      from: jest.fn(() => sessionQuery),
    });

    const { POST } = await loadRoute();
    const response = await POST(
      makeRequest('POST', 'http://localhost/api/session/context', {
        sessionId: 'canvas-room-1',
        contextDocuments: [
          {
            id: 'doc-1',
            title: 'Invalid',
            content: 'summary',
            type: 'text',
            timestamp: 123,
            source: 'email',
          },
        ],
      }),
    );
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json).toEqual({ error: 'contextDocuments contains invalid entries' });
  });
});
