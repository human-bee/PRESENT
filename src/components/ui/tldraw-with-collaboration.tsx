"use client";

/* eslint-disable @typescript-eslint/no-explicit-any */

import {
  Tldraw,
  TLUiOverrides,
  TLComponents,
  Editor,
} from "tldraw";
import {
  CustomMainMenu,
  CustomToolbarWithTranscript,
} from "./tldraw-with-persistence";
import { ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useSyncDemo } from "@tldraw/sync";
import { CanvasLiveKitContext } from "./livekit-room-connector";
import { ComponentStoreContext } from "./tldraw-canvas";
import type { TamboShapeUtil } from "./tldraw-canvas";
import { useRoomContext } from "@livekit/components-react";
import { RoomEvent } from "livekit-client";

interface TldrawWithCollaborationProps {
  onMount?: (editor: Editor) => void;
  shapeUtils?: readonly (typeof TamboShapeUtil)[];
  componentStore?: Map<string, ReactNode>;
  className?: string;
  onTranscriptToggle?: () => void;
  readOnly?: boolean;
}

// Minimal overrides for now (reuse persistence overrides)
const createCollaborationOverrides = (): TLUiOverrides => ({
  // Can add custom overrides later
});

export function TldrawWithCollaboration({
  onMount,
  shapeUtils,
  componentStore,
  className,
  onTranscriptToggle,
  readOnly = false,
}: TldrawWithCollaborationProps) {
  const livekitCtx = useContext(CanvasLiveKitContext);
  const roomName = livekitCtx?.roomName ?? "tambo-canvas-room";

  // Detect role from LiveKit token metadata
  const room = useRoomContext();
  const [role, setRole] = useState<string | null>(null);

  useEffect(() => {
    if (!room) return;

    const updateRole = () => {
      const meta = room.localParticipant?.metadata;
      if (meta) {
        try {
          const parsed = JSON.parse(meta);
          if (parsed && typeof parsed.role === "string") {
            setRole(parsed.role);
          }
        } catch {
          // ignore parse errors
        }
      }
    };

    updateRole();
    room.on(RoomEvent.LocalTrackPublished, updateRole);
    // No specific metadata changed event for local participant, but re-check on publish events.

    return () => {
      room.off(RoomEvent.LocalTrackPublished, updateRole);
    };
  }, [room]);

  const computedReadOnly = readOnly || role === "viewer" || role === "readOnly";

  // Use useSyncDemo for development - it handles the connection properly
  const store = useSyncDemo({
    roomId: roomName,
    shapeUtils: shapeUtils || [],
  });

  // Debug logging for sync verification
  useEffect(() => {
    console.log('🔄 [TldrawSync-Frontend] Attempting to sync to room:', roomName, {
      readOnly: computedReadOnly,
      role: role,
      hasStore: !!store,
      syncHost: process.env.NEXT_PUBLIC_TLDRAW_SYNC_URL || 'https://ws.tldraw.dev/r',
      livekitConnected: !!room
    });
    
    // Check if store is connected after a short delay
    const checkConnection = setTimeout(() => {
      if (store && (store as any).status !== 'loading') {
        console.log('✅ [TldrawSync-Frontend] Store synced and ready');
      } else if (store && (store as any).status === 'error') {
        console.error('❌ [TldrawSync-Frontend] Sync failed - check network/firewall settings');
        console.log('💡 [TldrawSync-Frontend] Try setting NEXT_PUBLIC_TLDRAW_SYNC_URL to a different endpoint');
      } else {
        console.log('⏳ [TldrawSync-Frontend] Still connecting to sync server...');
      }
    }, 2000);
    
    return () => clearTimeout(checkConnection);
  }, [roomName, computedReadOnly, role, store, room]);

  const handleMount = useCallback(
    (mountedEditor: Editor) => {
      if (onMount) onMount(mountedEditor);
    },
    [onMount]
  );

  // Create memoised overrides & components
  const overrides = useMemo(() => createCollaborationOverrides(), []);
  const MainMenuWithPermissions = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (props: Record<string, unknown>) => (
      <CustomMainMenu {...(props as any)} readOnly={computedReadOnly} />
    ),
    [computedReadOnly]
  );

  const components: TLComponents = useMemo(
    () => ({
      Toolbar: (props) => (
        <CustomToolbarWithTranscript
          {...props}
          onTranscriptToggle={onTranscriptToggle}
        />
      ),
      MainMenu: MainMenuWithPermissions as any,
    }),
    [onTranscriptToggle, MainMenuWithPermissions]
  );

  // Keyboard shortcut for transcript
  useEffect(() => {
    if (!onTranscriptToggle) return;
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        onTranscriptToggle();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onTranscriptToggle]);

  // Ready flag: hide overlay once sync store reports ready (status !== 'loading')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const isStoreReady = !!store && (store as any).status !== 'loading';

  return (
    <div className={className} style={{ position: "absolute", inset: 0 }}>
      <ComponentStoreContext.Provider value={componentStore || null}>
        <Tldraw
          store={store}
          onMount={handleMount}
          shapeUtils={shapeUtils || []}
          components={components}
          overrides={overrides}
          forceMobile={true}
        />
      </ComponentStoreContext.Provider>

      {!isStoreReady && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-50 z-10 pointer-events-none select-none">
          <div className="text-gray-500">Connecting to board…</div>
        </div>
      )}
    </div>
  );
}