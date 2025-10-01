import { useEffect } from 'react';
import type { Editor } from 'tldraw';
import React from 'react';

import { components } from '@/lib/custom';

import type { customShape as CustomShape } from '../tldraw-canvas';
import type { CanvasLogger } from './useCanvasComponentStore';
import type { MutableRefObject } from 'react';

interface RehydrationParams {
  editor: Editor | null;
  componentStore: MutableRefObject<Map<string, React.ReactNode>>;
  setMessageIdToShapeIdMap: (updater: (prev: Map<string, string>) => Map<string, string>) => void;
  setAddedMessageIds: (updater: (prev: Set<string>) => Set<string>) => void;
  logger: CanvasLogger;
}

export function useCanvasRehydration({
  editor,
  componentStore,
  setMessageIdToShapeIdMap,
  setAddedMessageIds,
  logger,
}: RehydrationParams) {
  useEffect(() => {
    const handleRehydration = () => {
      if (!editor) {
        logger.debug('Editor not ready for rehydration, skipping...');
        return;
      }

      logger.info('🔄 Starting component rehydration...');
      const customShapes = editor
        .getCurrentPageShapes()
        .filter((shape) => shape.type === 'custom') as CustomShape[];

      logger.debug(`Found ${customShapes.length} custom shapes to rehydrate`);

      customShapes.forEach((shape) => {
        let componentName = shape.props.name;
        const messageId = shape.props.customComponent;

        logger.debug(`Rehydrating ${componentName} (${messageId})`);

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
          const componentInstance = React.createElement(Component, {
            __custom_message_id: messageId,
            state: (shape.props as any).state || {},
            updateState: (patch: Record<string, unknown> | ((prev: any) => any)) => {
              if (!editor) return;
              const prev = ((shape.props as any).state as Record<string, unknown>) || {};
              const next = typeof patch === 'function' ? (patch as any)(prev) : { ...prev, ...patch };
              editor.updateShapes([{ id: shape.id, type: 'custom', props: { state: next } }]);
            },
          });
          componentStore.current.set(messageId, componentInstance);
          try {
            window.dispatchEvent(new Event('present:component-store-updated'));
          } catch {
            /* noop */
          }

          setMessageIdToShapeIdMap((prev) => new Map(prev).set(messageId, shape.id));
          setAddedMessageIds((prev) => new Set(prev).add(messageId));

          logger.debug(`✅ Rehydrated ${componentName} successfully`);
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

          logger.debug(`⚠️ Created fallback for ${componentName}`);
        }
      });

      logger.info(
        `🎯 Rehydration complete! ComponentStore now has ${componentStore.current.size} components`,
      );
    };

    window.addEventListener('custom:rehydrateComponents', handleRehydration as EventListener);

    return () => {
      window.removeEventListener('custom:rehydrateComponents', handleRehydration as EventListener);
    };
  }, [editor, componentStore, logger, setAddedMessageIds, setMessageIdToShapeIdMap]);
}
