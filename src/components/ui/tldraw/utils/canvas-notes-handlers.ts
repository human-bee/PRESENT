import { toRichText } from '@tldraw/tldraw';
import type { Editor } from '@tldraw/tldraw';
import type { CanvasEventMap } from './types';
import { getNoteShapes, resolveTargetShapeId } from './canvas-selection-shared';
import { toPlainText } from './rich-text';

interface NotesHandlersDeps {
  editor: Editor;
}

export function createCanvasNotesHandlers({ editor }: NotesHandlersDeps): CanvasEventMap {
  const handleSelectNote: EventListener = (event) => {
    try {
      const detail = (event as CustomEvent).detail || {};
      const query = String(detail.text || '').toLowerCase();
      if (!query) return;

      const notes = getNoteShapes(editor);
      const match = notes.find((note) => toPlainText(note.props?.richText).toLowerCase().includes(query));

      if (match) {
        editor.select([match.id] as any);
        if ((editor as any).zoomToSelection) {
          (editor as any).zoomToSelection({ inset: 64 });
        }
      }
    } catch (error) {
      console.warn('[CanvasControl] selectNote error', error);
    }
  };

  const handleColorShape: EventListener = (event) => {
    try {
      const detail = (event as CustomEvent).detail || {};
      const color = (detail.color || '').toString();
      if (!color) return;
      const shapeId = resolveTargetShapeId(editor, detail);
      if (!shapeId) return;
      const shape = editor.getShape(shapeId as any) as any;
      if (shape?.type === 'note') {
        editor.updateShapes([{ id: shape.id, type: 'note' as const, props: { color } }]);
      }
    } catch (error) {
      console.warn('[CanvasControl] colorShape error', error);
    }
  };

  const handleRenameNote: EventListener = (event) => {
    try {
      const detail = (event as CustomEvent).detail || {};
      const shapeId = resolveTargetShapeId(editor, detail);
      const text = (detail.text || '').toString();
      if (!shapeId || !text) return;
      const shape = editor.getShape(shapeId as any) as any;
      if (shape?.type === 'note') {
        editor.updateShapes([
          { id: shape.id, type: 'note' as const, props: { richText: toRichText(text) } },
        ]);
      }
    } catch (error) {
      console.warn('[CanvasControl] renameNote error', error);
    }
  };

  return {
    'tldraw:selectNote': handleSelectNote,
    'tldraw:colorShape': handleColorShape,
    'tldraw:renameNote': handleRenameNote,
  };
}
