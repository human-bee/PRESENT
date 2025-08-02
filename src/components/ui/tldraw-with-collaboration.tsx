"use client";

/* eslint-disable @typescript-eslint/no-explicit-any */

import {
  Tldraw,
  TLUiOverrides,
  TLComponents,
  Editor,
  TldrawUiMenuItem,
  useEditor,
} from "tldraw";
import {
  CustomMainMenu,
  CustomToolbarWithTranscript,
} from "./tldraw-with-persistence";
import { ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useSyncDemo } from "@tldraw/sync";
import { CanvasLiveKitContext } from "./livekit-room-connector";
import { ComponentStoreContext } from "./tldraw-canvas";
import type { TamboShapeUtil, TamboShape } from "./tldraw-canvas";
import { useRoomContext } from "@livekit/components-react";
import { RoomEvent } from "livekit-client";

interface TldrawWithCollaborationProps {
  onMount?: (editor: Editor) => void;
  shapeUtils?: readonly (typeof TamboShapeUtil)[];
  componentStore?: Map<string, ReactNode>;
  className?: string;
  onTranscriptToggle?: () => void;
  onHelpClick?: () => void;
  onComponentToolboxToggle?: () => void;
  readOnly?: boolean;
}

const createCollaborationOverrides = (): TLUiOverrides => {
  return {
    actions: (editor, actions) => {
      const pinAction = {
        id: 'pin-shape-to-viewport',
        label: 'Pin to Window',
        icon: 'external-link',
        kbd: 'shift+p',
        onSelect: () => {
          const selectedShapes = editor.getSelectedShapes();
          
          if (selectedShapes.length === 1 && selectedShapes[0].type === 'tambo') {
            const shape = selectedShapes[0] as TamboShape;
            const isPinned = shape.props.pinned ?? false;
            
            if (!isPinned) {
              const viewport = editor.getViewportScreenBounds();
              const bounds = editor.getShapePageBounds(shape.id);
              if (bounds) {
                const screenPoint = editor.pageToScreen({ x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h / 2 });
                const pinnedX = screenPoint.x / viewport.width;
                const pinnedY = screenPoint.y / viewport.height;
                
                editor.updateShapes([{
                  id: shape.id,
                  type: 'tambo',
                  props: {
                    pinned: true,
                    pinnedX: Math.max(0, Math.min(1, pinnedX)),
                    pinnedY: Math.max(0, Math.min(1, pinnedY)),
                  }
                }]);
              }
            } else {
              editor.updateShapes([{
                id: shape.id,
                type: 'tambo',
                props: { pinned: false }
              }]);
            }
          }
        },
        readonlyOk: false,
      };
      
      return {
        ...actions,
        'pin-shape-to-viewport': pinAction
      };
    },
    
    menu: (editor, menu, { source }) => {
      if (source === 'main-menu') {
        menu.push({
          id: 'pin-action-group',
          type: 'group',
          label: 'Pin Actions',
          children: [
            {
              id: 'pin-shape-to-viewport',
              type: 'item',
              label: 'Pin Selected Shape to Window',
              onSelect: () => {
                editor.runAction('pin-shape-to-viewport');
              }
            }
          ]
        });
      }
      
      return menu;
    }
  };
};

export function TldrawWithCollaboration({
  onMount,
  shapeUtils,
  componentStore,
  className,
  onTranscriptToggle,
  onHelpClick,
  onComponentToolboxToggle,
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



  // Create memoised overrides & components
  const overrides = useMemo(() => createCollaborationOverrides(), []);
  const MainMenuWithPermissions = useCallback(
     
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
          onHelpClick={onHelpClick}
          onComponentToolboxToggle={onComponentToolboxToggle}
        />
      ),
      MainMenu: MainMenuWithPermissions as any,
    }),
    [onTranscriptToggle, onHelpClick, onComponentToolboxToggle, MainMenuWithPermissions]
  );

  const handleMount = useCallback(
    (mountedEditor: Editor) => {
      // Set up global pin management using side effects
      let isUpdatingPinnedShapes = false;

      const updateAllPinnedShapes = () => {
        if (isUpdatingPinnedShapes) return;

        try {
          isUpdatingPinnedShapes = true;
          
          const allShapes = mountedEditor.getCurrentPageShapes();
          const pinnedShapes = allShapes.filter(
            (shape): shape is TamboShape => 
              shape.type === 'tambo' && (shape as TamboShape).props.pinned === true
          );

          if (pinnedShapes.length === 0) return;

          const viewport = mountedEditor.getViewportScreenBounds();
          const updates = [];

          for (const shape of pinnedShapes) {
            const pinnedX = shape.props.pinnedX ?? 0.5;
            const pinnedY = shape.props.pinnedY ?? 0.5;

            // Calculate screen position from pinned viewport coordinates
            const screenX = viewport.width * pinnedX;
            const screenY = viewport.height * pinnedY;

            // Convert to page coordinates
            const pagePoint = mountedEditor.screenToPage({ x: screenX, y: screenY });

            // Update shape position
            updates.push({
              id: shape.id,
              type: 'tambo' as const,
              x: pagePoint.x - shape.props.w / 2,
              y: pagePoint.y - shape.props.h / 2,
            });
          }

          if (updates.length > 0) {
            mountedEditor.updateShapes(updates);
          }
        } finally {
          isUpdatingPinnedShapes = false;
        }
      };

      // Register camera change handler for pinned shapes
      const cameraCleanup = mountedEditor.sideEffects.registerAfterChangeHandler('camera', updateAllPinnedShapes);

      // Also handle viewport resize
      const handleResize = () => {
        updateAllPinnedShapes();
      };

      window.addEventListener('resize', handleResize);

      // Initial update
      setTimeout(updateAllPinnedShapes, 100);

      // Store cleanup function
      const cleanup = () => {
        cameraCleanup();
        window.removeEventListener('resize', handleResize);
      };

      // Store cleanup in editor for later use
      (mountedEditor as any)._pinnedShapesCleanup = cleanup;

      if (onMount) onMount(mountedEditor);
    },
    [onMount, overrides, shapeUtils, store]
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