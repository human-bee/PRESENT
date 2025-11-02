import type { Editor } from '@tldraw/tldraw';
import { toRichText } from '@tldraw/tldraw';
import { ACTION_VERSION, type AgentAction, type AgentActionEnvelope } from '@/lib/agents/canvas-agent/shared/types';

type ApplyContext = {
  editor: Editor;
  isHost: boolean;
  appliedIds: Set<string>;
};

type BatchCollector = {
  creates: any[];
  updates: any[];
  deletes: Set<string>;
};

const withPrefix = (sid: string) => (typeof sid === 'string' && sid.startsWith('shape:') ? sid : `shape:${sid}`);
const withPrefixes = (sids: string[]) => (Array.isArray(sids) ? sids.map(withPrefix) : []);

const fallbackNumber = (value: unknown, fallback = 0) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);

type ShapeSnapshot = { id: string; type: string; x: number; y: number; w: number; h: number };

function getShapeSnapshot(editor: Editor, shapeId: string): ShapeSnapshot | null {
  const shape = editor.getShape?.(shapeId as any) as any;
  if (!shape) return null;
  const w = fallbackNumber(shape.w ?? shape?.props?.w, fallbackNumber(shape?.props?.width));
  const h = fallbackNumber(shape.h ?? shape?.props?.h, fallbackNumber(shape?.props?.height));
  return {
    id: shapeId,
    type: shape.type ?? 'geo',
    x: fallbackNumber(shape.x),
    y: fallbackNumber(shape.y),
    w: w > 0 ? w : 0,
    h: h > 0 ? h : 0,
  };
}

function alignShapes(editor: Editor, ids: string[], axis: 'x' | 'y', mode: 'start' | 'center' | 'end', collect: BatchCollector) {
  const snapshots = ids
    .map((id) => getShapeSnapshot(editor, withPrefix(id)))
    .filter((snapshot): snapshot is ShapeSnapshot => Boolean(snapshot));
  if (snapshots.length < 2) return;

  const minX = Math.min(...snapshots.map((s) => s.x));
  const maxX = Math.max(...snapshots.map((s) => s.x + s.w));
  const minY = Math.min(...snapshots.map((s) => s.y));
  const maxY = Math.max(...snapshots.map((s) => s.y + s.h));
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;

  for (const snapshot of snapshots) {
    let nx = snapshot.x;
    let ny = snapshot.y;
    if (axis === 'x') {
      if (mode === 'start') nx = minX;
      if (mode === 'center') nx = centerX - snapshot.w / 2;
      if (mode === 'end') nx = maxX - snapshot.w;
    } else {
      if (mode === 'start') ny = minY;
      if (mode === 'center') ny = centerY - snapshot.h / 2;
      if (mode === 'end') ny = maxY - snapshot.h;
    }
    if (Math.abs(nx - snapshot.x) > 0.01 || Math.abs(ny - snapshot.y) > 0.01) {
      collect.updates.push({ id: snapshot.id, type: snapshot.type, x: nx, y: ny });
    }
  }
}

