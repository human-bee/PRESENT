import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Room } from 'livekit-client';
import type { customShapeUtil } from '../tldraw-canvas';
import { useCollaborationRole } from './useCollaborationRole';
import { useTLDrawSync } from './useTLDrawSync';

export type CollaborationStatus = 'idle' | 'connecting' | 'syncing' | 'ready' | 'error';

interface UseCollaborationSessionOptions {
  roomName: string;
  room: Room | undefined;
  shapeUtils?: readonly (typeof customShapeUtil)[];
  onError?: (message: string) => void;
}

export function useCollaborationSession({
  roomName,
  room,
  shapeUtils,
  onError,
}: UseCollaborationSessionOptions) {
  const role = useCollaborationRole(room);
  const store = useTLDrawSync(roomName, shapeUtils);
  const [active, setActive] = useState(true);
  const resetInProgressRef = useRef(false);

  const collaborationStatus: CollaborationStatus = useMemo(() => {
    const connectionStatus = store.status === 'synced-remote' ? store.connectionStatus : undefined;
    console.log('[useCollaborationSession] Store state:', {
      active,
      status: store.status,
      connectionStatus,
      error: store.error?.message
    });

    // Expose for Playwright/debugging.
    if (typeof window !== 'undefined') {
      const w = window as any;
      w.__present = w.__present || {};
      w.__present.tldrawSync = {
        roomName,
        status: store.status,
        connectionStatus,
        error: store.error?.message ?? null,
      };
    }

    if (!active) {
      return 'idle';
    }

    switch (store.status) {
      case 'loading':
        return 'connecting';
      case 'error':
        console.error('[useCollaborationSession] Store error:', store.error);
        return 'error';
      case 'synced-remote':
        return store.connectionStatus === 'online' ? 'ready' : 'syncing';
      default:
        return 'idle';
    }
  }, [active, store]);

  useEffect(() => {
    if (collaborationStatus !== 'error' || store.status !== 'error' || !onError) {
      return;
    }
    onError(store.error?.message ?? 'Unable to connect to collaboration session');
  }, [collaborationStatus, store, onError]);

  useEffect(() => {
    if (store.status !== 'error') {
      resetInProgressRef.current = false;
      return;
    }

    const reasonRaw = (store.error as any)?.reason || (store.error?.message ?? '').toUpperCase();
    const isInvalidRecord = typeof reasonRaw === 'string' && reasonRaw.includes('INVALID_RECORD');
    if (!isInvalidRecord || resetInProgressRef.current) {
      return;
    }

    resetInProgressRef.current = true;

    void (async () => {
      try {
        await fetch('/api/tldraw/reset-room', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ room: roomName }),
        });
      } catch (error) {
        console.warn('[CollaborationSession] failed to reset room snapshot', error);
      }

      if (typeof window !== 'undefined') {
        try {
          window.localStorage.removeItem('tldraw');
          window.localStorage.removeItem('tldraw-state');
          window.sessionStorage.removeItem('tldraw');
        } catch { }
        window.location.reload();
      }
    })();
  }, [roomName, store.status, store.error]);

  const start = useCallback(() => {
    setActive(true);
  }, []);

  const stop = useCallback(() => {
    setActive(false);
  }, []);

  const isReadOnly = useMemo(() => role === 'viewer' || role === 'readOnly', [role]);

  return {
    role,
    store,
    isReadOnly,
    status: collaborationStatus,
    start,
    stop,
  };
}
