import type { Editor } from 'tldraw';

import type { customShape } from '../tldraw-canvas';

export function registerPinnedShapeManagement(editor: Editor): () => void {
  let isUpdatingPinnedShapes = false;

  const updateAllPinnedShapes = () => {
    if (isUpdatingPinnedShapes) return;

    try {
      isUpdatingPinnedShapes = true;

      const allShapes = editor.getCurrentPageShapes();
      const pinnedShapes = allShapes.filter(
        (shape): shape is customShape => shape.type === 'custom' && (shape as customShape).props.pinned === true,
      );

      if (pinnedShapes.length === 0) return;

      const viewport = editor.getViewportScreenBounds();
      const updates: any[] = [];

      for (const shape of pinnedShapes) {
        const pinnedX = shape.props.pinnedX ?? 0.5;
        const pinnedY = shape.props.pinnedY ?? 0.5;

        const screenX = viewport.width * pinnedX;
        const screenY = viewport.height * pinnedY;

        const pagePoint = editor.screenToPage({ x: screenX, y: screenY });

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

  const cameraCleanup = editor.sideEffects.registerAfterChangeHandler('camera', updateAllPinnedShapes);

  const handleResize = () => {
    updateAllPinnedShapes();
  };

  if (typeof window !== 'undefined') {
    window.addEventListener('resize', handleResize);
    setTimeout(updateAllPinnedShapes, 100);
  }

  return () => {
    cameraCleanup();
    if (typeof window !== 'undefined') {
      window.removeEventListener('resize', handleResize);
    }
  };
}
