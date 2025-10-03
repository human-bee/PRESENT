'use client';

import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode, RefObject } from 'react';
import { Tldraw, TLComponents, Editor } from 'tldraw';
import { useRoomContext } from '@livekit/components-react';
import type { Room } from 'livekit-client';
import TldrawSnapshotBroadcaster from '@/components/TldrawSnapshotBroadcaster';
import TldrawSnapshotReceiver from '@/components/TldrawSnapshotReceiver';
import { CanvasLiveKitContext } from './livekit/livekit-room-connector';
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
  const [editorInstance, setEditorInstance] = useState<Editor | null>(null);

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

  const handleEditorReady = useCallback((editor: Editor) => {
    setEditorInstance(editor);
  }, []);

  const showOverlay = collaboration.status !== 'ready';

  return (
    <div ref={containerRef} className={className} style={{ position: 'absolute', inset: 0 }}>
      <ComponentStoreContext.Provider value={componentStore || null}>
        <Tldraw
          store={collaboration.store}
          shapeUtils={shapeUtils}
          components={components}
          overrides={overrides}
          forceMobile
        >
          <CollaborationEditorEffects
            room={room}
            containerRef={containerRef}
            onEditorReady={handleEditorReady}
            onMount={onMount}
          />
        </Tldraw>
        <TldrawSnapshotBroadcaster editor={editorInstance} />
        <TldrawSnapshotReceiver editor={editorInstance} />
      </ComponentStoreContext.Provider>

      {showOverlay && <CollaborationLoadingOverlay status={collaboration.status} />}
    </div>
  );
}

interface CollaborationEditorEffectsProps {
  room: Room | undefined;
  containerRef: RefObject<HTMLDivElement>;
  onEditorReady?: (editor: Editor) => void;
  onMount?: (editor: Editor) => void;
}

function CollaborationEditorEffects({
  room,
  containerRef,
  onEditorReady,
  onMount,
}: CollaborationEditorEffectsProps) {
  const { editor, ready } = useEditorReady();

  useTldrawEditorBridge(editor, { onMount });
  usePinnedShapes(editor, ready);
  useCanvasEventHandlers(editor, room, containerRef, { enabled: ready });

  useEffect(() => {
    if (!ready || !editor) return;
    onEditorReady?.(editor);
  }, [editor, ready, onEditorReady]);

  return null;
}

export default TldrawWithCollaboration;
