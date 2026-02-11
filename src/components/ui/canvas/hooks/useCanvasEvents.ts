import { useEffect } from 'react';
import React from 'react';

import { components } from '@/lib/custom';
import { logJourneyEvent } from '@/lib/journey-logger';

import type { CanvasLogger } from './useCanvasComponentStore';
import type { Editor } from 'tldraw';

interface CanvasEventsParams {
  editor: Editor | null;
  addComponentToCanvas: (
    messageId: string,
    component: React.ReactNode,
    componentName?: string,
  ) => void;
  queuePendingComponent: (item: { messageId: string; node: React.ReactNode; name?: string }) => void;
  drainPendingComponents: (
    onMounted: (messageId: string, name?: string) => void,
    shouldMount?: (messageId: string, name?: string) => boolean,
  ) => void;
  bus: { send: (...args: any[]) => void };
  logger: CanvasLogger;
  isMessageRemoved?: (messageId: string) => boolean;
  clearRemovedMessageId?: (messageId: string) => void;
}

export function useCanvasEvents({
  editor,
  addComponentToCanvas,
  queuePendingComponent,
  drainPendingComponents,
  bus,
  logger,
  isMessageRemoved,
  clearRemovedMessageId,
}: CanvasEventsParams) {
  const lastPayloadSignatureRef = React.useRef(new Map<string, string>());

  useEffect(() => {
    const handleShowComponent = (
      event: CustomEvent<{
        messageId: string;
        component: React.ReactNode | { type: string; props?: Record<string, unknown> };
        lifecycleAction?: string;
      }>,
    ) => {
      try {
        let node: React.ReactNode = event.detail.component as React.ReactNode;
        if (process.env.NODE_ENV !== 'production') {
          try {
            logger.debug('🎬 custom:showComponent received', {
              messageId: event.detail.messageId,
              hasEditor: Boolean(editor),
              inferredType:
                (React.isValidElement(node) && (node.type as any)?.name) ||
                (typeof (event.detail.component as any)?.type === 'string'
                  ? (event.detail.component as any).type
                  : undefined),
            });
          } catch {
            /* noop */
          }
        }
        const messageId = event.detail.messageId;
        if (!messageId) return;
        const lifecycleAction =
          typeof event.detail?.lifecycleAction === 'string'
            ? event.detail.lifecycleAction.trim().toLowerCase()
            : '';
        const isCreateAction = lifecycleAction === 'create' || lifecycleAction === 'recreate';
        if (isMessageRemoved?.(messageId)) {
          if (isCreateAction) {
            clearRemovedMessageId?.(messageId);
          } else {
            logger.debug('⛔ Skipping showComponent for removed messageId', {
              messageId,
              lifecycleAction: lifecycleAction || 'unspecified',
            });
            return;
          }
        }

        if (!React.isValidElement(node) && node && typeof node === 'object') {
          let signature: string | null = null;
          try {
            signature = JSON.stringify(node);
          } catch {
            signature = null;
          }
          if (signature) {
            const previous = lastPayloadSignatureRef.current.get(messageId);
            if (previous === signature) {
              logger.debug('⏭️  Skipping duplicate showComponent payload', { messageId });
              return;
            }
            lastPayloadSignatureRef.current.set(messageId, signature);
          }
        }
        let inferredName: string | undefined = 'Rendered Component';
        if (!editor) {
          if (!React.isValidElement(node)) {
            const maybe = event.detail.component as {
              type?: string;
              props?: Record<string, unknown>;
            };
            if (maybe && typeof maybe === 'object' && typeof maybe.type === 'string') {
              const compDef = components.find((c) => c.name === maybe.type);
              if (compDef) {
                node = React.createElement(compDef.component as any, {
                  __custom_message_id: event.detail.messageId,
                  ...(maybe.props || {}),
                });
                inferredName = compDef.name;
              }
            }
          } else if (React.isValidElement(node)) {
            const type: any = node.type as any;
            const typeName = (type?.displayName || type?.name || '').toString();
            if (typeName === 'customMessageProvider' || typeName.endsWith('Provider')) {
              const child = (node.props as any)?.children;
              if (React.isValidElement(child)) {
                node = child;
              }
            }
            const compDefByRef = components.find(
              (c) => (c.component as any) === (node as any).type,
            );
            if (compDefByRef) {
              inferredName = compDefByRef.name;
            }
          }
          queuePendingComponent({
            messageId: event.detail.messageId,
            node,
            name: inferredName,
          });
          logger.debug('⏸️  Queued component until editor is ready:', inferredName || 'component');
          return;
        }
        if (!React.isValidElement(node)) {
          const maybe = event.detail.component as {
            type?: string;
            props?: Record<string, unknown>;
          };
          if (maybe && typeof maybe === 'object' && typeof maybe.type === 'string') {
            const compDef = components.find((c) => c.name === maybe.type);
            if (compDef) {
              node = React.createElement(compDef.component as any, {
                __custom_message_id: event.detail.messageId,
                ...(maybe.props || {}),
              });
              inferredName = compDef.name;
            }
          }
        } else {
          const type: any = (node as any).type;
          const typeName = (type?.displayName || type?.name || '').toString();
          if (typeName === 'customMessageProvider' || typeName.endsWith('Provider')) {
            const child = (node as any)?.props?.children;
            if (React.isValidElement(child)) {
              node = child;
            }
          }
          const compDefByRef = components.find((c) => (c.component as any) === (node as any).type);
          if (compDefByRef) {
            inferredName = compDefByRef.name;
          }
        }
        addComponentToCanvas(event.detail.messageId, node, inferredName);
        try {
          bus.send('ui_mount', {
            type: 'ui_mount',
            id: event.detail.messageId,
            timestamp: Date.now(),
            source: 'ui',
            context: { name: inferredName },
          });
          logJourneyEvent({
            eventType: 'asset',
            source: 'ui',
            tool: inferredName,
            payload: { messageId: event.detail.messageId, name: inferredName },
          });
        } catch {
          /* noop */
        }
      } catch (error) {
        console.error('Failed to add component to canvas from event:', error);
      }
    };

    window.addEventListener('custom:showComponent', handleShowComponent as EventListener);

    return () => {
      window.removeEventListener('custom:showComponent', handleShowComponent as EventListener);
    };
  }, [addComponentToCanvas, bus, editor, logger, queuePendingComponent]);

  useEffect(() => {
    if (!editor) return;
    drainPendingComponents((messageId, name) => {
      try {
        bus.send('ui_mount', {
          type: 'ui_mount',
          id: messageId,
          timestamp: Date.now(),
          source: 'ui',
          context: { name },
        });
        logJourneyEvent({
          eventType: 'asset',
          source: 'ui',
          tool: name,
          payload: { messageId, name },
        });
      } catch {
        /* noop */
      }
    }, (messageId) => {
      if (!isMessageRemoved?.(messageId)) return true;
      logger.debug('⛔ Skipping queued mount for removed messageId', { messageId });
      return false;
    });
  }, [editor, drainPendingComponents, bus, isMessageRemoved, logger]);
}
