import type { Editor } from 'tldraw';

import { withWindowListeners } from './window-listeners';

export function registerCanvasNavigationHandlers(editor: Editor): () => void {
  return withWindowListeners((add) => {
    const handleFocusEvent = (event: Event) => {
      const detail = (event as CustomEvent).detail || {};
      const target: 'all' | 'selected' | 'component' | 'shape' = detail.target || 'all';
      const padding: number = typeof detail.padding === 'number' ? detail.padding : 64;

      try {
        if (target === 'all') {
          if ((editor as any).zoomToFit) {
            (editor as any).zoomToFit();
          } else {
            const bounds = editor.getCurrentPageBounds();
            if (bounds && (editor as any).zoomToBounds) {
              (editor as any).zoomToBounds(bounds, {
                animation: { duration: 320 },
                inset: padding,
              });
            }
          }
          return;
        }

        if (target === 'selected') {
          if ((editor as any).zoomToSelection) {
            (editor as any).zoomToSelection({ inset: padding });
            return;
          }
        }

        let shapeId: string | null = null;
        if (target === 'shape' && detail.shapeId) {
          shapeId = detail.shapeId;
        }
        if (target === 'component' && detail.componentId) {
          const custom = editor
            .getCurrentPageShapes()
            .find((s: any) => s.type === 'custom' && s.props?.customComponent === detail.componentId);
          shapeId = custom?.id ?? null;
        }

        if (shapeId) {
          const b = editor.getShapePageBounds(shapeId as any);
          if (b && (editor as any).zoomToBounds) {
            (editor as any).zoomToBounds(b, {
              animation: { duration: 320 },
              inset: padding,
            });
          }
        }
      } catch (err) {
        console.warn('[CanvasControl] focus error', err);
      }
    };

    const handleZoomAll = () => {
      try {
        if ((editor as any).zoomToFit) {
          (editor as any).zoomToFit();
          return;
        }
        const bounds = editor.getCurrentPageBounds();
        if (bounds && (editor as any).zoomToBounds) {
          (editor as any).zoomToBounds(bounds, { animation: { duration: 320 } });
        }
      } catch (err) {
        console.warn('[CanvasControl] zoomAll error', err);
      }
    };

    add('tldraw:canvas_focus', handleFocusEvent as EventListener);
    add('tldraw:canvas_zoom_all', handleZoomAll as EventListener);
  });
}
