import { useCallback } from 'react';
import type { Editor } from 'tldraw';
import type { RefObject } from 'react';

import { registerPinnedShapeManagement } from '../utils/pinned-shapes';
import { registerMermaidBridge } from '../utils/mermaid-bridge';
import { registerCanvasNavigationHandlers } from '../utils/canvas-navigation-handlers';
import { registerCanvasNoteHandlers } from '../utils/canvas-note-handlers';
import { registerCanvasArrangementHandlers } from '../utils/canvas-arrangement-handlers';
import { registerCanvasShapeCreationHandlers } from '../utils/canvas-shape-creation-handlers';
import { registerCanvasListShapesHandler } from '../utils/canvas-list-shapes-handler';
import { registerCanvasSelectionHandlers } from '../utils/canvas-selection-handlers';
import { registerUiStateHandlers } from '../utils/ui-state-handlers';
import type { LiveKitBus } from '../utils/types';

interface UseTldrawEditorBridgeProps {
  bus: LiveKitBus;
  containerRef: RefObject<HTMLDivElement>;
  onMount?: (editor: Editor) => void;
  stewardFlowchartEnabled: boolean;
}

export function useTldrawEditorBridge({
  bus,
  containerRef,
  onMount,
  stewardFlowchartEnabled,
}: UseTldrawEditorBridgeProps) {
  return useCallback(
    (editor: Editor) => {
      const cleanups: Array<() => void> = [];
      const registerCleanup = (cleanup: () => void) => {
        cleanups.push(cleanup);
      };

      if (typeof window !== 'undefined') {
        (window as any).__present = (window as any).__present || {};
        (window as any).__present.tldrawEditor = editor;
        try {
          window.dispatchEvent(new CustomEvent('present:editor-mounted', { detail: { editor } }));
        } catch {}
      }

      registerCleanup(registerPinnedShapeManagement(editor));
      registerCleanup(registerMermaidBridge({ editor, bus, stewardFlowchartEnabled }));
      registerCleanup(registerCanvasNavigationHandlers(editor));
      registerCleanup(registerCanvasNoteHandlers(editor, bus));
      registerCleanup(registerCanvasArrangementHandlers(editor));
      registerCleanup(registerCanvasShapeCreationHandlers(editor, bus));
      registerCleanup(registerCanvasListShapesHandler(editor, bus));
      registerCleanup(registerCanvasSelectionHandlers(editor));
      registerCleanup(registerUiStateHandlers(containerRef));

      const runCleanup = () => {
        for (const cleanup of cleanups) {
          try {
            cleanup();
          } catch {}
        }
      };

      (editor as any)._pinnedShapesCleanup = runCleanup;

      if (onMount) onMount(editor);

      if (typeof window !== 'undefined') {
        try {
          setTimeout(() => {
            window.dispatchEvent(new CustomEvent('custom:rehydrateComponents', { detail: {} }));
          }, 250);
        } catch {}
      }
    },
    [bus, containerRef, onMount, stewardFlowchartEnabled],
  );
}
