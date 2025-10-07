import { toPlainText } from './rich-text';
import type { Editor } from 'tldraw';

export function resolveTargetShapeId(
  editor: Editor,
  detail: Record<string, unknown>,
): string | undefined {
  const byId = typeof detail.shapeId === 'string' ? detail.shapeId : undefined;
  if (byId) return byId;

  const textRaw = detail.textContains ?? detail.contains;
  const text = textRaw ? String(textRaw) : '';
  if (text) {
    const query = text.toLowerCase();
    const notes = getNoteShapes(editor);
    const match = notes.find((note) => toPlainText(note.props?.richText).toLowerCase().includes(query));
    if (match) return match.id as string;
  }

  return undefined;
}

export function getSelectedCustomShapes(editor: Editor) {
  return (editor.getSelectedShapes() as any[]).filter((shape) => shape.type === 'custom');
}

export function getNoteShapes(editor: Editor) {
  return (editor.getCurrentPageShapes() as any[]).filter((shape) => shape.type === 'note');
}
