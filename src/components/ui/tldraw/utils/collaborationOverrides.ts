 

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
                const screenPoint = editor.pageToScreen({
                  x: bounds.x + bounds.w / 2,
                  y: bounds.y + bounds.h / 2,
                });
                const pinnedX = screenPoint.x / viewport.width;
                const pinnedY = screenPoint.y / viewport.height;

                setLocalPin(roomName, String(shape.id), {
                  pinnedX: Math.max(0, Math.min(1, pinnedX)),
                  pinnedY: Math.max(0, Math.min(1, pinnedY)),
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
