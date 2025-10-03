import { Editor, toRichText } from '@tldraw/tldraw';
import type { CanvasEventMap } from './types';
import { toPlainText } from './rich-text';

interface SelectionHandlersDeps {
  editor: Editor;
}

function resolveTargetShapeId(editor: Editor, detail: Record<string, unknown>): string | undefined {
  const byId = typeof detail.shapeId === 'string' ? detail.shapeId : undefined;
  if (byId) return byId;

  const textRaw = detail.textContains ?? detail.contains;
  const text = textRaw ? String(textRaw) : '';
  if (text) {
    const query = text.toLowerCase();
    const notes = (editor.getCurrentPageShapes() as any[]).filter((shape) => shape.type === 'note');
    const match = notes.find((note) => toPlainText(note.props?.richText).toLowerCase().includes(query));
    if (match) return match.id as string;
  }

  return undefined;
}

function getSelectedCustomShapes(editor: Editor) {
  return (editor.getSelectedShapes() as any[]).filter((shape) => shape.type === 'custom');
}

function getNoteShapes(editor: Editor) {
  return (editor.getCurrentPageShapes() as any[]).filter((shape) => shape.type === 'note');
}

export function createCanvasSelectionHandlers({ editor }: SelectionHandlersDeps): CanvasEventMap {
  const handlePinSelected: EventListener = () => {
    try {
      const selected = getSelectedCustomShapes(editor);
      if (!selected.length) return;
      const viewport = editor.getViewportScreenBounds();
      const updates: any[] = [];

      for (const shape of selected) {
        const bounds = editor.getShapePageBounds(shape.id as any);
        if (!bounds) continue;
        const screenPoint = editor.pageToScreen({ x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h / 2 });
        const pinnedX = screenPoint.x / viewport.width;
        const pinnedY = screenPoint.y / viewport.height;
        updates.push({
          id: shape.id,
          type: shape.type as any,
          props: { pinned: true, pinnedX, pinnedY },
        });
      }

      if (updates.length) {
        editor.updateShapes(updates as any);
      }
    } catch (error) {
      console.warn('[CanvasControl] pin_selected error', error);
    }
  };

  const handleUnpinSelected: EventListener = () => {
    try {
      const selected = getSelectedCustomShapes(editor);
      if (!selected.length) return;
      const updates = selected.map((shape) => ({ id: shape.id, type: shape.type as any, props: { pinned: false } }));
      editor.updateShapes(updates as any);
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

  const handleSelect: EventListener = (event) => {
    try {
      const detail = (event as CustomEvent).detail || {};
      const nameQuery = (detail.nameContains as string | undefined)?.toLowerCase();
      const typeQuery = detail.type as string | undefined;
      const within = detail.withinBounds as { x: number; y: number; w: number; h: number } | undefined;

      const shapes = editor.getCurrentPageShapes().filter((shape: any) => {
        if (typeQuery && shape.type !== typeQuery) return false;
        if (nameQuery) {
          const name = (shape.props?.name || shape.props?.customComponent || shape.id || '')
            .toString()
            .toLowerCase();
          if (!name.includes(nameQuery)) return false;
        }
        if (within) {
          const bounds = editor.getShapePageBounds(shape.id as any);
          if (!bounds) return false;
          const inside =
            bounds.x >= within.x &&
            bounds.y >= within.y &&
            bounds.x + bounds.w <= within.x + within.w &&
            bounds.y + bounds.h <= within.y + within.h;
          if (!inside) return false;
        }
        return true;
      });

      const ids = shapes.map((shape: any) => shape.id);
      if (ids.length) {
        editor.select(ids as any);
        if ((editor as any).zoomToSelection) {
          (editor as any).zoomToSelection({ inset: 48 });
        }
      }
    } catch (error) {
      console.warn('[CanvasControl] select error', error);
    }
  };

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

  const handleDeleteShape: EventListener = (event) => {
    try {
      const detail = (event as CustomEvent).detail || {};
      const shapeId = resolveTargetShapeId(editor, detail);
      if (!shapeId) return;
      editor.deleteShapes([shapeId as any]);
    } catch (error) {
      console.warn('[CanvasControl] deleteShape error', error);
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
    'tldraw:pinSelected': handlePinSelected,
    'tldraw:unpinSelected': handleUnpinSelected,
    'tldraw:lockSelected': handleLockSelected,
    'tldraw:unlockSelected': handleUnlockSelected,
    'tldraw:arrangeGrid': handleArrangeGrid,
    'tldraw:alignSelected': handleAlignSelected,
    'tldraw:distributeSelected': handleDistributeSelected,
    'tldraw:select': handleSelect,
    'tldraw:selectNote': handleSelectNote,
    'tldraw:colorShape': handleColorShape,
    'tldraw:deleteShape': handleDeleteShape,
    'tldraw:renameNote': handleRenameNote,
  };
}