function distributeShapes(editor: Editor, ids: string[], axis: 'x' | 'y', collect: BatchCollector) {
  const prefixedIds = withPrefixes(ids);
  if (typeof editor.distributeShapes === 'function') {
    try {
      editor.distributeShapes(prefixedIds as any, axis === 'x' ? 'horizontal' : 'vertical');
      return;
    } catch {}
  }

  const snapshots = prefixedIds
    .map((id) => getShapeSnapshot(editor, id))
    .filter((snapshot): snapshot is ShapeSnapshot => Boolean(snapshot));
  if (snapshots.length < 3) return;

  const dimension: 'x' | 'y' = axis === 'x' ? 'x' : 'y';
  const extent: 'w' | 'h' = axis === 'x' ? 'w' : 'h';
  const sorted = snapshots.slice().sort((a, b) => a[dimension] - b[dimension]);
  const first = sorted[0];
  const startEdge = first[dimension];
  const endEdge = sorted.reduce((max, snapshot) => {
    const trailingEdge = snapshot[dimension] + snapshot[extent];
    return trailingEdge > max ? trailingEdge : max;
  }, Number.NEGATIVE_INFINITY);
  const gaps = sorted.length - 1;
  if (!Number.isFinite(startEdge) || !Number.isFinite(endEdge) || gaps <= 0) return;

  const totalExtent = sorted.reduce((sum, snapshot) => sum + snapshot[extent], 0);
  const available = endEdge - startEdge - totalExtent;
  if (!Number.isFinite(available)) return;
  const gap = available / gaps;

  let cursor = startEdge;
  for (const snapshot of sorted) {
    const target = cursor;
    if (axis === 'x') {
      if (Math.abs(target - snapshot.x) > 0.01) {
        collect.updates.push({ id: snapshot.id, type: snapshot.type, x: target });
      }
    } else {
      if (Math.abs(target - snapshot.y) > 0.01) {
        collect.updates.push({ id: snapshot.id, type: snapshot.type, y: target });
      }
    }
    cursor = target + snapshot[extent] + gap;
  }
}

function stackShapes(editor: Editor, ids: string[], direction: 'row' | 'column', gap: number, collect: BatchCollector) {
  const snapshots = ids
    .map((id) => getShapeSnapshot(editor, withPrefix(id)))
    .filter((snapshot): snapshot is ShapeSnapshot => Boolean(snapshot));
  if (snapshots.length < 2) return;

  const sorted = snapshots.slice().sort((a, b) => (direction === 'row' ? a.x - b.x : a.y - b.y));
  let cursorX = direction === 'row' ? Math.min(...sorted.map((s) => s.x)) : 0;
  let cursorY = direction === 'column' ? Math.min(...sorted.map((s) => s.y)) : 0;

  for (let i = 0; i < sorted.length; i++) {
    const snapshot = sorted[i];
    const nx = direction === 'row' ? cursorX : snapshot.x;
    const ny = direction === 'column' ? cursorY : snapshot.y;
    if (Math.abs(nx - snapshot.x) > 0.01 || Math.abs(ny - snapshot.y) > 0.01) {
      collect.updates.push({ id: snapshot.id, type: snapshot.type, x: nx, y: ny });
    }
    if (direction === 'row') {
      cursorX = nx + snapshot.w + gap;
    } else {
      cursorY = ny + snapshot.h + gap;
    }
  }
}

function mergeUpdates(updates: any[]) {
  if (updates.length === 0) return [];
  const byId = new Map<string, any>();
  for (const update of updates) {
    const prev = byId.get(update.id);
    if (!prev) {
      byId.set(update.id, { ...update, props: update.props ? { ...update.props } : undefined });
      continue;
    }
    const next = { ...prev, ...update };
    if (prev.props || update.props) {
      next.props = { ...(prev.props ?? {}), ...(update.props ?? {}) };
    }
    byId.set(update.id, next);
  }
  return Array.from(byId.values());
}

function flushBatch(editor: Editor, batch: BatchCollector) {
  if (batch.creates.length > 0) {
    if (typeof (editor as any).createShapes === 'function') {
      try {
        (editor as any).createShapes(batch.creates);
      } catch {
        batch.creates.forEach((shape) => editor.createShape?.(shape));
      }
    } else {
      batch.creates.forEach((shape) => editor.createShape?.(shape));
    }
  }
  if (batch.updates.length > 0) {
    const updates = mergeUpdates(batch.updates);
    if (updates.length > 0) {
      editor.updateShapes?.(updates);
    }
  }
  if (batch.deletes.size > 0) {
    const ids = Array.from(batch.deletes);
    if (ids.length > 0) editor.deleteShapes?.(ids as any);
  }
}

