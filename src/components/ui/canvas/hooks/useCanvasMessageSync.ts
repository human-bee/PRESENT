import { useEffect } from 'react';
import * as React from 'react';
import type { Editor } from 'tldraw';

import { ComponentRegistry } from '@/lib/component-registry';
import { components } from '@/lib/custom';
import type { CanvasLogger } from './useCanvasComponentStore';

interface CanvasMessageSyncParams {
  editor: Editor | null;
  thread: any;
  addedMessageIds: Set<string>;
  addComponentToCanvas: (
    messageId: string,
    component: React.ReactNode,
    componentName?: string,
  ) => void;
  logger: CanvasLogger;
}

/**
 * Reconciles components from registry on editor mount and auto-adds components from thread messages
 */
export function useCanvasMessageSync({
  editor,
  thread,
  addedMessageIds,
  addComponentToCanvas,
  logger,
}: CanvasMessageSyncParams) {
  // On first editor ready, reconcile with ComponentRegistry in case events were missed
  useEffect(() => {
    if (!editor) return;
    const existing = ComponentRegistry.list();
    if (!existing || existing.length === 0) return;
    logger.info(`🧭 Reconciling ${existing.length} components from registry`);
    existing.forEach((info) => {
      if (addedMessageIds.has(info.messageId)) return;
      const compDef = components.find((c) => c.name === info.componentType);
      let node: React.ReactNode = null;
      if (compDef) {
        try {
          node = React.createElement(compDef.component as any, {
            __custom_message_id: info.messageId,
            ...(info.props || {}),
          });
        } catch {
          logger.warn('Failed to recreate component from registry', info.componentType);
        }
      }
      if (!node) {
        // Fallback minimal node
        node = React.createElement('div', null, `${info.componentType}`);
      }
      addComponentToCanvas(info.messageId, node, info.componentType);
      logger.debug('✅ Reconciled component:', info.componentType, info.messageId);
    });
  }, [editor, addComponentToCanvas, addedMessageIds, logger]);

  /**
   * Effect to automatically add the latest component from thread messages (optimized with debouncing)
   */
  useEffect(() => {
    if (!thread?.messages || !editor) {
      return;
    }

    // Debounce component addition to prevent excessive rendering
    const timeoutId = setTimeout(() => {
      const messagesWithComponents = thread.messages.filter(
        (msg: any) => (msg as any).renderedComponent,
      );

      if (messagesWithComponents.length > 0) {
        const latestMessage: any = messagesWithComponents[messagesWithComponents.length - 1];

        const messageId = latestMessage.id || `msg-${Date.now()}`;
        // Check using addedMessageIds state
        if (!addedMessageIds.has(messageId) && latestMessage.renderedComponent) {
          // Normalize renderedComponent into a real React element when needed
          let node: React.ReactNode = latestMessage.renderedComponent as React.ReactNode;
          if (!React.isValidElement(node)) {
            const maybe = latestMessage.renderedComponent as {
              type?: unknown;
              props?: Record<string, unknown>;
            };
            if (maybe && typeof maybe === 'object' && maybe.type) {
              if (typeof maybe.type === 'string') {
                const compDef = components.find((c) => c.name === maybe.type);
                if (compDef) {
                  try {
                    node = React.createElement(compDef.component as any, {
                      __custom_message_id: messageId,
                      ...(maybe.props || {}),
                    });
                  } catch {
                    /* ignore */
                  }
                }
              } else if (
                typeof maybe.type === 'function' ||
                (typeof maybe.type === 'object' && maybe.type)
              ) {
                try {
                  node = React.createElement(maybe.type as any, {
                    __custom_message_id: messageId,
                    ...(maybe.props || {}),
                  });
                } catch {
                  /* ignore */
                }
              }
            }
          }

          addComponentToCanvas(
            messageId,
            node,
            latestMessage.role === 'assistant' ? 'AI Response' : 'User Input',
          );
        }
      }
    }, 100); // 100ms debounce

    return () => clearTimeout(timeoutId);
  }, [thread?.messages, editor, addComponentToCanvas, addedMessageIds]);
}
