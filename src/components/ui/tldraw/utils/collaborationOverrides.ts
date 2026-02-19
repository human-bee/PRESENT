 

import { TLUiOverrides } from '@tldraw/tldraw';
import type { customShape } from '../tldraw-canvas';
import { clearLocalPin, getLocalPin, setLocalPin } from './local-pin-store';

/**
 * Creates TLDraw UI overrides for collaboration features
 * Adds pin-to-viewport action
 */
export function createCollaborationOverrides(options?: { roomName?: string }): TLUiOverrides {
  const roomName = (options?.roomName || '').trim() || 'canvas';
  const overrides: any = {
    actions: (editor: any, actions: any) => {
      const pinAction = {
        id: 'pin-shape-to-viewport',
        label: 'Pin to Window',
        icon: 'external-link',
        kbd: 'shift+p',
        onSelect: () => {
          const selectedShapes = editor.getSelectedShapes();

          if (selectedShapes.length === 1 && selectedShapes[0].type === 'custom') {
            const shape = selectedShapes[0] as customShape;
            const isPinned = Boolean(getLocalPin(roomName, String(shape.id)));

            if (!isPinned) {
              const viewport = editor.getViewportScreenBounds();
              const bounds = editor.getShapePageBounds(shape.id);
              if (bounds) {
                const zoomRaw = Number((editor as any).getZoomLevel?.() ?? 1);
                const zoom = Number.isFinite(zoomRaw) && zoomRaw > 0 ? zoomRaw : 1;
                const shapeWRaw = Number((shape as any)?.props?.w ?? bounds.w);
                const shapeHRaw = Number((shape as any)?.props?.h ?? bounds.h);
                const shapeW = Number.isFinite(shapeWRaw) && shapeWRaw > 0 ? shapeWRaw : bounds.w;
                const shapeH = Number.isFinite(shapeHRaw) && shapeHRaw > 0 ? shapeHRaw : bounds.h;
                const viewportXRaw = Number((viewport as any).x);
                const viewportYRaw = Number((viewport as any).y);
                const viewportW = Math.max(1, Number((viewport as any).width) || 1);
                const viewportH = Math.max(1, Number((viewport as any).height) || 1);
                const viewportX = Number.isFinite(viewportXRaw) ? viewportXRaw : 0;
                const viewportY = Number.isFinite(viewportYRaw) ? viewportYRaw : 0;
                const screenPoint = editor.pageToScreen({
                  x: bounds.x + bounds.w / 2,
                  y: bounds.y + bounds.h / 2,
                });
                const topLeft = editor.pageToScreen({ x: bounds.x, y: bounds.y });
                const pinnedX = (screenPoint.x - viewportX) / viewportW;
                const pinnedY = (screenPoint.y - viewportY) / viewportH;
                const pinnedLeft = (topLeft.x - viewportX) / viewportW;
                const pinnedTop = (topLeft.y - viewportY) / viewportH;
                const screenW = Math.max(1, shapeW * zoom);
                const screenH = Math.max(1, shapeH * zoom);

                setLocalPin(roomName, String(shape.id), {
                  pinnedX: Math.max(0, Math.min(1, pinnedX)),
                  pinnedY: Math.max(0, Math.min(1, pinnedY)),
                  pinnedLeft: Math.max(0, Math.min(1, pinnedLeft)),
                  pinnedTop: Math.max(0, Math.min(1, pinnedTop)),
                  screenW,
                  screenH,
                  shapeW,
                  shapeH,
                });
              }
            } else {
              clearLocalPin(roomName, String(shape.id));
            }
          }
        },
        readonlyOk: false,
      };

      return {
        ...actions,
        'pin-shape-to-viewport': pinAction,
      };
    },
  };
  return overrides as TLUiOverrides;
}
