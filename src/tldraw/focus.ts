import { Box, type Editor, type TLShapeId } from 'tldraw';

/** Frame content inside the usable canvas, including the quiet room overlays. */
export function fitCanvas(editor: Editor, ids: TLShapeId[] = [], duration = 220, select = true) {
  const targets = ids.filter(id => editor.getShape(id));
  if (targets.length && select) editor.setSelectedShapes(targets);
  const boxes = targets.flatMap(id => { const box = editor.getShapePageBounds(id); return box ? [box] : []; });
  const bounds = boxes.length ? Box.Common(boxes) : editor.getCurrentPageBounds();
  if (!bounds?.w || !bounds.h) return;
  const screen = editor.getViewportScreenBounds(), narrow = screen.w < 650;
  const inset = { left: narrow ? 58 : 96, right: narrow ? 20 : 40, top: narrow ? 126 : 150, bottom: narrow ? 188 : 195 };
  const width = Math.max(100, screen.w - inset.left - inset.right), height = Math.max(100, screen.h - inset.top - inset.bottom);
  const z = Math.max(.05, Math.min(1.25, width / bounds.w, height / bounds.h));
  editor.setCamera({ x: (inset.left + (width - bounds.w * z) / 2) / z - bounds.x,
    y: (inset.top + (height - bounds.h * z) / 2) / z - bounds.y, z }, { animation: { duration } });
}

export async function focusResult(editor: Editor, ids: TLShapeId[], select = true) {
  const started = performance.now();
  while (performance.now() - started < 1500) {
    if (ids.some(id => editor.getShape(id))) { fitCanvas(editor, ids, 220, select); return; }
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  }
}
