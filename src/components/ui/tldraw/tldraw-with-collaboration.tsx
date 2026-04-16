'use client';

import React, { useCallback, useContext, useEffect, useMemo, useRef } from 'react';
import type { ReactNode, RefObject } from 'react';
import { Tldraw, TLComponents, Editor, TldrawUiToastsProvider } from '@tldraw/tldraw';
import { useRoomContext } from '@livekit/components-react';
import type { Room } from 'livekit-client';
import { CanvasLiveKitContext } from '../livekit/livekit-room-connector';
import { ComponentStoreContext } from './tldraw-canvas';
import type { AnyShapeUtilConstructor } from './tldraw-canvas';
import {
  useCanvasEventHandlers,
  useCanvasRoomHost,
  useCollaborationSession,
  useEditorReady,
  useTldrawEditorBridge,
} from './hooks';
import { createCollaborationOverrides } from './utils';
import { CustomMainMenu, CustomToolbarWithTranscript } from './tldraw-with-persistence';
import { CollaborationLoadingOverlay } from './components';
import { CanvasAgentController } from './canvas/canvas-agent-controller';
import { FairyIntegration } from './fairy/fairy-integration';
import { useCanvasRuntimeShapeContext } from './runtime/canvas-runtime-shape-context';
import { useCanvasRuntimeShapeReconciler } from './runtime/use-canvas-runtime-shape-reconciler';
import { subscribeToRuntimeSelection } from './runtime/runtime-selection';
import { getBooleanFlag } from '@/lib/feature-flags';
import { usePresentTheme } from '@/components/ui/system/theme-provider';

interface TldrawWithCollaborationProps {
  onMount?: (editor: Editor) => void;
  shapeUtils?: readonly AnyShapeUtilConstructor[];
  componentStore?: Map<string, ReactNode>;
  className?: string;
  onTranscriptToggle?: () => void;
  onHelpClick?: () => void;
  onComponentToolboxToggle?: () => void;
  readOnly?: boolean;
  onRuntimeSelectionChange?: (selection: { shapeId: string | null; nodeId: string | null }) => void;
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
  onRuntimeSelectionChange,
}: TldrawWithCollaborationProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const livekitCtx = useContext(CanvasLiveKitContext);
  const roomName = livekitCtx?.roomName ?? 'custom-canvas-room';
  const room = useRoomContext();
  const isFairyEnabled = getBooleanFlag(process.env.NEXT_PUBLIC_FAIRY_ENABLED, false);

  const collaboration = useCollaborationSession({ roomName, room, shapeUtils });
  const computedReadOnly = readOnly || collaboration.isReadOnly;

  const overrides = useMemo(() => createCollaborationOverrides({ roomName }), [roomName]);

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

  // Handle keyboard shortcut for transcript (Cmd+K or Ctrl+K)
  useEffect(() => {
    if (!onTranscriptToggle) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && String(event.key).toLowerCase() === 'k') {
        event.preventDefault();
        onTranscriptToggle();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onTranscriptToggle]);

  const showOverlay = collaboration.status !== 'ready';

  return (
    <div
      ref={containerRef}
      className={`${className ?? ''}${isFairyEnabled ? ' tla' : ''}`}
      style={{ position: 'absolute', inset: 0 }}
    >
      <TldrawUiToastsProvider>
        <ComponentStoreContext.Provider value={componentStore || null}>
          <Tldraw
            licenseKey={process.env.NEXT_PUBLIC_TLDRAW_LICENSE_KEY}
            store={collaboration.store}
            shapeUtils={shapeUtils}
            components={components}
            overrides={overrides}
            forceMobile
          >
            <CollaborationEditorEffects
              room={room}
              containerRef={containerRef}
              onMount={onMount}
              onRuntimeSelectionChange={onRuntimeSelectionChange}
            />
          </Tldraw>
        </ComponentStoreContext.Provider>
      </TldrawUiToastsProvider>

      {showOverlay && <CollaborationLoadingOverlay status={collaboration.status} />}
    </div>
  );
}

interface CollaborationEditorEffectsProps {
  room: Room | undefined;
  containerRef: RefObject<HTMLDivElement | null>;
  onMount?: (editor: Editor) => void;
  onRuntimeSelectionChange?: (selection: { shapeId: string | null; nodeId: string | null }) => void;
}

function CollaborationEditorEffects({
  room,
  containerRef,
  onMount,
  onRuntimeSelectionChange,
}: CollaborationEditorEffectsProps) {
  const { editor, ready } = useEditorReady();
  const isFairyEnabled = getBooleanFlag(process.env.NEXT_PUBLIC_FAIRY_ENABLED, false);
  const theme = usePresentTheme();
  const runtimeShapes = useCanvasRuntimeShapeContext();
  const { isHost } = useCanvasRoomHost(room, { allowStandaloneHost: true });

  useTldrawEditorBridge(editor, { onMount });
  useCanvasEventHandlers(editor, room, containerRef, { enabled: ready });
  useCanvasRuntimeShapeReconciler(editor, runtimeShapes?.session, { isHost: Boolean(runtimeShapes) && isHost });

  // Keep TLDraw's internal color scheme aligned with the app theme.
  // Without this, TLDraw can stay in "light" while the app is "dark" (or vice versa),
  // leading to illegible text / mismatched chrome.
  useEffect(() => {
    if (!ready || !editor) return;
    try {
      // TLDraw expects a concrete scheme. If our theme is `system`, resolve it first to avoid
      // mismatched chrome (e.g. app is dark, TLDraw stays light -> illegible text).
      editor.user.updateUserPreferences({ colorScheme: theme.resolved });
    } catch {
      // Best-effort: if TLDraw changes preferences API, avoid crashing the canvas.
    }
  }, [editor, ready, theme.resolved]);

  useEffect(() => {
    if (!ready || !editor) return;
    if (process.env.NODE_ENV !== 'production' && typeof window !== 'undefined') {
      (window as any).__tldrawEditor = editor;
    }
  }, [editor, ready]);

  useEffect(() => {
    if (!ready || !editor || !onRuntimeSelectionChange) return;
    const unsubscribe = subscribeToRuntimeSelection(editor, onRuntimeSelectionChange);

    return () => {
      unsubscribe();
      onRuntimeSelectionChange({ shapeId: null, nodeId: null });
    };
  }, [editor, onRuntimeSelectionChange, ready]);

  useEffect(() => {
    return () => {
      if (process.env.NODE_ENV !== 'production' && typeof window !== 'undefined') {
        delete (window as any).__tldrawEditor;
      }
    };
  }, []);

  if (!ready || !editor) {
    return null;
  }

  return (
    <>
      {/* Always mount the unified server-driven canvas agent bridge. */}
      <CanvasAgentController editor={editor} room={room} />
      {/* Fairy UI is optional and should not disable the server steward path. */}
      {isFairyEnabled && <FairyIntegration room={room} />}
    </>
  );
}

export default React.memo(TldrawWithCollaboration);
