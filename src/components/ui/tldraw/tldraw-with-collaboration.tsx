'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */

import { Tldraw, TLComponents, Editor } from 'tldraw';
import { CustomMainMenu, CustomToolbarWithTranscript } from './tldraw-with-persistence';
import { ReactNode, useCallback, useContext, useEffect, useMemo, useRef, type RefObject } from 'react';
import { CanvasLiveKitContext } from './livekit/livekit-room-connector';
import { ComponentStoreContext } from './tldraw-canvas';
import type { customShapeUtil } from './tldraw-canvas';
import { useRoomContext } from '@livekit/components-react';
import type { Room } from 'livekit-client';
import TldrawSnapshotBroadcaster from '@/components/TldrawSnapshotBroadcaster';
import TldrawSnapshotReceiver from '@/components/TldrawSnapshotReceiver';

// Extracted hooks
import { useCollaborationRole } from './hooks/useCollaborationRole';
import { useTLDrawSync } from './hooks/useTLDrawSync';
import { usePinnedShapes } from './hooks/usePinnedShapes';
import { useCanvasEventHandlers } from './hooks/useCanvasEventHandlers';
import { useEditorReady } from './hooks/useEditorReady';
import { createCollaborationOverrides } from './utils/collaborationOverrides';

interface TldrawWithCollaborationProps {
  onMount?: (editor: Editor) => void;
  shapeUtils?: readonly (typeof customShapeUtil)[];
  componentStore?: Map<string, ReactNode>;
  className?: string;
  onTranscriptToggle?: () => void;
  onHelpClick?: () => void;
  onComponentToolboxToggle?: () => void;
  readOnly?: boolean;
}

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
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<Editor | undefined>(undefined);
  const livekitCtx = useContext(CanvasLiveKitContext);
  const roomName = livekitCtx?.roomName ?? 'custom-canvas-room';

  // Get room from LiveKit context
  const room = useRoomContext();

  // Use extracted hooks
  const role = useCollaborationRole(room);
  const store = useTLDrawSync(roomName, shapeUtils);

  const computedReadOnly = readOnly || role === 'viewer' || role === 'readOnly';

  // Create memoized overrides & components
  const overrides = useMemo(() => createCollaborationOverrides(), []);

  const MainMenuWithPermissions = useCallback(
    (props: Record<string, unknown>) => (
      <CustomMainMenu {...(props as any)} readOnly={computedReadOnly} />
    ),
    [computedReadOnly],
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
    [onTranscriptToggle, onHelpClick, onComponentToolboxToggle, MainMenuWithPermissions],
  );

  // Mount handler that integrates all extracted logic
  const handleMount = useCallback(
    (mountedEditor: Editor) => {
      // Store editor reference
      editorRef.current = mountedEditor;

      // Expose editor globally
      if (typeof window !== 'undefined') {
        (window as any).__present = (window as any).__present || {};
        (window as any).__present.tldrawEditor = mountedEditor;
        try {
          window.dispatchEvent(
            new CustomEvent('present:editor-mounted', { detail: { editor: mountedEditor } }),
          );
        } catch {}
      }

      // Call user's onMount if provided
      if (onMount) onMount(mountedEditor);

      // Trigger component rehydration
      try {
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent('custom:rehydrateComponents', { detail: {} }));
        }, 250);
      } catch {}
    },
    [onMount],
  );

  // Keyboard shortcut for transcript
  useEffect(() => {
    if (!onTranscriptToggle) return;
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        onTranscriptToggle();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onTranscriptToggle]);

  const isStoreReady = store.status !== 'loading';

  return (
    <div ref={containerRef} className={className} style={{ position: 'absolute', inset: 0 }}>
      <ComponentStoreContext.Provider value={componentStore || null}>
        <Tldraw
          store={store}
          onMount={handleMount}
          shapeUtils={shapeUtils}
          components={components}
          overrides={overrides}
          forceMobile={true}
        >
          <CollaborationEditorEffects room={room} containerRef={containerRef} />
        </Tldraw>
        <TldrawSnapshotBroadcaster />
        <TldrawSnapshotReceiver />
      </ComponentStoreContext.Provider>

      {!isStoreReady && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-50 z-10 pointer-events-none select-none">
          <div className="text-gray-500">
            Connecting to board… If this hangs, we'll fall back to live snapshots.
          </div>
        </div>
      )}
    </div>
  );
}

function CollaborationEditorEffects({
  room,
  containerRef,
}: {
  room: Room | undefined;
  containerRef: RefObject<HTMLDivElement | null>;
}) {
  const { editor, ready } = useEditorReady();
  const setupPinnedShapes = usePinnedShapes();

  useCanvasEventHandlers(editor, room, containerRef, { enabled: ready });

  useEffect(() => {
    if (!ready || !editor) return;
    const cleanup = setupPinnedShapes();
    return () => {
      cleanup();
    };
  }, [ready, editor, setupPinnedShapes]);

  return null;
}
