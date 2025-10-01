import { toRichText } from 'tldraw';
import type { Editor } from 'tldraw';

import { renderPlaintextFromRichText } from './rich-text';
import { withWindowListeners } from './window-listeners';

export function registerCanvasSelectionHandlers(editor: Editor): () => void {
  return withWindowListeners((add) => {
    const handleSelect = (event: Event) => {
      try {
        const detail = (event as CustomEvent).detail || {};
        const nameQuery = (detail.nameContains as string | undefined)?.toLowerCase();
        const typeQuery = detail.type as string | undefined;
        const within = detail.withinBounds as { x: number; y: number; w: number; h: number } | undefined;
        const shapes = editor.getCurrentPageShapes().filter((s: any) => {
          if (typeQuery && s.type !== typeQuery) return false;
          if (nameQuery) {
            const n = (s.props?.name || s.props?.customComponent || s.id || '')
              .toString()
              .toLowerCase();
            if (!n.includes(nameQuery)) return false;
          }
          if (within) {
            const b = editor.getShapePageBounds(s.id);
            if (!b) return false;
            const inside =
              b.x >= within.x &&
              b.y >= within.y &&
              b.x + b.w <= within.x + within.w &&
              b.y + b.h <= within.y + within.h;
            if (!inside) return false;
          }
          return true;
        });
        const ids = shapes.map((s: any) => s.id);
        if (ids.length) {
          editor.select(ids as any);
          if ((editor as any).zoomToSelection) (editor as any).zoomToSelection({ inset: 48 });
        }
      } catch (err) {
        console.warn('[CanvasControl] select error', err);
      }
    };

    const handleSelectNote = (event: Event) => {
      try {
        const detail = (event as CustomEvent).detail || {};
        const query = String(detail.text || '').toLowerCase();
        if (!query) return;
        const notes = (editor.getCurrentPageShapes() as any[]).filter((s) => s.type === 'note');
        const match = notes.find((n) => {
          try {
            const text = renderPlaintextFromRichText(editor as any, n.props?.richText || undefined)
              ?.toString()
              ?.toLowerCase();
            return text && text.includes(query);
          } catch {
            return false;
          }
        });
        if (match) {
          editor.select([match.id] as any);
          if ((editor as any).zoomToSelection) (editor as any).zoomToSelection({ inset: 64 });
        }
      } catch (err) {
        console.warn('[CanvasControl] selectNote error', err);
      }
    };

    const resolveTargetShape = (detail: any) => {
      const byId = detail?.shapeId as string | undefined;
      if (byId) return byId;
      const text = (detail?.textContains || detail?.contains || '').toString().toLowerCase();
      if (text) {
        const notes = (editor.getCurrentPageShapes() as any[]).filter((s) => s.type === 'note');
        const match = notes.find((n) => {
          try {
            const t = renderPlaintextFromRichText(editor as any, n.props?.richText || undefined)
              ?.toString()
              ?.toLowerCase();
            return t && t.includes(text);
          } catch {
            return false;
          }
        });
        if (match) return match.id;
      }
      return undefined;
    };

    const handleColorShape = (event: Event) => {
      try {
        const detail = (event as CustomEvent).detail || {};
        const color = (detail.color || '').toString();
        const id = resolveTargetShape(detail);
        if (!id || !color) return;
        const s = editor.getShape(id as any) as any;
        if (s?.type === 'note') {
          editor.updateShapes([{ id: s.id, type: 'note' as const, props: { color } }]);
        }
      } catch (err) {
        console.warn('[CanvasControl] colorShape error', err);
      }
    };

    const handleDeleteShape = (event: Event) => {
      try {
        const detail = (event as CustomEvent).detail || {};
        const id = resolveTargetShape(detail);
        if (!id) return;
        editor.deleteShapes([id as any]);
      } catch (err) {
        console.warn('[CanvasControl] deleteShape error', err);
      }
    };

    const handleRenameNote = (event: Event) => {
      try {
        const detail = (event as CustomEvent).detail || {};
        const id = resolveTargetShape(detail);
        const text = (detail.text || '').toString();
        if (!id || !text) return;
        const s = editor.getShape(id as any) as any;
        if (s?.type === 'note') {
          editor.updateShapes([
            { id: s.id, type: 'note' as const, props: { richText: toRichText(text) } },
          ]);
        }
      } catch (err) {
        console.warn('[CanvasControl] renameNote error', err);
      }
    };

    add('tldraw:select', handleSelect as EventListener);
    add('tldraw:selectNote', handleSelectNote as EventListener);
    add('tldraw:colorShape', handleColorShape as EventListener);
    add('tldraw:deleteShape', handleDeleteShape as EventListener);
    add('tldraw:renameNote', handleRenameNote as EventListener);
  });
}
