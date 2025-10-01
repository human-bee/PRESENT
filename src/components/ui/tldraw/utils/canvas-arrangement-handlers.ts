import type { Editor } from 'tldraw';

import { withWindowListeners } from './window-listeners';

export function registerCanvasArrangementHandlers(editor: Editor): () => void {
  return withWindowListeners((add) => {
    const handlePinSelected = () => {
      try {
        const selected = editor.getSelectedShapes();
        if (!selected.length) return;
        const viewport = editor.getViewportScreenBounds();
        const updates: any[] = [];
        for (const s of selected) {
          if ((s as any).type !== 'custom') continue;
          const b = editor.getShapePageBounds((s as any).id);
          if (!b) continue;
          const screenPoint = editor.pageToScreen({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
          const pinnedX = screenPoint.x / viewport.width;
          const pinnedY = screenPoint.y / viewport.height;
          updates.push({
            id: (s as any).id,
            type: 'custom' as const,
            props: { pinned: true, pinnedX, pinnedY },
          });
        }
        if (updates.length) editor.updateShapes(updates);
      } catch (err) {
        console.warn('[CanvasControl] pin_selected error', err);
      }
    };

    const handleUnpinSelected = () => {
      try {
        const selected = editor.getSelectedShapes();
        const updates: any[] = [];
        for (const s of selected) {
          if ((s as any).type !== 'custom') continue;
          updates.push({ id: (s as any).id, type: 'custom' as const, props: { pinned: false } });
        }
        if (updates.length) editor.updateShapes(updates);
      } catch (err) {
        console.warn('[CanvasControl] unpin_selected error', err);
      }
    };

    const handleLockSelected = () => {
      try {
        const selected = editor.getSelectedShapes();
        if (!selected.length) return;
        const updates = selected.map((s: any) => ({ id: s.id, type: s.type, isLocked: true }));
        editor.updateShapes(updates as any);
      } catch (err) {
        console.warn('[CanvasControl] lock_selected error', err);
      }
    };

    const handleUnlockSelected = () => {
      try {
        const selected = editor.getSelectedShapes();
        if (!selected.length) return;
        const updates = selected.map((s: any) => ({ id: s.id, type: s.type, isLocked: false }));
        editor.updateShapes(updates as any);
      } catch (err) {
        console.warn('[CanvasControl] unlock_selected error', err);
      }
    };

    const handleArrangeGrid = (event: Event) => {
      try {
        const detail = (event as CustomEvent).detail || {};
        const selectionOnly = Boolean(detail.selectionOnly);
        const spacing = typeof detail.spacing === 'number' ? detail.spacing : 24;
        let targets = (editor.getSelectedShapes() as any[]).filter((s) => s.type === 'custom');
        if (!selectionOnly || targets.length === 0) {
          targets = (editor.getCurrentPageShapes() as any[]).filter((s) => s.type === 'custom');
        }
        if (targets.length === 0) return;

        const cols =
          detail.cols && Number.isFinite(detail.cols)
            ? Math.max(1, Math.floor(detail.cols))
            : Math.ceil(Math.sqrt(targets.length));
        const rows = Math.ceil(targets.length / cols);
        const sizes = targets.map((s) => ({ w: s.props?.w ?? 300, h: s.props?.h ?? 200 }));
        const maxW = Math.max(...sizes.map((s) => s.w));
        const maxH = Math.max(...sizes.map((s) => s.h));
        const viewport = editor.getViewportPageBounds();
        const totalW = cols * maxW + (cols - 1) * spacing;
        const totalH = rows * maxH + (rows - 1) * spacing;
        const left = viewport ? viewport.midX - totalW / 2 : 0;
        const top = viewport ? viewport.midY - totalH / 2 : 0;

        const updates: any[] = [];
        for (let i = 0; i < targets.length; i++) {
          const r = Math.floor(i / cols);
          const c = i % cols;
          const x = left + c * (maxW + spacing);
          const y = top + r * (maxH + spacing);
          updates.push({ id: targets[i].id, type: targets[i].type as any, x, y });
        }
        editor.updateShapes(updates as any);
      } catch (err) {
        console.warn('[CanvasControl] arrange_grid error', err);
      }
    };

    const handleAlignSelected = (event: Event) => {
      try {
        const detail = (event as CustomEvent).detail || {};
        const axis: 'x' | 'y' = detail.axis || 'x';
        const mode: string = detail.mode || (axis === 'x' ? 'center' : 'middle');
        const targets = (editor.getSelectedShapes() as any[]).filter((s) => s.type === 'custom');
        if (targets.length === 0) return;
        const bounds = targets
          .map((s) => ({ s, b: editor.getShapePageBounds(s.id) }))
          .filter((x) => !!x.b) as any[];
        if (!bounds.length) return;
        const minX = Math.min(...bounds.map((x) => x.b.x));
        const maxX = Math.max(...bounds.map((x) => x.b.x + x.b.w));
        const minY = Math.min(...bounds.map((x) => x.b.y));
        const maxY = Math.max(...bounds.map((x) => x.b.y + x.b.h));
        const cx = (minX + maxX) / 2;
        const cy = (minY + maxY) / 2;
        const updates: any[] = [];
        for (const { s, b } of bounds) {
          if (axis === 'x') {
            if (mode === 'left') updates.push({ id: s.id, type: s.type, x: minX });
            else if (mode === 'right') updates.push({ id: s.id, type: s.type, x: maxX - b.w });
            else updates.push({ id: s.id, type: s.type, x: cx - b.w / 2 });
          } else {
            if (mode === 'top') updates.push({ id: s.id, type: s.type, y: minY });
            else if (mode === 'bottom') updates.push({ id: s.id, type: s.type, y: maxY - b.h });
            else updates.push({ id: s.id, type: s.type, y: cy - b.h / 2 });
          }
        }
        if (updates.length) editor.updateShapes(updates as any);
      } catch (err) {
        console.warn('[CanvasControl] align_selected error', err);
      }
    };

    const handleDistributeSelected = (event: Event) => {
      try {
        const detail = (event as CustomEvent).detail || {};
        const axis: 'x' | 'y' = detail.axis || 'x';
        const targets = (editor.getSelectedShapes() as any[]).filter((s) => s.type === 'custom');
        if (targets.length < 3) return;
        const items = targets
          .map((s) => ({ s, b: editor.getShapePageBounds(s.id) }))
          .filter((x) => !!x.b) as any[];
        if (items.length < 3) return;
        items.sort((a, b) => (axis === 'x' ? a.b.x - b.b.x : a.b.y - b.b.y));
        const first = items[0];
        const last = items[items.length - 1];
        const span = axis === 'x' ? last.b.x - first.b.x : last.b.y - first.b.y;
        const step = span / (items.length - 1);
        const updates: any[] = [];
        for (let i = 1; i < items.length - 1; i++) {
          const targetPos = axis === 'x' ? first.b.x + step * i : first.b.y + step * i;
          if (axis === 'x') updates.push({ id: items[i].s.id, type: items[i].s.type, x: targetPos });
          else updates.push({ id: items[i].s.id, type: items[i].s.type, y: targetPos });
        }
        if (updates.length) editor.updateShapes(updates as any);
      } catch (err) {
        console.warn('[CanvasControl] distribute_selected error', err);
      }
    };

    add('tldraw:pinSelected', handlePinSelected as EventListener);
    add('tldraw:unpinSelected', handleUnpinSelected as EventListener);
    add('tldraw:lockSelected', handleLockSelected as EventListener);
    add('tldraw:unlockSelected', handleUnlockSelected as EventListener);
    add('tldraw:arrangeGrid', handleArrangeGrid as EventListener);
    add('tldraw:alignSelected', handleAlignSelected as EventListener);
    add('tldraw:distributeSelected', handleDistributeSelected as EventListener);
  });
}
