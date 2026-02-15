const resolveRequestUserIdMock = jest.fn();

jest.mock('@/lib/supabase/server/resolve-request-user', () => ({
  resolveRequestUserId: (...args: unknown[]) => resolveRequestUserIdMock(...args),
}));

describe('agent admin auth', () => {
  const fakeRequest = {} as unknown as import('next/server').NextRequest;

  beforeEach(() => {
    resolveRequestUserIdMock.mockReset();
    delete process.env.AGENT_ADMIN_ALLOWLIST_USER_IDS;
  });

  it('returns unauthorized when no session user exists', async () => {
    resolveRequestUserIdMock.mockResolvedValue(null);
    const { requireAgentAdminUserId } = await import('@/lib/agents/admin/auth');
    const result = await requireAgentAdminUserId(fakeRequest);

    expect(result).toEqual({ ok: false, status: 401, error: 'unauthorized' });
  });

  it('returns allowlist-not-configured when allowlist is empty', async () => {
    resolveRequestUserIdMock.mockResolvedValue('user-1');
    process.env.AGENT_ADMIN_ALLOWLIST_USER_IDS = '';
    const { requireAgentAdminUserId } = await import('@/lib/agents/admin/auth');
    const result = await requireAgentAdminUserId(fakeRequest);

    expect(result).toEqual({ ok: false, status: 403, error: 'admin_allowlist_not_configured' });
  });

  it('returns forbidden when user is not in allowlist', async () => {
    resolveRequestUserIdMock.mockResolvedValue('user-2');
    process.env.AGENT_ADMIN_ALLOWLIST_USER_IDS = 'user-1,user-3';
    const { requireAgentAdminUserId } = await import('@/lib/agents/admin/auth');
    const result = await requireAgentAdminUserId(fakeRequest);

    expect(result).toEqual({ ok: false, status: 403, error: 'forbidden' });
  });

  it('returns ok when user is in allowlist', async () => {
    resolveRequestUserIdMock.mockResolvedValue('user-3');
    process.env.AGENT_ADMIN_ALLOWLIST_USER_IDS = 'user-1,user-3';
    const { requireAgentAdminUserId } = await import('@/lib/agents/admin/auth');
    const result = await requireAgentAdminUserId(fakeRequest);

    expect(result).toEqual({ ok: true, userId: 'user-3' });
  });
});
