import { createShapeId, toRichText } from 'tldraw';
import type { Editor } from 'tldraw';
import { nanoid } from 'nanoid';

import type { LiveKitBus } from './types';
import { withWindowListeners } from './window-listeners';

export function registerCanvasNoteHandlers(editor: Editor, bus: LiveKitBus): () => void {
  return withWindowListeners((add) => {
    const handleCreateNote = (event: Event) => {
      const detail = (event as CustomEvent).detail || {};
      const text: string = (detail.text || '').toString().trim() || 'Note';

      try {
        const viewport = editor.getViewportPageBounds();
        const x = viewport ? viewport.midX : 0;
        const y = viewport ? viewport.midY : 0;
        const noteId = createShapeId(`note-${nanoid()}`);
        editor.createShape({
          id: noteId,
          type: 'note' as any,
          x,
          y,
          props: { scale: 1 },
        } as any);
        try {
          editor.updateShapes([
            { id: noteId, type: 'note' as any, props: { richText: toRichText(text) } },
          ] as any);
        } catch {}
        try {
          editor.setEditingShape(noteId);
        } catch {}
        try {
          bus.send('editor_action', {
            type: 'create_note',
            shapeId: noteId,
            text,
            timestamp: Date.now(),
          });
        } catch {}
      } catch (err) {
        console.warn('[CanvasControl] create_note error', err);
      }
    };

    add('tldraw:create_note', handleCreateNote as EventListener);
  });
}
