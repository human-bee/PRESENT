"use client";

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

  // Store from sync demo – phase-1 implementation
  const store = useSyncDemo({
    roomId: roomName,
    readOnly: computedReadOnly,
  } as any);

  // Debug logging for sync verification
  useEffect(() => {
    console.log('🔄 [TldrawSync-Frontend] Attempting to sync to room:', roomName, {
      readOnly: computedReadOnly,
      role: role,
      hasStore: !!store,
      livekitConnected: !!room
    });
    
    // Check if store is connected after a short delay
    const checkConnection = setTimeout(() => {
      if (store) {
        console.log('✅ [TldrawSync-Frontend] Store created, sync should be active');
        // You can add more detailed checks here if needed
      } else {
        console.log('❌ [TldrawSync-Frontend] Store not created, sync may have failed');
      }
    }, 2000);
    
    return () => clearTimeout(checkConnection);
  }, [roomName, computedReadOnly, role, store, room]);

  // Maintain reference to mounted editor
  const [editor, setEditor] = useState<Editor | null>(null);

  const handleMount = useCallback(
    (mountedEditor: Editor) => {
      setEditor(mountedEditor);
      if (onMount) onMount(mountedEditor);
    },
    [onMount]
  );

  // Create memoised overrides & components
  const overrides = useMemo(() => createCollaborationOverrides(), []);
  const MainMenuWithPermissions = (props: any) => (
    <CustomMainMenu {...props} readOnly={computedReadOnly} />
  );

  const components: TLComponents = useMemo(
    () => ({
      Toolbar: (props) => (
        <CustomToolbarWithTranscript
          {...props}
          onTranscriptToggle={onTranscriptToggle}
        />
      ),
      MainMenu: MainMenuWithPermissions,
    }),
    [onTranscriptToggle, computedReadOnly]
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

  // Ready flag
  const isStoreReady = Boolean(store);

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