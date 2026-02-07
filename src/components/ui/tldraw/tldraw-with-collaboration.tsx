'use client';

import React, { useCallback, useContext, useEffect, useMemo, useRef } from 'react';
import type { ReactNode, RefObject } from 'react';
import { Tldraw, TLComponents, Editor, TldrawUiToastsProvider } from '@tldraw/tldraw';
import { useRoomContext } from '@livekit/components-react';
import type { Room } from 'livekit-client';
import { CanvasLiveKitContext } from '../livekit/livekit-room-connector';
import { ComponentStoreContext } from './tldraw-canvas';
import type { customShapeUtil } from './tldraw-canvas';
import {
  useCanvasEventHandlers,
  useCollaborationSession,
  useEditorReady,
  usePinnedShapes,
  useTldrawEditorBridge,
} from './hooks';
import { createCollaborationOverrides } from './utils';
import { CustomMainMenu, CustomToolbarWithTranscript } from './tldraw-with-persistence';
import { CollaborationLoadingOverlay } from './components';
import { CanvasAgentController } from './canvas/canvas-agent-controller';
import { FairyIntegration } from './fairy/fairy-integration';

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
  const livekitCtx = useContext(CanvasLiveKitContext);
  const roomName = livekitCtx?.roomName ?? 'custom-canvas-room';
  const room = useRoomContext();
  const isFairyEnabled =
    typeof process !== 'undefined' && process.env.NEXT_PUBLIC_FAIRY_ENABLED === 'true';

  const collaboration = useCollaborationSession({ roomName, room, shapeUtils });
  const computedReadOnly = readOnly || collaboration.isReadOnly;

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

  // Handle keyboard shortcut for transcript (Cmd+K or Ctrl+K)
  useEffect(() => {
    if (!onTranscriptToggle) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
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
}

function CollaborationEditorEffects({
  room,
  containerRef,
  onMount,
}: CollaborationEditorEffectsProps) {
  const { editor, ready } = useEditorReady();
  const isFairyEnabled =
    typeof process !== 'undefined' && process.env.NEXT_PUBLIC_FAIRY_ENABLED === 'true';

  useTldrawEditorBridge(editor, { onMount });
  usePinnedShapes(editor, ready);
  useCanvasEventHandlers(editor, room, containerRef, { enabled: ready });

  useEffect(() => {
    if (!ready || !editor) return;
    if (process.env.NODE_ENV !== 'production' && typeof window !== 'undefined') {
      (window as any).__tldrawEditor = editor;
    }
  }, [editor, ready]);

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

  if (isFairyEnabled) {
    return <FairyIntegration room={room} />;
  }

  return <CanvasAgentController editor={editor} room={room} />;
}

export default React.memo(TldrawWithCollaboration);
