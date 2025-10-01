import { useEffect } from 'react';
import React from 'react';

import { components } from '@/lib/custom';

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
  drainPendingComponents: (onMounted: (messageId: string, name?: string) => void) => void;
  bus: { send: (...args: any[]) => void };
  logger: CanvasLogger;
}

export function useCanvasEvents({
  editor,
  addComponentToCanvas,
  queuePendingComponent,
  drainPendingComponents,
  bus,
  logger,
}: CanvasEventsParams) {
  useEffect(() => {
    const handleShowComponent = (
      event: CustomEvent<{
        messageId: string;
        component: React.ReactNode | { type: string; props?: Record<string, unknown> };
      }>,
    ) => {
      try {
        let node: React.ReactNode = event.detail.component as React.ReactNode;
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
      } catch {
        /* noop */
      }
    });
  }, [editor, drainPendingComponents, bus]);
}
