import type { Editor } from '@tldraw/tldraw';
import type { CanvasEventMap } from './types';
import { getSelectedCustomShapes } from './canvas-selection-shared';

interface ArrangementHandlersDeps {
  editor: Editor;
}

export function createCanvasArrangementHandlers({ editor }: ArrangementHandlersDeps): CanvasEventMap {
  const handleArrangeGrid: EventListener = (event) => {
    try {
      const detail = (event as CustomEvent).detail || {};
      const selectionOnly = Boolean(detail.selectionOnly);
      const spacing = typeof detail.spacing === 'number' ? detail.spacing : 24;
      let targets = getSelectedCustomShapes(editor);

      if (!selectionOnly || targets.length === 0) {
        targets = (editor.getCurrentPageShapes() as any[]).filter((shape) => shape.type === 'custom');
      }

      if (!targets.length) return;

      const cols =
        typeof detail.cols === 'number' && Number.isFinite(detail.cols)
          ? Math.max(1, Math.floor(detail.cols))
          : Math.ceil(Math.sqrt(targets.length));
      const rows = Math.ceil(targets.length / cols);
      const sizes = targets.map((shape) => ({ w: shape.props?.w ?? 300, h: shape.props?.h ?? 200 }));
      const maxW = Math.max(...sizes.map((s) => s.w));
      const maxH = Math.max(...sizes.map((s) => s.h));
      const viewport = editor.getViewportPageBounds();
      const totalW = cols * maxW + (cols - 1) * spacing;
      const totalH = rows * maxH + (rows - 1) * spacing;
      const left = viewport ? viewport.midX - totalW / 2 : 0;
      const top = viewport ? viewport.midY - totalH / 2 : 0;

      const updates: any[] = [];
      for (let i = 0; i < targets.length; i++) {
        const row = Math.floor(i / cols);
        const col = i % cols;
        const x = left + col * (maxW + spacing);
        const y = top + row * (maxH + spacing);
        updates.push({ id: targets[i].id, type: targets[i].type as any, x, y });
      }

      editor.updateShapes(updates as any);
    } catch (error) {
      console.warn('[CanvasControl] arrange_grid error', error);
    }
  };

  const handleAlignSelected: EventListener = (event) => {
    try {
      const detail = (event as CustomEvent).detail || {};
      const axis: 'x' | 'y' = detail.axis || 'x';
      const mode: string = detail.mode || (axis === 'x' ? 'center' : 'middle');

      const targets = getSelectedCustomShapes(editor);
      if (!targets.length) return;

      const withBounds = targets
        .map((shape) => ({ shape, bounds: editor.getShapePageBounds(shape.id as any) }))
        .filter((entry): entry is { shape: any; bounds: any } => Boolean(entry.bounds));

      if (!withBounds.length) return;

      const minX = Math.min(...withBounds.map((entry) => entry.bounds.x));
      const maxX = Math.max(...withBounds.map((entry) => entry.bounds.x + entry.bounds.w));
      const minY = Math.min(...withBounds.map((entry) => entry.bounds.y));
      const maxY = Math.max(...withBounds.map((entry) => entry.bounds.y + entry.bounds.h));
      const centerX = (minX + maxX) / 2;
      const centerY = (minY + maxY) / 2;

      const updates: any[] = [];
      for (const { shape, bounds } of withBounds) {
        if (axis === 'x') {
          if (mode === 'left') updates.push({ id: shape.id, type: shape.type, x: minX });
          else if (mode === 'right') updates.push({ id: shape.id, type: shape.type, x: maxX - bounds.w });
          else updates.push({ id: shape.id, type: shape.type, x: centerX - bounds.w / 2 });
        } else {
          if (mode === 'top') updates.push({ id: shape.id, type: shape.type, y: minY });
          else if (mode === 'bottom') updates.push({ id: shape.id, type: shape.type, y: maxY - bounds.h });
          else updates.push({ id: shape.id, type: shape.type, y: centerY - bounds.h / 2 });
        }
      }

      if (updates.length) {
        editor.updateShapes(updates as any);
      }
    } catch (error) {
      console.warn('[CanvasControl] align_selected error', error);
    }
  };

  const handleDistributeSelected: EventListener = (event) => {
    try {
      const detail = (event as CustomEvent).detail || {};
      const axis: 'x' | 'y' = detail.axis || 'x';
      const targets = getSelectedCustomShapes(editor);
      if (targets.length < 3) return;

      const items = targets
        .map((shape) => ({ shape, bounds: editor.getShapePageBounds(shape.id as any) }))
        .filter((entry): entry is { shape: any; bounds: any } => Boolean(entry.bounds));

      if (items.length < 3) return;

      items.sort((a, b) => (axis === 'x' ? a.bounds.x - b.bounds.x : a.bounds.y - b.bounds.y));
      const first = items[0];
      const last = items[items.length - 1];
      const span = axis === 'x' ? last.bounds.x - first.bounds.x : last.bounds.y - first.bounds.y;
      const step = span / (items.length - 1);

      const updates: any[] = [];
      for (let i = 1; i < items.length - 1; i++) {
        const targetPos = axis === 'x' ? first.bounds.x + step * i : first.bounds.y + step * i;
        if (axis === 'x') updates.push({ id: items[i].shape.id, type: items[i].shape.type, x: targetPos });
        else updates.push({ id: items[i].shape.id, type: items[i].shape.type, y: targetPos });
      }

      if (updates.length) {
        editor.updateShapes(updates as any);
      }
    } catch (error) {
      console.warn('[CanvasControl] distribute_selected error', error);
    }
  };

  return {
    'tldraw:arrangeGrid': handleArrangeGrid,
    'tldraw:alignSelected': handleAlignSelected,
    'tldraw:distributeSelected': handleDistributeSelected,
  };
}
