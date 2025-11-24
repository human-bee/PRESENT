import * as React from 'react';
import { useCallback, useRef, useState, useEffect } from 'react';
import { nanoid } from 'nanoid';
import type { Editor, TLShapeId } from 'tldraw';
import { createShapeId } from 'tldraw';

import { calculateInitialSize } from '@/lib/component-sizing';
import { systemRegistry } from '@/lib/system-registry';

import type { customShape as CustomShape } from '../tldraw-canvas';

export type CanvasLogger = {
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
        const existingShape = editor.getShape<CustomShape>(existingShapeId);
        const prevProps = existingShape?.props;

        editor.updateShapes<CustomShape>([
          {
            id: existingShapeId,
            type: 'custom',
            props: {
              ...(prevProps ?? {}),
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
        try {
          window.dispatchEvent(
            new CustomEvent('present:component-registered', {
              detail: {
                messageId,
                componentName: componentName || `Component ${messageId}`,
                status: 'updated',
              },
            }),
          );
        } catch {
          /* noop */
        }
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
      try {
        window.dispatchEvent(
          new CustomEvent('present:component-registered', {
            detail: {
              messageId,
              componentName: componentName || `Component ${messageId}`,
              status: 'created',
            },
          }),
        );
      } catch {
        /* noop */
      }
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

  useMergeComponentStateBridge(editor, logger, messageIdToShapeIdMap, setMessageIdToShapeIdMap);

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

type MergeComponentStateDetail = {
  messageId: string;
  patch: Record<string, unknown>;
  meta?: Record<string, unknown>;
};

const MERGE_EVENT_NAME = 'tldraw:merge_component_state';

function mergeComponentState(
  editor: Editor | null,
  messageId: string,
  patch: Record<string, unknown>,
  shapeId: TLShapeId,
) {
  if (!editor) return;
  const shape = editor.getShape?.(shapeId) as any;
  if (!shape || !shape.props) return;

  const prevState = (shape.props.state as Record<string, unknown>) || {};
  const nextState = { ...prevState, ...patch };

  const nextProps = {
    ...shape.props,
    state: nextState,
  };

  editor.updateShapes?.([
    {
      id: shapeId,
      type: shape.type ?? 'custom',
      props: nextProps,
    } as any,
  ]);
}

export function useMergeComponentStateBridge(
  editor: Editor | null,
  logger: CanvasLogger,
  messageIdToShapeIdMap: Map<string, TLShapeId>,
  setMessageIdToShapeIdMap: React.Dispatch<React.SetStateAction<Map<string, TLShapeId>>>,
) {
  const pendingPatchesRef = useRef(new Map<string, Record<string, unknown>>());

  useEffect(() => {
    if (!editor) return;

    const handler = (event: Event) => {
      const custom = event as CustomEvent<MergeComponentStateDetail>;
      if (!custom?.detail) return;
      const { messageId, patch } = custom.detail;
      if (!messageId || !patch || typeof patch !== 'object') return;

      let shapeId = messageIdToShapeIdMap.get(messageId);

      if (!shapeId) {
        const candidate = (editor.getCurrentPageShapes?.() as any[] | undefined)?.find(
          (shape) => shape?.type === 'custom' && shape?.props?.customComponent === messageId,
        );
        if (candidate?.id) {
          shapeId = candidate.id as TLShapeId;
          setMessageIdToShapeIdMap((prev) => {
            if (prev.get(messageId) === shapeId) return prev;
            const next = new Map(prev);
            next.set(messageId, shapeId);
            return next;
          });
        }
      }

      if (!shapeId) {
        logger.warn('merge_component_state: shape not found for messageId', messageId);
        const queued = pendingPatchesRef.current.get(messageId) || {};
        pendingPatchesRef.current.set(messageId, {
          ...queued,
          ...(patch as Record<string, unknown>),
        });
        return;
      }

      const queued = pendingPatchesRef.current.get(messageId);
      if (queued) {
        pendingPatchesRef.current.delete(messageId);
        try {
          mergeComponentState(editor, messageId, queued, shapeId);
        } catch (error) {
          logger.warn('merge_component_state flush pending failed', { messageId, error });
        }
      }
      try {
        mergeComponentState(editor, messageId, patch, shapeId);
      } catch (error) {
        logger.warn('merge_component_state failed', { messageId, error });
      }
    };

    window.addEventListener(MERGE_EVENT_NAME, handler as EventListener);
    return () => {
      window.removeEventListener(MERGE_EVENT_NAME, handler as EventListener);
    };
  }, [editor, logger, messageIdToShapeIdMap, setMessageIdToShapeIdMap]);

  useEffect(() => {
    if (!editor) return;

    const handleRegistered = (event: Event) => {
      const detail = (event as CustomEvent<{ messageId?: string }>).detail;
      const messageId = detail?.messageId;
      if (!messageId) return;

      const pending = pendingPatchesRef.current.get(messageId);
      if (!pending) return;

      let shapeId = messageIdToShapeIdMap.get(messageId);
      if (!shapeId) {
        const candidate = (editor.getCurrentPageShapes?.() as any[] | undefined)?.find(
          (shape) => shape?.type === 'custom' && shape?.props?.customComponent === messageId,
        );
        if (candidate?.id) {
          shapeId = candidate.id as TLShapeId;
          setMessageIdToShapeIdMap((prev) => {
            if (prev.get(messageId) === shapeId) return prev;
            const next = new Map(prev);
            next.set(messageId, shapeId);
            return next;
          });
        }
      }

      if (!shapeId) return;

      pendingPatchesRef.current.delete(messageId);
      try {
        mergeComponentState(editor, messageId, pending, shapeId);
      } catch (error) {
        logger.warn('merge_component_state pending flush failed', { messageId, error });
      }
    };

    window.addEventListener('present:component-registered', handleRegistered as EventListener);
    return () => {
      window.removeEventListener('present:component-registered', handleRegistered as EventListener);
    };
  }, [editor, logger, messageIdToShapeIdMap, setMessageIdToShapeIdMap]);
}
