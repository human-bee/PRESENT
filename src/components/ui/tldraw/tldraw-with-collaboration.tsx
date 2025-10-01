'use client';

/*
TODO map:
- [x] Session orchestration moved into `useCollaborationSession`.
- [x] Editor mount + event wiring handled by `useTldrawEditorBridge`.
- [x] Loading state overlay extracted to `CollaborationLoadingOverlay`.
*/

import { ReactNode, useContext, useEffect, useRef } from 'react';
import { Tldraw } from 'tldraw';

import type { Editor } from 'tldraw';

import type { customShapeUtil } from './tldraw-canvas';

import TldrawSnapshotBroadcaster from '@/components/TldrawSnapshotBroadcaster';
import TldrawSnapshotReceiver from '@/components/TldrawSnapshotReceiver';

import { CanvasLiveKitContext } from './livekit/livekit-room-connector';
import { ComponentStoreContext } from './tldraw-canvas';
import { CollaborationLoadingOverlay } from './components/collaboration-loading-overlay';
import { useCollaborationSession } from './hooks/use-collaboration-session';
import { useTldrawEditorBridge } from './hooks/use-tldraw-editor-bridge';

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

const STEWARD_FLOWCHART =
  typeof process !== 'undefined' && process.env.NEXT_PUBLIC_STEWARD_FLOWCHART_ENABLED === 'true';

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

  const { store, overrides, components, resolvedShapeUtils, bus, isStoreReady } = useCollaborationSession({
    shapeUtils,
    roomName,
    onTranscriptToggle,
    onHelpClick,
    onComponentToolboxToggle,
    readOnly,
  });

  const handleMount = useTldrawEditorBridge({
    bus,
    containerRef,
    onMount,
    stewardFlowchartEnabled: STEWARD_FLOWCHART,
  });

  useEffect(() => {
    if (!onTranscriptToggle) return;
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
        event.preventDefault();
        onTranscriptToggle();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onTranscriptToggle]);

  return (
    <div ref={containerRef} className={className} style={{ position: 'absolute', inset: 0 }}>
      <ComponentStoreContext.Provider value={componentStore || null}>
        <Tldraw
          store={store}
          onMount={handleMount}
          shapeUtils={resolvedShapeUtils}
          components={components}
          overrides={overrides}
          forceMobile={true}
        />
        <TldrawSnapshotBroadcaster />
        <TldrawSnapshotReceiver />
      </ComponentStoreContext.Provider>

      <CollaborationLoadingOverlay isVisible={!isStoreReady} />
    </div>
  );
}
