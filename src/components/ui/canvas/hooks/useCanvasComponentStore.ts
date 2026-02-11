import * as React from 'react';
import { useCallback, useRef, useState, useEffect } from 'react';
import { nanoid } from 'nanoid';
import type { Editor, TLShapeId } from 'tldraw';
import { createShapeId } from 'tldraw';

import { calculateInitialSize } from '@/lib/component-sizing';
import { systemRegistry } from '@/lib/system-registry';

import type { customShape as CustomShape } from '../tldraw-canvas';
import { findTiledPlacement as findTiledPlacementUtil } from '@/components/ui/tldraw/utils/findTiledPlacement';

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
  const placementLedgerRef = useRef(
    new Map<string, { x: number; y: number; w: number; h: number; ts: number }>(),
  );
  const [messageIdToShapeIdMap, setMessageIdToShapeIdMap] = useState<Map<string, TLShapeId>>(
    () => new Map(),
  );
  const [addedMessageIds, setAddedMessageIds] = useState<Set<string>>(() => new Set());
  const messageIdToShapeIdRef = useRef<Map<string, TLShapeId>>(messageIdToShapeIdMap);
  useEffect(() => {
    messageIdToShapeIdRef.current = messageIdToShapeIdMap;
  }, [messageIdToShapeIdMap]);

  const findTiledPlacement = useCallback(
    (size: { w: number; h: number }): { x: number; y: number } => {
      if (!editor) return { x: Math.random() * 500, y: Math.random() * 300 };
      const viewport = editor.getViewportPageBounds?.();
      if (!viewport) return { x: Math.random() * 500, y: Math.random() * 300 };

      const now = Date.now();
      const LEDGER_TTL_MS = 60_000;
      for (const [key, entry] of placementLedgerRef.current.entries()) {
        if (now - entry.ts > LEDGER_TTL_MS) {
          placementLedgerRef.current.delete(key);
        }
      }

      const reservedRects = Array.from(placementLedgerRef.current.values()).map((entry) => ({
        x: entry.x,
        y: entry.y,
        w: entry.w,
        h: entry.h,
      }));

      return findTiledPlacementUtil(editor, size, {
        viewport: viewport as any,
        reservedRects,
      });
    },
    [editor],
  );

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
      const placement = findTiledPlacement(initialSize);
      const x = viewport ? placement.x : Math.random() * 500;
      const y = viewport ? placement.y : Math.random() * 300;
      const newShapeId = createShapeId(`shape-${nanoid()}`);
      placementLedgerRef.current.set(messageId, {
        x,
        y,
        w: initialSize.w,
        h: initialSize.h,
        ts: Date.now(),
      });

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
    [editor, findTiledPlacement, logger, messageIdToShapeIdMap],
  );

  const queuePendingComponent = useCallback((item: PendingCanvasComponent) => {
    pendingComponentsRef.current.push(item);
  }, []);

  const drainPendingComponents = useCallback(
    (
      onMounted?: (messageId: string, name?: string) => void,
      shouldMount?: (messageId: string, name?: string) => boolean,
    ) => {
      if (!editor || pendingComponentsRef.current.length === 0) return;

      const queued = [...pendingComponentsRef.current];
      pendingComponentsRef.current = [];
      queued.forEach(({ messageId, node, name }) => {
        if (shouldMount && !shouldMount(messageId, name)) {
          logger.debug('⏭️  Skipping queued component mount:', name || 'component', { messageId });
          return;
        }
        addComponentToCanvas(messageId, node, name);
        onMounted?.(messageId, name);
        logger.debug('▶️  Rendered queued component:', name || 'component');
      });
    },
    [addComponentToCanvas, editor, logger],
  );

  const removeComponentFromCanvas = useCallback(
    (messageId: string) => {
      const trimmedId = String(messageId || '').trim();
      if (!trimmedId) return { ok: false as const, reason: 'missing_message_id' as const };

      // Always remove the node first so the UI doesn't keep rendering it while we delete the shape.
      componentStore.current.delete(trimmedId);
      emitComponentStoreUpdated();

      setAddedMessageIds((prev) => {
        if (!prev.has(trimmedId)) return prev;
        const next = new Set(prev);
        next.delete(trimmedId);
        return next;
      });

      setMessageIdToShapeIdMap((prev) => {
        if (!prev.has(trimmedId)) return prev;
        const next = new Map(prev);
        next.delete(trimmedId);
        return next;
      });

      if (!editor) {
        logger.warn('Editor not available, cannot remove component on canvas.', { messageId: trimmedId });
        return { ok: false as const, reason: 'no_editor' as const };
      }

      let shapeId = messageIdToShapeIdRef.current.get(trimmedId);
      if (!shapeId) {
        const candidate = (editor.getCurrentPageShapes?.() as any[] | undefined)?.find(
          (shape) => shape?.type === 'custom' && String(shape?.props?.customComponent || '') === trimmedId,
        );
        if (candidate?.id) {
          shapeId = candidate.id as TLShapeId;
        }
      }

      if (shapeId) {
        try {
          editor.deleteShapes?.([shapeId as any]);
        } catch (error) {
          logger.warn('Failed to delete custom component shape', { messageId: trimmedId, shapeId, error });
        }
      }

      try {
        const existingState = systemRegistry.getState(trimmedId);
        systemRegistry.ingestState({
          id: trimmedId,
          kind: 'component_removed',
          payload: {
            componentName: trimmedId,
            shapeId: shapeId || null,
            canvasId: editor.store.id || 'default-canvas',
          },
          version: (existingState?.version || 0) + 1,
          ts: Date.now(),
          origin: 'browser',
        } as any);
      } catch {
        /* noop */
      }

      return { ok: true as const, shapeId: shapeId ?? null };
    },
    [editor, logger],
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
    removeComponentFromCanvas,
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