function normalizeCreate(shape: { id?: string; type?: string; x?: number; y?: number; props?: Record<string, unknown> }) {
  const id = withPrefix(shape.id || `ag_${Date.now().toString(36)}`);
  const rawType = String(shape.type || '').toLowerCase();
  const props: Record<string, unknown> = { ...(shape.props || {}) };
  const x = typeof shape.x === 'number' ? shape.x : undefined;
  const y = typeof shape.y === 'number' ? shape.y : undefined;

  const geoKinds = new Set(['rectangle', 'ellipse', 'triangle', 'diamond', 'rhombus', 'hexagon', 'star']);
  if (geoKinds.has(rawType)) {
    return { id, type: 'geo', x, y, props: { ...props, geo: rawType } };
  }
  if (rawType === 'note' || rawType === 'text') {
    const nextProps = { ...props };
    if ('text' in nextProps) delete (nextProps as any).text;
    return { id, type: 'text', x, y, props: nextProps };
  }
  if (rawType === 'arrow') {
    return { id, type: 'arrow', x, y, props };
  }
  if (rawType === 'draw' || rawType === 'pen') {
    return { id, type: 'draw', x, y, props };
  }
  return { id, type: shape.type || 'geo', x, y, props };
}

export function applyEnvelope(ctx: ApplyContext, envelope: AgentActionEnvelope) {
  if (!envelope || envelope.v !== ACTION_VERSION || !Array.isArray(envelope.actions)) return;
  const sessionScoped = `${envelope.sessionId}::`;
  const batch: BatchCollector = { creates: [], updates: [], deletes: new Set<string>() };

  for (const action of envelope.actions) {
    const key = sessionScoped + action.id;
    if (ctx.appliedIds.has(key)) continue;
    applyAction(ctx, action, batch);
    ctx.appliedIds.add(key);
  }

  flushBatch(ctx.editor, batch);
}

