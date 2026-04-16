/**
 * @jest-environment node
 */

const resolveRequestUserIdMock = jest.fn();
const listUserModelKeyStatusMock = jest.fn();

jest.mock('@/lib/supabase/server/resolve-request-user', () => ({
  resolveRequestUserId: resolveRequestUserIdMock,
}));

jest.mock('@/lib/agents/shared/user-model-keys', () => ({
  ...jest.requireActual('@/lib/agents/shared/user-model-keys'),
  listUserModelKeyStatus: listUserModelKeyStatusMock,
}));

const loadGet = async () => {
  let GET: ((req: import('next/server').NextRequest) => Promise<Response>) | null = null;
  await jest.isolateModulesAsync(async () => {
    const route = await import('./route');
    GET = route.GET;
  });
  return GET as (req: import('next/server').NextRequest) => Promise<Response>;
};

describe('/api/provider-links', () => {
  beforeEach(() => {
    jest.resetModules();
    resolveRequestUserIdMock.mockReset();
    listUserModelKeyStatusMock.mockReset();
  });

  it('returns link state for every shared model-key provider', async () => {
    resolveRequestUserIdMock.mockResolvedValue('user-1');
    listUserModelKeyStatusMock.mockResolvedValue([
      { provider: 'openai', configured: true, last4: '1234' },
      { provider: 'fal', configured: true, last4: '9876' },
    ]);

    const GET = await loadGet();
    const response = await GET({
      nextUrl: new URL('http://localhost/api/provider-links'),
    } as import('next/server').NextRequest);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.links).toEqual([
      { provider: 'openai', state: 'api_key_configured', apiKeyConfigured: true, linked: false },
      { provider: 'anthropic', state: 'missing', apiKeyConfigured: false, linked: false },
      { provider: 'google', state: 'missing', apiKeyConfigured: false, linked: false },
      { provider: 'together', state: 'missing', apiKeyConfigured: false, linked: false },
      { provider: 'cerebras', state: 'missing', apiKeyConfigured: false, linked: false },
      { provider: 'fal', state: 'api_key_configured', apiKeyConfigured: true, linked: false },
      { provider: 'xai', state: 'missing', apiKeyConfigured: false, linked: false },
    ]);
  });
});
