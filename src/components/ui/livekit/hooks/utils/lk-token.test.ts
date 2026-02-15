const getSupabaseAccessTokenMock = jest.fn();
const resolveEdgeIngressUrlMock = jest.fn();

jest.mock('@/lib/supabase/auth-headers', () => ({
  getSupabaseAccessToken: (...args: any[]) => getSupabaseAccessTokenMock(...args),
}));

jest.mock('@/lib/edge-ingress', () => ({
  resolveEdgeIngressUrl: (...args: any[]) => resolveEdgeIngressUrlMock(...args),
}));

import { buildLivekitTokenHeaders, fetchLivekitAccessToken } from './lk-token';

describe('lk-token helpers', () => {
  const originalFetch = global.fetch;
  const originalCrypto = globalThis.crypto;
  const fetchMock = jest.fn();
  const digestMock = jest.fn(async () => new Uint8Array(32).buffer);

  beforeEach(() => {
    getSupabaseAccessTokenMock.mockReset();
    resolveEdgeIngressUrlMock.mockReset().mockReturnValue('/api/token');
    fetchMock.mockReset();
    digestMock.mockClear();
    (global as any).fetch = fetchMock;
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: {
        randomUUID: () => 'nonce-uuid',
        subtle: {
          digest: digestMock,
        },
      },
    });
  });

  afterAll(() => {
    (global as any).fetch = originalFetch;
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: originalCrypto,
    });
  });

  it('returns base headers when Supabase token is missing', async () => {
    getSupabaseAccessTokenMock.mockResolvedValueOnce(null);

    const headers = await buildLivekitTokenHeaders({
      roomName: 'canvas-1',
      identity: 'alice',
    });

    expect(headers.get('Authorization')).toBeNull();
    expect(headers.get('x-signature')).toBeNull();
    expect(headers.get('x-nonce')).toBeNull();
    expect(headers.get('x-timestamp')).toBeNull();
  });

  it('adds auth and signature headers when Supabase token is present', async () => {
    getSupabaseAccessTokenMock.mockResolvedValueOnce('supabase-token');

    const headers = await buildLivekitTokenHeaders({
      roomName: 'canvas-2',
      identity: 'bob',
      pathname: '/api/token',
    });

    expect(headers.get('Authorization')).toBe('Bearer supabase-token');
    expect(typeof headers.get('x-signature')).toBe('string');
    expect(typeof headers.get('x-nonce')).toBe('string');
    expect(typeof headers.get('x-timestamp')).toBe('string');
    expect(digestMock).toHaveBeenCalledTimes(1);
  });

  it('fetches livekit token with computed headers', async () => {
    getSupabaseAccessTokenMock.mockResolvedValueOnce('supabase-token');
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ accessToken: 'livekit-token' }),
    });

    const signal = new AbortController().signal;
    const token = await fetchLivekitAccessToken({
      roomName: 'canvas-3',
      identity: 'charlie',
      displayName: 'Charlie',
      metadataParam: '',
      signal,
    });

    expect(token).toBe('livekit-token');
    expect(resolveEdgeIngressUrlMock).toHaveBeenCalledWith('/api/token');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/api/token');
    const headers = options.headers as Headers;
    expect(headers.get('Authorization')).toBe('Bearer supabase-token');
    expect(headers.get('x-signature')).toBeTruthy();
  });
});
