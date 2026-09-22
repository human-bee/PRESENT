import type { CanvasViewContext } from '../../shared/canvas-commands';
/** Place beside an explicit semantic anchor, otherwise the current selection. */
export function voicePlacement(view: CanvasViewContext | null, args: Record<string, unknown>) {
  if (!view) return undefined;
  const anchor = typeof args.nearObjectId === 'string' ? args.nearObjectId.replace(/^shape:/, '') : null;
  const selected = new Set(view.selectedIds.map(id => id.replace(/^shape:/, '')));
  const targets = view.shapes.filter(shape => anchor ? shape.id.replace(/^shape:/, '') === anchor : selected.has(shape.id.replace(/^shape:/, '')));
  if (anchor && !targets.length) throw new Error('Placement anchor is outside the current observation. Read the target canvas region before placing.');
  const bounds = targets.flatMap(shape => shape.bounds ? [shape.bounds] : []);
  if (!bounds.length) return { x: view.viewport.x + view.viewport.w / 2 - 140, y: view.viewport.y + view.viewport.h / 2 - 115 };
  const x = Math.min(...bounds.map(b => b.x)), y = Math.min(...bounds.map(b => b.y));
  const right = Math.max(...bounds.map(b => b.x + b.w)), bottom = Math.max(...bounds.map(b => b.y + b.h));
  const point = args.side === 'below' ? { x, y: bottom + 32 } : { x: right + 32, y };
  // Reserve a conservative card rectangle; never move existing human shapes.
  for (let n = 0; n < 40; n++) {
    const collision = view.shapes.find(shape => shape.bounds && point.x < shape.bounds.x + shape.bounds.w && point.x + 560 > shape.bounds.x && point.y < shape.bounds.y + shape.bounds.h && point.y + 350 > shape.bounds.y);
    if (!collision?.bounds) break;
    point.y = collision.bounds.y + collision.bounds.h + 32;
  }
  return point;
}
