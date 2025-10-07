import type { Editor } from 'tldraw';
import type { CanvasEventMap } from './types';
import { resolveTargetShapeId } from './canvas-selection-shared';

interface SelectionHandlersDeps {
  editor: Editor;
}

export function createCanvasSelectionHandlers({ editor }: SelectionHandlersDeps): CanvasEventMap {
  const handleDeleteShape: EventListener = (event) => {
    try {
      const detail = (event as CustomEvent).detail || {};
      const shapeId = resolveTargetShapeId(editor, detail);
      if (!shapeId) return;
      editor.deleteShapes([shapeId as any]);
    } catch (error) {
      console.warn('[CanvasControl] deleteShape error', error);
    }
  };

  return {
    'tldraw:deleteShape': handleDeleteShape,
  };
}
