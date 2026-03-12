/**
 * @jest-environment node
 */

import { NextRequest } from 'next/server';

const readFileMock = jest.fn();
const requireAgentAdminUserIdMock = jest.fn();

jest.mock('node:fs/promises', () => ({
  readFile: (...args: unknown[]) => readFileMock(...args),
}));

jest.mock('@/lib/agents/admin/auth', () => ({
  requireAgentAdminUserId: (...args: unknown[]) => requireAgentAdminUserIdMock(...args),
}));

describe('/admin/agents/benchmarks/asset route', () => {
  beforeEach(() => {
    readFileMock.mockReset();
    requireAgentAdminUserIdMock.mockReset();
  });

  it('returns 401 when benchmark asset auth fails', async () => {
    requireAgentAdminUserIdMock.mockResolvedValue({
      ok: false,
      status: 401,
      error: 'unauthorized',
    });
    const { GET } = await import('./route');

    const response = await GET(
      new NextRequest('http://localhost/admin/agents/benchmarks/asset/docs/foo.png'),
      { params: Promise.resolve({ slug: ['benchmarks', 'canvas-agent', 'foo.png'] }) },
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'unauthorized' });
    expect(readFileMock).not.toHaveBeenCalled();
  });

  it('serves allowed docs assets for authorized users', async () => {
    requireAgentAdminUserIdMock.mockResolvedValue({
      ok: true,
      userId: 'admin-1',
      mode: 'allowlist',
    });
    readFileMock.mockResolvedValue(Buffer.from('png-data'));
    const { GET } = await import('./route');

    const response = await GET(
      new NextRequest('http://localhost/admin/agents/benchmarks/asset/benchmarks/canvas-agent/foo.png'),
      { params: Promise.resolve({ slug: ['benchmarks', 'canvas-agent', 'foo.png'] }) },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/png');
    expect(readFileMock).toHaveBeenCalledTimes(1);
  });

  it('blocks path traversal even for authorized users', async () => {
    requireAgentAdminUserIdMock.mockResolvedValue({
      ok: true,
      userId: 'admin-1',
      mode: 'allowlist',
    });
    const { GET } = await import('./route');

    const response = await GET(
      new NextRequest('http://localhost/admin/agents/benchmarks/asset/../../secrets.txt'),
      { params: Promise.resolve({ slug: ['..', '..', 'secrets.txt'] }) },
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: 'forbidden' });
    expect(readFileMock).not.toHaveBeenCalled();
  });
});
