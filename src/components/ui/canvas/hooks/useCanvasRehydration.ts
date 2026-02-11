import { useEffect, useRef } from 'react';
import type { Editor } from 'tldraw';
import React from 'react';

import { components } from '@/lib/custom';
import { ComponentRegistry } from '@/lib/component-registry';

import type { customShape as CustomShape } from '../tldraw-canvas';
import type { CanvasLogger } from './useCanvasComponentStore';
import type { MutableRefObject } from 'react';

interface RehydrationParams {
  editor: Editor | null;
  componentStore: MutableRefObject<Map<string, React.ReactNode>>;
  setMessageIdToShapeIdMap: (updater: (prev: Map<string, string>) => Map<string, string>) => void;
  setAddedMessageIds: (updater: (prev: Set<string>) => Set<string>) => void;
  logger: CanvasLogger;
  isMessageRemoved?: (messageId: string) => boolean;
}

export function useCanvasRehydration({
  editor,
  componentStore,
  setMessageIdToShapeIdMap,
  setAddedMessageIds,
  logger,
  isMessageRemoved,
}: RehydrationParams) {
  const LOG_REHYDRATE = process.env.NEXT_PUBLIC_LOG_CANVAS_REHYDRATE === 'true';
  const debug = (...args: any[]) => {
    if (LOG_REHYDRATE) logger.debug(...args);
  };
  const lastSignatureRef = useRef<string>('');
  const lastRunAtRef = useRef<number>(0);
  const hasHydratedOnceRef = useRef(false);
  useEffect(() => {
    const handleRehydration = (event?: Event) => {
      if (!editor) {
        debug('Editor not ready for rehydration, skipping...');
        return;
      }

      if (!logger) {
        return;
      }
      const forceHydrate = Boolean((event as CustomEvent<{ force?: boolean }>)?.detail?.force);
      const customShapes = editor
        .getCurrentPageShapes()
        .filter((shape) => shape.type === 'custom') as CustomShape[];

      const shapeSignature = customShapes
        .map((shape) => {
          const props = shape.props as Record<string, unknown>;
          const componentId =
            typeof props?.customComponent === 'string' ? (props.customComponent as string) : 'unknown';
          const shapeUpdatedAt = typeof props?.updatedAt === 'number' ? (props.updatedAt as number) : 0;
          const state = props?.state && typeof props.state === 'object' ? (props.state as { updatedAt?: number }) : null;
          const stateUpdatedAt = state && typeof state.updatedAt === 'number' ? state.updatedAt : 0;
          return `${shape.id}:${componentId}:${shapeUpdatedAt}:${stateUpdatedAt}`;
        })
        .sort()
        .join('|');

      const registrySignature = ComponentRegistry.list()
        .map((entry) => `${entry.messageId}:${entry.version ?? 'null'}:${entry.lastUpdated ?? 'null'}`)
        .sort()
        .join('|');

      const signature = `${shapeSignature}::${registrySignature}`;
      const now = Date.now();
      const shouldSkipRehydration =
        !forceHydrate &&
        hasHydratedOnceRef.current &&
        signature === lastSignatureRef.current &&
        now - lastRunAtRef.current < 2_000;
      if (shouldSkipRehydration) {
        debug('♻️ Skipping rehydration (no component deltas detected)');
        return;
      }
      lastSignatureRef.current = signature;
      lastRunAtRef.current = now;
      hasHydratedOnceRef.current = true;

      debug('🔄 Starting component rehydration...');

      debug(`Found ${customShapes.length} custom shapes to rehydrate`);

      customShapes.forEach((shape) => {
        const messageId = shape.props.customComponent;
        if (isMessageRemoved?.(messageId)) {
          debug(`⛔ Skipping rehydration for removed component (${messageId})`);
          try {
            editor.deleteShapes?.([shape.id as any]);
          } catch {
            /* noop */
          }
          return;
        }

        const registryEntry = ComponentRegistry.get(messageId);
        let componentName = registryEntry?.componentType || shape.props.name;

        debug(`Rehydrating ${componentName} (${messageId})`);

        if (componentName === 'LivekitRoomConnector') {
          logger.debug('⏭️  Skipping rehydration of LivekitRoomConnector (moved to Transcript sidebar)');
          return;
        }

        let componentDef = components.find((c) => c.name === componentName);
        if (!componentDef) {
          if (componentName === 'AI Response') {
            componentDef = components.find((c) => c.name === 'AIResponse');
            if (componentDef) componentName = 'AIResponse';
          }
          if (!componentDef && componentName === 'Rendered Component') {
            componentDef = components.find((c) => c.name === 'AIResponse');
            if (componentDef) componentName = 'AIResponse';
          }
          if (!componentDef && componentName === 'MessageProvider') {
            componentDef = components.find((c) => c.name === 'AIResponse');
            if (componentDef) componentName = 'AIResponse';
          }
        }

        if (componentDef) {
          const Component = componentDef.component;
          const registryProps =
            (registryEntry?.props && typeof registryEntry.props === 'object'
              ? { ...(registryEntry.props as Record<string, unknown>) }
              : undefined) ??
            undefined;

          const normalizedProps: Record<string, unknown> = { ...(registryProps ?? {}) };
          const shapeState =
            shape.props && typeof (shape.props as any).state === 'object'
              ? { ...((shape.props as any).state as Record<string, unknown>) }
              : undefined;

          normalizedProps.type = (registryProps?.type as string) || componentName;
          normalizedProps.__custom_message_id =
            typeof normalizedProps.__custom_message_id === 'string'
              ? normalizedProps.__custom_message_id
              : messageId;
          normalizedProps.componentId =
            typeof normalizedProps.componentId === 'string' && normalizedProps.componentId.length
              ? normalizedProps.componentId
              : messageId;
          if (shapeState) {
            const existingState =
              normalizedProps.state &&
              typeof normalizedProps.state === 'object' &&
              !Array.isArray(normalizedProps.state)
                ? (normalizedProps.state as Record<string, unknown>)
                : {};
            normalizedProps.state = {
              ...existingState,
              ...shapeState,
            };

            const reservedKeys = new Set(['state']);
            for (const [key, value] of Object.entries(shapeState)) {
              if (reservedKeys.has(key)) {
                continue;
              }
              if (normalizedProps[key] === undefined) {
                normalizedProps[key] = value;
              }
            }
          }

          const componentInstance = React.createElement(Component, normalizedProps);
          componentStore.current.set(messageId, componentInstance);
          try {
            window.dispatchEvent(new Event('present:component-store-updated'));
          } catch {
            /* noop */
          }

          setMessageIdToShapeIdMap((prev) => new Map(prev).set(messageId, shape.id));
          setAddedMessageIds((prev) => new Set(prev).add(messageId));

          debug(`✅ Rehydrated ${componentName} successfully`);
        } else {
          logger.warn(`❌ Component definition not found for: ${componentName}`);

          const fallbackInstance = React.createElement(
            'div',
            {
              style: {
                padding: '16px',
                border: '2px dashed #ff6b6b',
                borderRadius: '8px',
                backgroundColor: '#fff5f5',
                color: '#c92a2a',
              },
            },
            React.createElement(
              'h3',
              {
                style: {
                  margin: '0 0 8px 0',
                  fontSize: '14px',
                  fontWeight: 'bold',
                },
              },
              `📦 Component Not Registered: ${componentName}`,
            ),
            React.createElement(
              'p',
              { style: { margin: '0 0 8px 0', fontSize: '12px' } },
              'ID: ',
              React.createElement('code', null, messageId),
            ),
            React.createElement(
              'p',
              { style: { margin: '0', fontSize: '11px', opacity: 0.8 } },
              `Please add "${componentName}" to custom.ts registry.`,
            ),
          );
          componentStore.current.set(messageId, fallbackInstance);
          try {
            window.dispatchEvent(new Event('present:component-store-updated'));
          } catch {
            /* noop */
          }

          setMessageIdToShapeIdMap((prev) => new Map(prev).set(messageId, shape.id));
          setAddedMessageIds((prev) => new Set(prev).add(messageId));

          debug(`⚠️ Created fallback for ${componentName}`);
        }
      });

      debug(
        `🎯 Rehydration complete! ComponentStore now has ${componentStore.current.size} components`,
      );
    };

    window.addEventListener('custom:rehydrateComponents', handleRehydration as EventListener);

    return () => {
      window.removeEventListener('custom:rehydrateComponents', handleRehydration as EventListener);
    };
  }, [editor, componentStore, logger, setAddedMessageIds, setMessageIdToShapeIdMap, isMessageRemoved]);
}
