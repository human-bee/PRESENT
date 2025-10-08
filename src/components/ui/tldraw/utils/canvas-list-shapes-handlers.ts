import type { Editor } from '@tldraw/tldraw';
import type { CanvasEventMap } from './types';

interface ListHandlersDeps {
  editor: Editor;
}

export function createCanvasListShapesHandlers({ editor }: ListHandlersDeps): CanvasEventMap {
  const handleSelect: EventListener = (event) => {
    try {
      const detail = (event as CustomEvent).detail || {};
      const nameQuery = (detail.nameContains as string | undefined)?.toLowerCase();
      const typeQuery = detail.type as string | undefined;
      const within = detail.withinBounds as { x: number; y: number; w: number; h: number } | undefined;

      const shapes = editor.getCurrentPageShapes().filter((shape: any) => {
        if (typeQuery && shape.type !== typeQuery) return false;
        if (nameQuery) {
          const name = (shape.props?.name || shape.props?.customComponent || shape.id || '')
            .toString()
            .toLowerCase();
          if (!name.includes(nameQuery)) return false;
        }
        if (within) {
          const bounds = editor.getShapePageBounds(shape.id as any);
          if (!bounds) return false;
          const inside =
            bounds.x >= within.x &&
            bounds.y >= within.y &&
            bounds.x + bounds.w <= within.x + within.w &&
            bounds.y + bounds.h <= within.y + within.h;
          if (!inside) return false;
        }
        return true;
      });

      const ids = shapes.map((shape: any) => shape.id);
      if (ids.length) {
        editor.select(ids as any);
        if ((editor as any).zoomToSelection) {
          (editor as any).zoomToSelection({ inset: 48 });
        }
      }
    } catch (error) {
      console.warn('[CanvasControl] select error', error);
    }
  };

  return {
    'tldraw:select': handleSelect,
  };
}
