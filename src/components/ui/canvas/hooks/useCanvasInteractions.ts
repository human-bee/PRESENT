import * as React from 'react';
import { useCallback } from 'react';
import type { Editor } from 'tldraw';
import { createShapeId } from 'tldraw';
import { nanoid } from 'nanoid';

import { components } from '@/lib/custom';
import type { CanvasLogger } from './useCanvasComponentStore';

interface CanvasInteractionsParams {
  editor: Editor | null;
  componentStore: React.MutableRefObject<Map<string, React.ReactNode>>;
  logger: CanvasLogger;
}

function emitComponentStoreUpdated() {
  try {
    window.dispatchEvent(new Event('present:component-store-updated'));
  } catch {
    /* ignore */
  }
}

export function useCanvasInteractions({
  editor,
  componentStore,
  logger,
}: CanvasInteractionsParams) {
  /**
   * Toggle component toolbox on canvas
   */
  const toggleComponentToolbox = useCallback(() => {
    if (!editor) {
      console.warn('Editor not available');
      return;
    }

    // Check if toolbox already exists
    const existingToolbox = editor.getCurrentPageShapes().find((shape) => shape.type === 'toolbox');

    if (existingToolbox) {
      // Remove existing toolbox
      editor.deleteShapes([existingToolbox.id]);
      logger.info('🗑️ Removed existing component toolbox');
    } else {
      // Create new toolbox shape
      const viewport = editor.getViewportPageBounds();
      const TOOLBOX_W = 56;
      const TOOLBOX_H = 560; // taller vertical column
      const x = viewport ? viewport.minX + 24 : 24; // near left edge
      const y = viewport ? viewport.midY - TOOLBOX_H / 2 : 24; // vertically centered

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
    }
  }, [editor, logger]);

  /**
   * Show onboarding guide on canvas
   */
  const showOnboarding = useCallback(() => {
    logger.info('🆘 Help button clicked - creating onboarding guide');

    if (!editor) {
      console.warn('Editor not available');
      return;
    }

    // Create OnboardingGuide component directly
    const shapeId = createShapeId(nanoid());
    const OnboardingGuideComponent = components.find(
      (c) => c.name === 'OnboardingGuide',
    )?.component;

    if (OnboardingGuideComponent) {
      const componentInstance = React.createElement(OnboardingGuideComponent, {
        __custom_message_id: shapeId,
        context: 'canvas',
        autoStart: true,
        state: {},
        updateState: (patch: Record<string, unknown> | ((prev: any) => any)) => {
          if (!editor) return;
          const prev = {} as Record<string, unknown>;
          const next = typeof patch === 'function' ? (patch as any)(prev) : { ...prev, ...patch };
          editor.updateShapes([{ id: shapeId, type: 'custom' as const, props: { state: next } }]);
        },
      });
      componentStore.current.set(shapeId, componentInstance);
      emitComponentStoreUpdated();

      // Get center of viewport for placement
      const viewport = editor.getViewportPageBounds();
      const x = viewport ? viewport.midX - 200 : 100;
      const y = viewport ? viewport.midY - 150 : 100;

      editor.createShape({
        id: shapeId,
        type: 'custom',
        x,
        y,
        props: {
          w: 400,
          h: 300,
          customComponent: shapeId,
          name: 'OnboardingGuide',
        },
      });

      logger.info('✅ Onboarding guide created successfully');
    } else {
      logger.warn('OnboardingGuide component not found');
    }
  }, [editor, componentStore, logger]);

  /**
   * Handle drag over event for component drop zone
   */
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  /**
   * Handle drop event for component placement on canvas
   */
  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const componentType = e.dataTransfer.getData('application/custom-component');
      if (componentType && editor) {
        logger.info('📥 Dropping component:', componentType);
        const shapeId = createShapeId(nanoid());
        const Component = components.find((c) => c.name === componentType)?.component;
        if (Component) {
          const componentInstance = React.createElement(Component, {
            __custom_message_id: shapeId,
          });
          componentStore.current.set(shapeId, componentInstance);
          emitComponentStoreUpdated();
          const pos = editor.screenToPage({ x: e.clientX, y: e.clientY });
          editor.createShape({
            id: shapeId,
            type: 'custom',
            x: pos.x,
            y: pos.y,
            props: {
              w: 300,
              h: 200,
              customComponent: shapeId,
              name: componentType,
            },
          });
          logger.info('✅ Component dropped successfully');
        } else {
          logger.warn('Failed to find component for type:', componentType);
        }
      }
    },
    [editor, componentStore, logger],
  );

  return {
    toggleComponentToolbox,
    showOnboarding,
    handleDragOver,
    handleDrop,
  };
}
