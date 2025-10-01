import { useEffect, useMemo, useState } from 'react';
import { useRoomContext } from '@livekit/components-react';
import { RoomEvent } from 'livekit-client';
import type { TLComponents, TLUiOverrides } from 'tldraw';

import { CustomMainMenu, CustomToolbarWithTranscript } from '../tldraw-with-persistence';
import { createLiveKitBus } from '@/lib/livekit/livekit-bus';
import { RemoteTLStoreWithStatus, useSyncDemo } from '@tldraw/sync';
import type { customShapeUtil } from '../tldraw-canvas';
import { createLogger } from '@/lib/utils';

import { createCollaborationOverrides } from '../utils/create-collaboration-overrides';

interface UseCollaborationSessionProps {
  shapeUtils?: readonly (typeof customShapeUtil)[];
  roomName: string;
  onTranscriptToggle?: () => void;
  onHelpClick?: () => void;
  onComponentToolboxToggle?: () => void;
  readOnly?: boolean;
}

export interface CollaborationSessionResult {
  store: RemoteTLStoreWithStatus;
  overrides: TLUiOverrides;
  components: TLComponents;
  resolvedShapeUtils?: readonly (typeof customShapeUtil)[];
  bus: ReturnType<typeof createLiveKitBus>;
  isStoreReady: boolean;
}

export function useCollaborationSession({
  shapeUtils,
  roomName,
  onTranscriptToggle,
  onHelpClick,
  onComponentToolboxToggle,
  readOnly = false,
}: UseCollaborationSessionProps): CollaborationSessionResult {
  const room = useRoomContext();
  const bus = useMemo(() => createLiveKitBus(room), [room]);
  const [role, setRole] = useState<string | null>(null);

  useEffect(() => {
    if (!room) return;

    const updateRole = () => {
      const meta = room.localParticipant?.metadata;
      if (meta) {
        try {
          const parsed = JSON.parse(meta);
          if (parsed && typeof parsed.role === 'string') {
            setRole(parsed.role);
          }
        } catch {
          // ignore parse errors
        }
      }
    };

    updateRole();
    room.on(RoomEvent.LocalTrackPublished, updateRole);

    return () => {
      room.off(RoomEvent.LocalTrackPublished, updateRole);
    };
  }, [room]);

  const computedReadOnly = readOnly || role === 'viewer' || role === 'readOnly';

  const resolvedShapeUtils = useMemo(
    () => (shapeUtils && shapeUtils.length > 0 ? shapeUtils : undefined),
    [shapeUtils],
  );

  const envHost =
    process.env.NEXT_PUBLIC_TLDRAW_SYNC_URL || process.env.NEXT_PUBLIC_TLDRAW_SYNC_HOST;

  const computedHost = useMemo(() => {
    if (!envHost) return 'https://demo.tldraw.xyz';
    try {
      const url = new URL(envHost);
      if (url.protocol === 'ws:' || url.protocol === 'wss:') {
        url.protocol = 'https:';
        url.pathname = url.pathname.replace(/\/?connect\/?$/, '').replace(/\/+$/, '');
        return url.origin;
      }
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

  type UseSyncDemoOptionsWithHost = Parameters<typeof useSyncDemo>[0] & { host?: string };

  const syncOptions = useMemo<UseSyncDemoOptionsWithHost>(
    () => ({
      roomId: roomName,
      ...(resolvedShapeUtils ? { shapeUtils: resolvedShapeUtils } : {}),
      host: safeHost,
    }),
    [roomName, resolvedShapeUtils, safeHost],
  );

  const store: RemoteTLStoreWithStatus = useSyncDemo(syncOptions);

  useEffect(() => {
    if (process.env.NODE_ENV !== 'development') return;
    try {
      const g: any = globalThis as any;
      if (!g.__LOGGED_TLDRAW_SYNC_HOST__) {
        createLogger('Tldraw').info('Using sync host:', safeHost);
        g.__LOGGED_TLDRAW_SYNC_HOST__ = true;
      }
    } catch {}
  }, [safeHost]);

  const overrides = useMemo(() => createCollaborationOverrides(), []);

  const components: TLComponents = useMemo(() => {
    const toolbar: TLComponents['Toolbar'] = (props) => (
      <CustomToolbarWithTranscript
        {...props}
        onTranscriptToggle={onTranscriptToggle}
        onHelpClick={onHelpClick}
        onComponentToolboxToggle={onComponentToolboxToggle}
      />
    );

    const mainMenu: TLComponents['MainMenu'] = (props) => (
      <CustomMainMenu {...(props as any)} readOnly={computedReadOnly} />
    );

    return {
      Toolbar: toolbar,
      MainMenu: mainMenu,
    };
  }, [onTranscriptToggle, onHelpClick, onComponentToolboxToggle, computedReadOnly]);

  const isStoreReady = store.status !== 'loading';

  return {
    store,
    overrides,
    components,
    resolvedShapeUtils,
    bus,
    isStoreReady,
  };
}
