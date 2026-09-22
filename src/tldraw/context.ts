import { Box, type Editor, type TLShapeId } from 'tldraw';
import type { CanvasContextProvider } from '../../shared/canvas-commands';
import { controlNativeCanvas } from './native-controls';
import { focusResult } from './focus';

export function createCanvasContext(editor: Editor | null): CanvasContextProvider {
  return {
    control: input => controlNativeCanvas(editor, input),
    reveal(ids) {
      if (editor && ids.length) void focusResult(editor, ids.map(id => (id.startsWith('shape:') ? id : `shape:${id}`) as TLShapeId));
    },
    read(includeIds = []) {
      if (!editor) return null;
      const viewport = editor.getViewportPageBounds();
      const selected = new Set(editor.getSelectedShapeIds());
      const requested = new Set(includeIds.map(id => id.startsWith('shape:') ? id : `shape:${id}`));
      const shapes = editor.getCurrentPageShapesSorted().flatMap(shape => {
        const bounds = editor.getShapePageBounds(shape);
        if (!bounds || !selected.has(shape.id) && !requested.has(shape.id) && (bounds.maxX < viewport.x || bounds.x > viewport.maxX || bounds.maxY < viewport.y || bounds.y > viewport.maxY)) return [];
        const text = editor.getShapeUtil(shape).getText(shape)?.slice(0, 2000);
        return [{ id: shape.id, type: shape.type, x: shape.x, y: shape.y,
          bounds: { x: bounds.x, y: bounds.y, w: bounds.w, h: bounds.h },
          ...(text ? { text } : {}), ...(shape.type === 'present-widget' ? { title: shape.props.title } : {}) }];
      }).sort((a, b) => Number(selected.has(b.id) || requested.has(b.id)) - Number(selected.has(a.id) || requested.has(a.id))).slice(0, 120);
      return { pageId: editor.getCurrentPageId(), selectedIds: [...selected],
        viewport: { x: viewport.x, y: viewport.y, w: viewport.w, h: viewport.h, z: editor.getZoomLevel() },
        shapes, capturedAt: Date.now() };
    },
    async capture(scope) {
      if (!editor) return null;
      const pageBounds = editor.getCurrentPageShapesSorted().flatMap(shape => { const box = editor.getShapePageBounds(shape); return box ? [box] : []; });
      const bounds = scope === 'page' ? (pageBounds.length ? Box.Common(pageBounds) : null) : scope === 'selection' ? editor.getSelectionPageBounds() : editor.getViewportPageBounds();
      if (!bounds) return null;
      const candidates = scope === 'selection' ? editor.getSelectedShapes() : editor.getCurrentPageShapesSorted().filter(shape => {
        const box = editor.getShapePageBounds(shape);
        return box && box.maxX >= bounds.x && box.x <= bounds.maxX && box.maxY >= bounds.y && box.y <= bounds.maxY;
      });
      const native = candidates.filter(shape => shape.type !== 'present-widget');
      if (!native.length) return null;
      try {
        const image = await editor.toImageDataUrl(native, { format: 'jpeg', quality: 0.8, bounds, padding: 0, pixelRatio: 1,
          scale: Math.min(1, 1200 / Math.max(bounds.w, bounds.h)), background: true });
        const omittedWidgetIds = candidates.filter(shape => shape.type === 'present-widget').map(shape => shape.id);
        return { dataUrl: image.url, scope, capturedAt: Date.now(), omittedWidgetIds,
          caption: `Native canvas ${scope}. ${omittedWidgetIds.length ? 'Interactive HTML widgets are omitted from this raster; use structured context for their state.' : 'All scoped native shapes included.'}` };
      } catch { return null; }
    },
  };
}
