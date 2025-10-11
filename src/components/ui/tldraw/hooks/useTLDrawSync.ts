import { useMemo } from 'react';
import { useSyncDemo, RemoteTLStoreWithStatus } from '@tldraw/sync';
import type { customShapeUtil } from '../tldraw-canvas';
import { createLogger } from '@/lib/utils';

/**
 * Configures TLDraw sync with the demo server
 * @param roomName - Name of the room to sync
 * @param shapeUtils - Optional shape utilities to register
 * @returns TLDraw store with sync status
 */
function normalizeHost(rawHost?: string | null) {
  if (!rawHost) return null;
  const trimmed = rawHost.trim();
  if (!trimmed || trimmed === 'null' || trimmed === 'undefined') return null;
  return trimmed;
}

export function useTLDrawSync(
  roomName: string,
  shapeUtils?: readonly (typeof customShapeUtil)[],
): RemoteTLStoreWithStatus {
  // Determine sync host from environment
  const envHost = normalizeHost(
    process.env.NEXT_PUBLIC_TLDRAW_SYNC_URL || process.env.NEXT_PUBLIC_TLDRAW_SYNC_HOST,
  );

  const computedHost = useMemo(() => {
    if (!envHost) return 'https://demo.tldraw.xyz';

    try {
      const url = new URL(envHost);
      // If it's ws(s), force https base so the library will choose wss correctly
      if (url.protocol === 'ws:' || url.protocol === 'wss:') {
        url.protocol = 'https:';
        url.pathname = url.pathname.replace(/\/?connect\/?$/, '').replace(/\/+$/, '');
        return url.origin;
      }
      // If it already includes /connect at the end, drop it; useSyncDemo adds it
      url.pathname = url.pathname.replace(/\/?connect\/?$/, '').replace(/\/+$/, '');
      return url.origin;
    } catch {
      return 'https://demo.tldraw.xyz';
    }
  }, [envHost]);

  const safeHost = useMemo(() => {
    try {
      const u = new URL(computedHost);
      return u.origin;
    } catch {
      return 'https://demo.tldraw.xyz';
    }
  }, [computedHost]);

  const resolvedShapeUtils = useMemo(
    () => (shapeUtils && shapeUtils.length > 0 ? shapeUtils : undefined),
    [shapeUtils],
  );

  type UseSyncDemoOptionsWithSafeHost = Parameters<typeof useSyncDemo>[0] & { host?: string };

  const syncOptions = useMemo<UseSyncDemoOptionsWithSafeHost>(
    () => ({
      roomId: roomName,
      ...(resolvedShapeUtils ? { shapeUtils: resolvedShapeUtils } : {}),
      host: safeHost,
    }),
    [roomName, resolvedShapeUtils, safeHost],
  );

  const store: RemoteTLStoreWithStatus = useSyncDemo(syncOptions);

  // Log sync host once per session in dev
  try {
    const g: any = globalThis as any;
    if (process.env.NODE_ENV === 'development' && !g.__LOGGED_TLDRAW_SYNC_HOST__) {
      createLogger('Tldraw').info('Using sync host:', safeHost);
      g.__LOGGED_TLDRAW_SYNC_HOST__ = true;
    }
  } catch {}

  return store;
}
