import { useCallback } from 'react';
import { Editor } from 'tldraw';
import type { customShape } from '../tldraw-canvas';

/**
 * Manages pinned shapes that stay in viewport position
 * @param editor - TLDraw editor instance
 * @returns Cleanup function for pinned shapes side effects
 */
export function usePinnedShapes(editor: Editor | undefined) {
  const setupPinnedShapes = useCallback(() => {
    if (!editor) return () => {};

    let isUpdatingPinnedShapes = false;

    const updateAllPinnedShapes = () => {
      if (isUpdatingPinnedShapes) return;

      try {
        isUpdatingPinnedShapes = true;

        const allShapes = editor.getCurrentPageShapes();
        const pinnedShapes = allShapes.filter(
          (shape): shape is customShape =>
            shape.type === 'custom' && (shape as customShape).props.pinned === true,
        );

        if (pinnedShapes.length === 0) return;

        const viewport = editor.getViewportScreenBounds();
        const updates: any[] = [];

        for (const shape of pinnedShapes) {
          const pinnedX = shape.props.pinnedX ?? 0.5;
          const pinnedY = shape.props.pinnedY ?? 0.5;

          // Calculate screen position from pinned viewport coordinates
          const screenX = viewport.width * pinnedX;
          const screenY = viewport.height * pinnedY;

          // Convert to page coordinates
          const pagePoint = editor.screenToPage({ x: screenX, y: screenY });

          // Update shape position
          updates.push({
            id: shape.id,
            type: 'custom' as const,
            x: pagePoint.x - shape.props.w / 2,
            y: pagePoint.y - shape.props.h / 2,
          });
        }

        if (updates.length > 0) {
          editor.updateShapes(updates as any);
        }
      } finally {
        isUpdatingPinnedShapes = false;
      }
    };

    // Register camera change handler for pinned shapes
    const cameraCleanup = editor.sideEffects.registerAfterChangeHandler(
      'camera',
      updateAllPinnedShapes,
    );

    // Also handle viewport resize
    const handleResize = () => {
      updateAllPinnedShapes();
    };

    window.addEventListener('resize', handleResize);

    // Initial update
    setTimeout(updateAllPinnedShapes, 100);

    // Return cleanup function
    return () => {
      cameraCleanup();
      window.removeEventListener('resize', handleResize);
    };
  }, [editor]);

  return setupPinnedShapes;
}
