import { useCallback, useEffect, useMemo, useState } from 'react';
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

  const collaborationStatus: CollaborationStatus = useMemo(() => {
    if (!active) {
      return 'idle';
    }

    switch (store.status) {
      case 'loading':
        return 'connecting';
      case 'error':
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
