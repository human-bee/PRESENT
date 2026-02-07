import type { Editor } from '@tldraw/tldraw';
import type { CanvasEventMap } from './types';
import { getSelectedCustomShapes } from './canvas-selection-shared';
import { clearLocalPin, setLocalPin } from './local-pin-store';

interface PinHandlersDeps {
  editor: Editor;
  roomName?: string;
}

export function createCanvasPinHandlers({ editor, roomName }: PinHandlersDeps): CanvasEventMap {
  const resolvedRoom = (roomName || '').trim() || 'canvas';
  const handlePinSelected: EventListener = () => {
    try {
      const selected = getSelectedCustomShapes(editor);
      if (!selected.length) return;
      const viewport = editor.getViewportScreenBounds();

      for (const shape of selected) {
        const bounds = editor.getShapePageBounds(shape.id as any);
        if (!bounds) continue;
        const screenPoint = editor.pageToScreen({ x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h / 2 });
        const pinnedX = screenPoint.x / viewport.width;
        const pinnedY = screenPoint.y / viewport.height;
        setLocalPin(resolvedRoom, String(shape.id), {
          pinnedX,
          pinnedY,
        });
      }
    } catch (error) {
      console.warn('[CanvasControl] pin_selected error', error);
    }
  };

  const handleUnpinSelected: EventListener = () => {
    try {
      const selected = getSelectedCustomShapes(editor);
      if (!selected.length) return;
      for (const shape of selected) {
        clearLocalPin(resolvedRoom, String(shape.id));
      }
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