export function applyAction(ctx: ApplyContext, action: AgentAction, batch?: BatchCollector) {
  const { editor } = ctx;
  const localBatch = batch ?? { creates: [], updates: [], deletes: new Set<string>() };
  const useLocal = !batch;
  let mutated = false;

  switch (action.name) {
    case 'create_shape': {
      const { id, type, x, y, props } = action.params as any;
      const normalized = normalizeCreate({ id, type, x, y, props });
      localBatch.creates.push(normalized);
      mutated = true;

      const rawType = String(type || '').toLowerCase();
      const textContent = String((props?.text ?? props?.label ?? props?.content ?? '') || '');
      if ((rawType === 'note' || rawType === 'text') && textContent) {
        localBatch.updates.push({
          id: normalized.id,
          type: 'text',
          props: { richText: toRichText(textContent) },
        });
      }
      break;
    }
    case 'update_shape': {
      const { id, props } = action.params as any;
      const sid = withPrefix(id);
      const shape = editor.getShape?.(sid as any) as any;
      if (!shape) break;
      localBatch.updates.push({ id: sid, type: shape.type ?? 'geo', props: props || {} });
      mutated = true;
      break;
    }
    case 'delete_shape': {
      const { ids } = action.params as any;
      withPrefixes(ids as string[]).forEach((sid) => localBatch.deletes.add(sid));
      mutated = true;
      break;
    }
    case 'move': {
      const { ids, dx, dy } = action.params as any;
      for (const sid of withPrefixes(ids as string[])) {
        const snapshot = getShapeSnapshot(editor, sid);
        if (!snapshot) continue;
        const nx = snapshot.x + (dx || 0);
        const ny = snapshot.y + (dy || 0);
        localBatch.updates.push({ id: snapshot.id, type: snapshot.type, x: nx, y: ny });
        mutated = true;
      }
      break;
    }
    case 'resize': {
      const { id, w, h } = action.params as any;
      if (typeof w !== 'number' || typeof h !== 'number') break;
      const sid = withPrefix(id);
      const shape = editor.getShape?.(sid as any) as any;
      if (!shape) break;
      if (shape.type === 'geo' || shape.type === 'text') {
        localBatch.updates.push({
          id: sid,
          type: shape.type,
          props: { ...(shape.props ?? {}), w, h },
        });
        mutated = true;
      } else if (typeof editor.fitBoundsToContent === 'function') {
        try {
          editor.fitBoundsToContent?.([sid] as any, { w, h });
        } catch {}
      } else {
        localBatch.updates.push({
          id: sid,
          type: shape.type,
          props: { ...(shape.props ?? {}), w, h },
        });
        mutated = true;
      }
      break;
    }
    case 'rotate': {
      const { ids, angle } = action.params as any;
      try {
        editor.rotateShapesBy(withPrefixes(ids as string[]) as any, angle, undefined as any);
      } catch {}
      break;
    }
    case 'group': {
      try { editor.groupShapes(withPrefixes((action.params as any).ids) as any); } catch {}
      break;
    }
    case 'ungroup': {
      try { editor.ungroupShapes([withPrefix((action.params as any).id)] as any); } catch {}
      break;
    }
    case 'align': {
      const { ids, axis, mode } = action.params as any;
      if (axis === 'x' || axis === 'y') {
        const normalizedMode: 'start' | 'center' | 'end' = mode === 'end' ? 'end' : mode === 'center' ? 'center' : 'start';
        alignShapes(editor, ids as string[], axis, normalizedMode, localBatch);
        mutated = true;
      }
      break;
    }
    case 'distribute': {
      const { ids, axis } = action.params as any;
      if (axis === 'x' || axis === 'y') {
        distributeShapes(editor, ids as string[], axis, localBatch);
        mutated = true;
      }
      break;
    }
    case 'stack': {
      const { ids, direction, gap } = action.params as any;
      if (direction === 'row' || direction === 'column') {
        stackShapes(editor, ids as string[], direction, typeof gap === 'number' ? gap : 16, localBatch);
        mutated = true;
      }
      break;
    }
    case 'reorder': {
      const { ids, where } = action.params as any;
      const shapeIds = withPrefixes(ids as string[]);
      try {
        if (where === 'front') editor.bringToFront?.(shapeIds as any);
        else if (where === 'back') editor.sendToBack?.(shapeIds as any);
        else if (where === 'forward') editor.bringForward?.(shapeIds as any);
        else if (where === 'backward') editor.sendBackward?.(shapeIds as any);
      } catch {}
      break;
    }
    case 'set_viewport': {
      if (!ctx.isHost) break;
      const { bounds } = action.params as any;
      if (bounds) {
        try {
          editor.zoomToBounds(bounds, { inset: 32, animation: { duration: 120 } });
        } catch {}
      }
      break;
    }
    case 'draw_pen': {
      const { points, x = 0, y = 0, id } = (action.params as any) || {};
      if (!Array.isArray(points) || points.length === 0) break;
      const shapeId = withPrefix(id || editor.createShapeId?.() || `pen-${Date.now().toString(36)}`);
      const segment = {
        type: 'free',
        points: points.map((p: any, index: number) => ({
          x: Number(p?.x) || 0,
          y: Number(p?.y) || 0,
          z: typeof p?.z === 'number' ? p.z : index === 0 ? 0.5 : 0.6,
        })),
      };
      localBatch.creates.push({
        id: shapeId,
        type: 'draw',
        x: Number(x) || 0,
        y: Number(y) || 0,
        props: {
          color: 'black',
          fill: 'none',
          dash: 'solid',
          size: 'm',
          segments: [segment],
          isComplete: true,
          isClosed: false,
          isPen: false,
          scale: 1,
        },
      });
      mutated = true;
      break;
    }
    case 'think':
    case 'todo':
    case 'add_detail':
    default:
      break;
  }

  if (useLocal && mutated) {
    flushBatch(editor, localBatch);
  }
}
