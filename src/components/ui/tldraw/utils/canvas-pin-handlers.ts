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
      const viewportXRaw = Number((viewport as any).x);
      const viewportYRaw = Number((viewport as any).y);
      const viewportX = Number.isFinite(viewportXRaw) ? viewportXRaw : 0;
      const viewportY = Number.isFinite(viewportYRaw) ? viewportYRaw : 0;
      const viewportW = Math.max(1, Number((viewport as any).width) || 1);
      const viewportH = Math.max(1, Number((viewport as any).height) || 1);

      for (const shape of selected) {
        const bounds = editor.getShapePageBounds(shape.id as any);
        if (!bounds) continue;
        const zoomRaw = Number((editor as any).getZoomLevel?.() ?? 1);
        const zoom = Number.isFinite(zoomRaw) && zoomRaw > 0 ? zoomRaw : 1;
        const shapeWRaw = Number((shape as any)?.props?.w ?? bounds.w);
        const shapeHRaw = Number((shape as any)?.props?.h ?? bounds.h);
        const shapeW = Number.isFinite(shapeWRaw) && shapeWRaw > 0 ? shapeWRaw : bounds.w;
        const shapeH = Number.isFinite(shapeHRaw) && shapeHRaw > 0 ? shapeHRaw : bounds.h;
        const screenPoint = editor.pageToScreen({ x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h / 2 });
        const topLeft = editor.pageToScreen({ x: bounds.x, y: bounds.y });
        const pinnedX = (screenPoint.x - viewportX) / viewportW;
        const pinnedY = (screenPoint.y - viewportY) / viewportH;
        const pinnedLeft = (topLeft.x - viewportX) / viewportW;
        const pinnedTop = (topLeft.y - viewportY) / viewportH;
        const screenW = Math.max(1, shapeW * zoom);
        const screenH = Math.max(1, shapeH * zoom);
        setLocalPin(resolvedRoom, String(shape.id), {
          pinnedX,
          pinnedY,
          pinnedLeft,
          pinnedTop,
          screenW,
          screenH,
          shapeW,
          shapeH,
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
