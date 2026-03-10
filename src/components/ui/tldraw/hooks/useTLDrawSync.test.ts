import { jest } from '@jest/globals';

jest.mock('@tldraw/sync', () => ({
  useSync: jest.fn(),
}));

jest.mock('@/lib/utils', () => ({
  createLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
  }),
}));

jest.mock('@/lib/realtime/sync-contract', () => ({
  buildSyncContract: jest.fn(() => ({
    errors: [],
    canvasId: null,
    livekitRoomName: 'room-1',
    tldrawRoomId: 'room-1',
  })),
  getCanvasIdFromCurrentUrl: jest.fn(() => null),
}));

const mockUniqueId = jest.fn(() => 'asset-123');

jest.mock('tldraw', () => ({
  AssetRecordType: {
    createId: (id: string) => `asset:${id}`,
  },
  MediaHelpers: {
    isAnimatedImageType: jest.fn(() => false),
    isVectorImageType: jest.fn(() => false),
  },
  defaultBindingUtils: ['default-binding'],
  defaultShapeUtils: ['default-shape'],
  getHashForString: (value: string) => `hash:${value}`,
  uniqueId: (...args: unknown[]) => mockUniqueId(...args),
  useShallowObjectIdentity: <T>(value: T) => value,
}));

import {
  isTldrawOwnedHost,
  normalizeHost,
  resolveSyncHost,
  uploadAssetToSyncHost,
} from './useTLDrawSync';

describe('useTLDrawSync helpers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUniqueId.mockReturnValue('asset-123');
    global.fetch = jest.fn();
  });

  it('normalizes websocket sync hosts to an https origin', () => {
    expect(normalizeHost(' wss://sync.example.com/connect ')).toBe(
      'wss://sync.example.com/connect',
    );
    expect(resolveSyncHost('wss://sync.example.com/connect')).toBe('https://sync.example.com');
    expect(resolveSyncHost(undefined)).toBe('https://demo.tldraw.xyz');
  });

  it('detects tldraw-owned hosts', () => {
    expect(isTldrawOwnedHost('https://tldraw-sync-demo.tldraw.com')).toBe(true);
    expect(isTldrawOwnedHost('https://demo.tldraw.xyz')).toBe(true);
    expect(isTldrawOwnedHost('https://sync.present.best')).toBe(false);
  });

  it('uploads to PRESENT sync servers with PUT first and falls back to POST when needed', async () => {
    const file = new File(['hello'], 'demo image.png', { type: 'image/png' });
    const fetchMock = global.fetch as jest.Mock;
    fetchMock
      .mockResolvedValueOnce({
        ok: false,
        status: 405,
        text: async () => 'Method not allowed',
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => '',
      });

    const result = await uploadAssetToSyncHost('https://sync.present.best', file);

    expect(result).toEqual({
      src: 'https://sync.present.best/uploads/asset-123-demo-image-png',
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://sync.present.best/uploads/asset-123-demo-image-png',
    );
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      method: 'PUT',
      headers: { 'Content-Type': 'image/png' },
    });
    expect(fetchMock.mock.calls[1][1]).toMatchObject({
      method: 'POST',
      headers: { 'Content-Type': 'image/png' },
    });
  });

  it('tries POST first for tldraw-owned demo hosts', async () => {
    const file = new File(['hello'], 'demo.png', { type: 'image/png' });
    const fetchMock = global.fetch as jest.Mock;
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => '',
    });

    await uploadAssetToSyncHost('https://demo.tldraw.xyz', file);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      method: 'POST',
      headers: { 'Content-Type': 'image/png' },
    });
  });
});
