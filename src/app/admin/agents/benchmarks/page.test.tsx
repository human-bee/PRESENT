import { render, screen } from '@testing-library/react';
import AgentBenchmarksPage from './page';

const requireAgentAdminCurrentUserIdMock = jest.fn();
const loadBenchmarkManifestMock = jest.fn();

jest.mock('@/lib/agents/admin/auth', () => ({
  requireAgentAdminCurrentUserId: (...args: unknown[]) => requireAgentAdminCurrentUserIdMock(...args),
}));

jest.mock('./benchmark-data', () => ({
  loadBenchmarkManifest: (...args: unknown[]) => loadBenchmarkManifestMock(...args),
}));

describe('/admin/agents/benchmarks page', () => {
  beforeEach(() => {
    requireAgentAdminCurrentUserIdMock.mockReset();
    loadBenchmarkManifestMock.mockReset();
  });

  it('renders an access message when benchmark admin auth fails', async () => {
    requireAgentAdminCurrentUserIdMock.mockResolvedValue({
      ok: false,
      status: 401,
      error: 'unauthorized',
    });

    render(await AgentBenchmarksPage());

    expect(screen.getByText('Benchmark access requires sign-in.')).toBeTruthy();
    expect(screen.getByText(/unauthorized/)).toBeTruthy();
    expect(loadBenchmarkManifestMock).not.toHaveBeenCalled();
  });

  it('renders the empty manifest state for authorized users', async () => {
    requireAgentAdminCurrentUserIdMock.mockResolvedValue({
      ok: true,
      userId: 'admin-1',
      mode: 'allowlist',
    });
    loadBenchmarkManifestMock.mockResolvedValue(null);

    render(await AgentBenchmarksPage());

    expect(screen.getByText('No benchmark manifest found yet.')).toBeTruthy();
    expect(loadBenchmarkManifestMock).toHaveBeenCalledTimes(1);
  });
});
