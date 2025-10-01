import * as React from 'react';
import { useCallback, useRef, useState } from 'react';
import { nanoid } from 'nanoid';
import type { Editor, TLShapeId } from 'tldraw';
import { createShapeId } from 'tldraw';

import { calculateInitialSize } from '@/lib/component-sizing';
import { systemRegistry } from '@/lib/system-registry';

import type { customShape as CustomShape } from '../tldraw-canvas';

type CanvasLogger = {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  debug: (...args: unknown[]) => void;
};

export type PendingCanvasComponent = {
  messageId: string;
  node: React.ReactNode;
  name?: string;
};

function emitComponentStoreUpdated() {
  try {
    window.dispatchEvent(new Event('present:component-store-updated'));
  } catch {
    /* ignore */
  }
}

export function useCanvasComponentStore(
  editor: Editor | null,
  logger: CanvasLogger,
) {
  const componentStore = useRef(new Map<string, React.ReactNode>());
  const pendingComponentsRef = useRef<PendingCanvasComponent[]>([]);
  const [messageIdToShapeIdMap, setMessageIdToShapeIdMap] = useState<Map<string, TLShapeId>>(
    () => new Map(),
  );
  const [addedMessageIds, setAddedMessageIds] = useState<Set<string>>(() => new Set());

  const addComponentToCanvas = useCallback(
    (messageId: string, component: React.ReactNode, componentName?: string) => {
      if (!editor) {
        logger.warn('Editor not available, cannot add or update component on canvas.');
        return;
      }

      componentStore.current.set(messageId, component);
      emitComponentStoreUpdated();

      const existingShapeId = messageIdToShapeIdMap.get(messageId);

      if (existingShapeId) {
        editor.updateShapes<CustomShape>([
          {
            id: existingShapeId,
            type: 'custom',
            props: {
              customComponent: messageId,
              name: componentName || `Component ${messageId}`,
            },
          },
        ]);

        const existingState = systemRegistry.getState(messageId);
        systemRegistry.ingestState({
          id: messageId,
          kind: 'component_updated',
          payload: {
            componentName: componentName || `Component ${messageId}`,
            shapeId: existingShapeId,
            canvasId: editor.store.id || 'default-canvas',
          },
          version: (existingState?.version || 0) + 1,
          ts: Date.now(),
          origin: 'browser',
        });
        return;
      }

      const viewport = editor.getViewportPageBounds();
      const initialSize = calculateInitialSize(componentName || 'Default');
      const x = viewport ? viewport.midX - initialSize.w / 2 : Math.random() * 500;
      const y = viewport ? viewport.midY - initialSize.h / 2 : Math.random() * 300;
      const newShapeId = createShapeId(`shape-${nanoid()}`);

      editor.createShapes<CustomShape>([
        {
          id: newShapeId,
          type: 'custom',
          x,
          y,
          props: {
            customComponent: messageId,
            name: componentName || `Component ${messageId}`,
            w: initialSize.w,
            h: initialSize.h,
          },
        },
      ]);

      setMessageIdToShapeIdMap((prev) => {
        const next = new Map(prev);
        next.set(messageId, newShapeId);
        return next;
      });

      setAddedMessageIds((prev) => {
        const next = new Set(prev);
        next.add(messageId);
        return next;
      });

      systemRegistry.ingestState({
        id: messageId,
        kind: 'component_created',
        payload: {
          componentName: componentName || `Component ${messageId}`,
          shapeId: newShapeId,
          canvasId: editor.store.id || 'default-canvas',
          position: { x, y },
          size: { w: initialSize.w, h: initialSize.h },
        },
        version: 1,
        ts: Date.now(),
        origin: 'browser',
      });
    },
    [editor, logger, messageIdToShapeIdMap],
  );

  const queuePendingComponent = useCallback((item: PendingCanvasComponent) => {
    pendingComponentsRef.current.push(item);
  }, []);

  const drainPendingComponents = useCallback(
    (onMounted?: (messageId: string, name?: string) => void) => {
      if (!editor || pendingComponentsRef.current.length === 0) return;

      const queued = [...pendingComponentsRef.current];
      pendingComponentsRef.current = [];
      queued.forEach(({ messageId, node, name }) => {
        addComponentToCanvas(messageId, node, name);
        onMounted?.(messageId, name);
        logger.debug('▶️  Rendered queued component:', name || 'component');
      });
    },
    [addComponentToCanvas, editor, logger],
  );

  return {
    componentStore,
    pendingComponentsRef,
    messageIdToShapeIdMap,
    setMessageIdToShapeIdMap,
    addedMessageIds,
    setAddedMessageIds,
    addComponentToCanvas,
    queuePendingComponent,
    drainPendingComponents,
  };
}


