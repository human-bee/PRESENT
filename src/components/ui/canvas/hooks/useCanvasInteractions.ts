import * as React from 'react';
import { useCallback } from 'react';
import { nanoid } from 'nanoid';
import type { Editor } from 'tldraw';
import { createShapeId } from 'tldraw';

import { components } from '@/lib/custom';

import type { CanvasLogger } from './useCanvasComponentStore';
import { createOnboardingGuide } from '../utils/createOnboardingGuide';

export interface CanvasInteractionsOptions {
  editor: Editor | null;
  componentStore: React.MutableRefObject<Map<string, React.ReactNode>>;
  logger: CanvasLogger;
}

export interface CanvasInteractionsApi {
  onDragOver: (event: React.DragEvent<HTMLDivElement>) => void;
  onDrop: (event: React.DragEvent<HTMLDivElement>) => void;
  toggleComponentToolbox: () => void;
  showOnboarding: () => void;
}

export function useCanvasInteractions({
  editor,
  componentStore,
  logger,
}: CanvasInteractionsOptions): CanvasInteractionsApi {
  const handleDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  }, []);

  const handleDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();

      const componentType = event.dataTransfer.getData('application/custom-component');
      if (!componentType) {
        return;
      }

      if (!editor) {
        logger.warn('Editor not available, cannot drop component.');
        return;
      }

      logger.info('📥 Dropping component:', componentType);

      const Component = components.find((c) => c.name === componentType)?.component;
      if (!Component) {
        logger.warn('Failed to find component for type:', componentType);
        return;
      }

      const shapeId = createShapeId(nanoid());
      const componentInstance = React.createElement(Component, {
        __custom_message_id: shapeId,
      });

      componentStore.current.set(shapeId, componentInstance);
      try {
        window.dispatchEvent(new Event('present:component-store-updated'));
      } catch {
        /* ignore */
      }

      const position = editor.screenToPage({ x: event.clientX, y: event.clientY });
      editor.createShape({
        id: shapeId,
        type: 'custom',
        x: position.x,
        y: position.y,
        props: {
          w: 300,
          h: 200,
          customComponent: shapeId,
          name: componentType,
        },
      });

      logger.info('✅ Component dropped successfully');
    },
    [componentStore, editor, logger],
  );

  const toggleComponentToolbox = useCallback(() => {
    if (!editor) {
      logger.warn('Editor not available, cannot toggle toolbox');
      return;
    }

    const existingToolbox = editor
      .getCurrentPageShapes()
      .find((shape) => shape.type === 'toolbox');

    if (existingToolbox) {
      editor.deleteShapes([existingToolbox.id]);
      logger.info('🗑️ Removed existing component toolbox');
      return;
    }

    const viewport = editor.getViewportPageBounds();
    const TOOLBOX_W = 56;
    const TOOLBOX_H = 560;
    const x = viewport ? viewport.minX + 24 : 24;
    const y = viewport ? viewport.midY - TOOLBOX_H / 2 : 24;

    editor.createShape({
      id: createShapeId(`toolbox-${nanoid()}`),
      type: 'toolbox',
      x,
      y,
      props: {
        w: TOOLBOX_W,
        h: TOOLBOX_H,
        name: 'Component Toolbox',
      },
    });

    logger.info('✅ Created component toolbox shape');
  }, [editor, logger]);

  const showOnboarding = useCallback(() => {
    if (!editor) {
      logger.warn('Editor not available, cannot show onboarding');
      return;
    }

    createOnboardingGuide({ editor, componentStore, logger });
  }, [componentStore, editor, logger]);

  return {
    onDragOver: handleDragOver,
    onDrop: handleDrop,
    toggleComponentToolbox,
    showOnboarding,
  };
}
