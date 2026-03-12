/**
 * @jest-environment node
 */

import { NextRequest } from 'next/server';

const requireAgentAdminUserIdMock = jest.fn();
const loadBenchmarkManifestMock = jest.fn();

jest.mock('@/lib/agents/admin/auth', () => ({
  requireAgentAdminUserId: (...args: unknown[]) => requireAgentAdminUserIdMock(...args),
}));

jest.mock('@/app/admin/agents/benchmarks/benchmark-data', () => ({
  loadBenchmarkManifest: (...args: unknown[]) => loadBenchmarkManifestMock(...args),
}));

describe('/api/admin/agents/benchmarks/manifest', () => {
  beforeEach(() => {
    requireAgentAdminUserIdMock.mockReset();
    loadBenchmarkManifestMock.mockReset();
  });

  it('returns auth failures from agent admin auth', async () => {
    requireAgentAdminUserIdMock.mockResolvedValue({
      ok: false,
      status: 401,
      error: 'unauthorized',
    });
    const { GET } = await import('./route');

    const response = await GET(new NextRequest('http://localhost/api/admin/agents/benchmarks/manifest'));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'unauthorized' });
    expect(loadBenchmarkManifestMock).not.toHaveBeenCalled();
  });

  it('returns the current manifest payload for authorized users', async () => {
    requireAgentAdminUserIdMock.mockResolvedValue({
      ok: true,
      userId: 'admin-1',
      mode: 'allowlist',
    });
    loadBenchmarkManifestMock.mockResolvedValue({ suiteId: 'suite-1' });
    const { GET } = await import('./route');

    const response = await GET(new NextRequest('http://localhost/api/admin/agents/benchmarks/manifest'));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ manifest: { suiteId: 'suite-1' } });
  });

  it('returns manifest load errors explicitly instead of masking them as missing data', async () => {
    requireAgentAdminUserIdMock.mockResolvedValue({
      ok: true,
      userId: 'admin-1',
      mode: 'allowlist',
    });
    loadBenchmarkManifestMock.mockRejectedValue(new Error('Benchmark manifest is not valid JSON'));
    const { GET } = await import('./route');

    const response = await GET(new NextRequest('http://localhost/api/admin/agents/benchmarks/manifest'));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: 'Benchmark manifest is not valid JSON',
    });
  });
});
