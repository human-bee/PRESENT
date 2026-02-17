const resolveRequestUserMock = jest.fn();

jest.mock('@/lib/supabase/server/resolve-request-user', () => ({
  resolveRequestUser: (...args: unknown[]) => resolveRequestUserMock(...args),
}));

describe('agent admin auth', () => {
  const fakeRequest = {} as unknown as import('next/server').NextRequest;

  beforeEach(() => {
    resolveRequestUserMock.mockReset();
    delete process.env.AGENT_ADMIN_ALLOWLIST_USER_IDS;
  });

  it('returns unauthorized when no session user exists', async () => {
    resolveRequestUserMock.mockResolvedValue(null);
    const { requireAgentAdminUserId } = await import('@/lib/agents/admin/auth');
    const result = await requireAgentAdminUserId(fakeRequest);

    expect(result).toEqual({ ok: false, status: 401, error: 'unauthorized' });
  });

  it('returns allowlist-not-configured when allowlist is empty', async () => {
    resolveRequestUserMock.mockResolvedValue({ id: 'user-1', email: null });
    process.env.AGENT_ADMIN_ALLOWLIST_USER_IDS = '';
    const { requireAgentAdminUserId } = await import('@/lib/agents/admin/auth');
    const result = await requireAgentAdminUserId(fakeRequest);

    expect(result).toEqual({ ok: false, status: 403, error: 'admin_allowlist_not_configured' });
  });

  it('returns forbidden when user is not in allowlist', async () => {
    resolveRequestUserMock.mockResolvedValue({ id: 'user-2', email: 'user2@example.com' });
    process.env.AGENT_ADMIN_ALLOWLIST_USER_IDS = 'user-1,user-3';
    const { requireAgentAdminUserId } = await import('@/lib/agents/admin/auth');
    const result = await requireAgentAdminUserId(fakeRequest);

    expect(result).toEqual({ ok: false, status: 403, error: 'forbidden' });
  });

  it('returns ok when user is in allowlist', async () => {
    resolveRequestUserMock.mockResolvedValue({ id: 'user-3', email: 'user3@example.com' });
    process.env.AGENT_ADMIN_ALLOWLIST_USER_IDS = 'user-1,user-3';
    const { requireAgentAdminUserId } = await import('@/lib/agents/admin/auth');
    const result = await requireAgentAdminUserId(fakeRequest);

    expect(result).toEqual({ ok: true, userId: 'user-3' });
  });

  it('returns ok when user email is allowlisted', async () => {
    resolveRequestUserMock.mockResolvedValue({ id: 'user-9', email: 'admin@example.com' });
    process.env.AGENT_ADMIN_ALLOWLIST_USER_IDS = 'admin@example.com';
    const { requireAgentAdminUserId } = await import('@/lib/agents/admin/auth');
    const result = await requireAgentAdminUserId(fakeRequest);

    expect(result).toEqual({ ok: true, userId: 'user-9' });
  });
});
