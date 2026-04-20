/** @jest-environment node */

const listWidgetCodexServersMock = jest.fn();
const createWidgetCodexServerMock = jest.fn();
const requireWidgetCodexReadAuthMock = jest.fn();
const requireWidgetCodexActionAuthMock = jest.fn();

jest.mock('@present/widget-codex/client', () => ({
  listWidgetCodexServers: (...args: unknown[]) => listWidgetCodexServersMock(...args),
  createWidgetCodexServer: (...args: unknown[]) => createWidgetCodexServerMock(...args),
}));

jest.mock('@/lib/widget-codex/route-auth', () => ({
  requireWidgetCodexReadAuth: (...args: unknown[]) => requireWidgetCodexReadAuthMock(...args),
  requireWidgetCodexActionAuth: (...args: unknown[]) => requireWidgetCodexActionAuthMock(...args),
}));

describe('/api/widget-codex/servers', () => {
  beforeEach(() => {
    listWidgetCodexServersMock.mockReset();
    createWidgetCodexServerMock.mockReset();
    requireWidgetCodexReadAuthMock.mockReset();
    requireWidgetCodexActionAuthMock.mockReset();
    requireWidgetCodexReadAuthMock.mockResolvedValue(null);
    requireWidgetCodexActionAuthMock.mockResolvedValue(null);
  });

  it('returns auth failures from the read guard', async () => {
    requireWidgetCodexReadAuthMock.mockResolvedValue(
      Response.json({ error: 'unauthorized' }, { status: 401 }),
    );

    const { GET } = await import('./route');
    const response = await GET({} as import('next/server').NextRequest);
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload.error).toBe('unauthorized');
    expect(listWidgetCodexServersMock).not.toHaveBeenCalled();
  });

  it('guards mutations and proxies successful creates', async () => {
    createWidgetCodexServerMock.mockResolvedValue({
      server: {
        id: 'wcsrv_1',
        label: 'Remote Prod',
      },
    });

    const { POST } = await import('./route');
    const response = await POST(
      new Request('http://localhost/api/widget-codex/servers', {
        method: 'POST',
        body: JSON.stringify({
          label: 'Remote Prod',
          directTargetUrl: 'https://remote-codex.example/',
          authStrategy: 'none',
          workspaces: [],
        }),
      }) as unknown as import('next/server').NextRequest,
    );
    const payload = await response.json();

    expect(requireWidgetCodexActionAuthMock).toHaveBeenCalled();
    expect(createWidgetCodexServerMock).toHaveBeenCalledWith(
      expect.objectContaining({
        label: 'Remote Prod',
        directTargetUrl: 'https://remote-codex.example/',
      }),
    );
    expect(response.status).toBe(201);
    expect(payload.server.id).toBe('wcsrv_1');
  });
});
