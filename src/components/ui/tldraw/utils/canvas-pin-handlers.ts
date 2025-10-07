import type { Editor } from 'tldraw';
import type { CanvasEventMap } from './types';
import { getSelectedCustomShapes } from './canvas-selection-shared';

interface PinHandlersDeps {
  editor: Editor;
}

export function createCanvasPinHandlers({ editor }: PinHandlersDeps): CanvasEventMap {
  const handlePinSelected: EventListener = () => {
    try {
      const selected = getSelectedCustomShapes(editor);
      if (!selected.length) return;
      const viewport = editor.getViewportScreenBounds();
      const updates: any[] = [];

      for (const shape of selected) {
        const bounds = editor.getShapePageBounds(shape.id as any);
        if (!bounds) continue;
        const screenPoint = editor.pageToScreen({ x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h / 2 });
        const pinnedX = screenPoint.x / viewport.width;
        const pinnedY = screenPoint.y / viewport.height;
        updates.push({
          id: shape.id,
          type: shape.type as any,
          props: { pinned: true, pinnedX, pinnedY },
        });
      }

      if (updates.length) {
        editor.updateShapes(updates as any);
      }
    } catch (error) {
      console.warn('[CanvasControl] pin_selected error', error);
    }
  };

  const handleUnpinSelected: EventListener = () => {
    try {
      const selected = getSelectedCustomShapes(editor);
      if (!selected.length) return;
      const updates = selected.map((shape) => ({ id: shape.id, type: shape.type as any, props: { pinned: false } }));
      editor.updateShapes(updates as any);
    } catch (error) {
      console.warn('[CanvasControl] unpin_selected error', error);
    }
  };

  const handleLockSelected: EventListener = () => {
    try {
      const selected = editor.getSelectedShapes();
      if (!selected.length) return;
      const updates = selected.map((shape: any) => ({ id: shape.id, type: shape.type, isLocked: true }));
      editor.updateShapes(updates as any);
    } catch (error) {
      console.warn('[CanvasControl] lock_selected error', error);
    }
  };

  const handleUnlockSelected: EventListener = () => {
    try {
      const selected = editor.getSelectedShapes();
      if (!selected.length) return;
      const updates = selected.map((shape: any) => ({ id: shape.id, type: shape.type, isLocked: false }));
      editor.updateShapes(updates as any);
    } catch (error) {
      console.warn('[CanvasControl] unlock_selected error', error);
    }
  };

  return {
    'tldraw:pinSelected': handlePinSelected,
    'tldraw:unpinSelected': handleUnpinSelected,
    'tldraw:lockSelected': handleLockSelected,
    'tldraw:unlockSelected': handleUnlockSelected,
  };
}
