import type { Editor } from '@tldraw/tldraw';
import { toRichText } from '@tldraw/tldraw';
import type { AgentActionEnvelope, AgentAction } from '@/lib/agents/canvas-agent/shared/types';


type ApplyContext = {
  editor: Editor;
  isHost: boolean;
  appliedIds: Set<string>;
};

export function applyEnvelope(ctx: ApplyContext, envelope: AgentActionEnvelope) {
  const sessionScoped = `${envelope.sessionId}::`;
  for (const action of envelope.actions) {
    const key = sessionScoped + action.id;
    if (ctx.appliedIds.has(key)) continue;
    applyAction(ctx, action);
    ctx.appliedIds.add(key);
  }
}

export function applyAction(ctx: ApplyContext, action: AgentAction) {
  const { editor } = ctx;
  const withPrefix = (sid: string) => (typeof sid === 'string' && sid.startsWith('shape:') ? sid : `shape:${sid}`);
  const withPrefixes = (sids: string[]) => (Array.isArray(sids) ? sids.map(withPrefix) : []);

  const normalizeCreate = (shape: { id?: string; type?: string; x?: number; y?: number; props?: Record<string, unknown> }) => {
    const id = withPrefix(shape.id || `ag_${Date.now().toString(36)}`);
    const rawType = String(shape.type || '').toLowerCase();
    const props: Record<string, unknown> = { ...(shape.props || {}) };
    const x = typeof shape.x === 'number' ? shape.x : undefined;
    const y = typeof shape.y === 'number' ? shape.y : undefined;

    const geoKinds = new Set(['rectangle', 'ellipse', 'triangle', 'diamond', 'rhombus', 'hexagon', 'star']);
    if (geoKinds.has(rawType)) {
      return { id, type: 'geo', x, y, props: { ...props, geo: rawType } } as const;
    }
    if (rawType === 'note') {
      // Map note → text; strip unsupported props.text
      const nextProps = { ...props } as any;
      if ('text' in nextProps) delete (nextProps as any).text;
      return { id, type: 'text', x, y, props: nextProps } as const;
    }
    if (rawType === 'text') {
      // Strip unsupported props.text; TLDraw v4 uses richText internally
      const nextProps = { ...props } as any;
      if ('text' in nextProps) delete (nextProps as any).text;
      return { id, type: 'text', x, y, props: nextProps } as const;
    }
    if (rawType === 'arrow') {
      return { id, type: 'arrow', x, y, props } as const;
    }
    if (rawType === 'draw' || rawType === 'pen') {
      return { id, type: 'draw', x, y, props } as const;
    }
    return { id, type: shape.type || 'geo', x, y, props } as const;
  };

  switch (action.name) {
    case 'create_shape': {
      const { id, type, x, y, props } = action.params as any;
      const rawType = String(type || '').toLowerCase();
      const textContent = String((props?.text ?? props?.label ?? props?.content ?? '') || '');
      const normalized = normalizeCreate({ id, type, x, y, props });
      try { editor.createShape(normalized as any); } catch {}
      if ((rawType === 'note' || rawType === 'text') && textContent) {
        try {
          const sid = withPrefix(id);
          editor.updateShapes([
            {
              id: sid as any,
              type: 'text' as any,
              props: { richText: toRichText(textContent) },
            } as any,
          ]);
        } catch {}
      }
      break;
    }
    case 'update_shape': {
      const { id, props } = action.params as any;
      const sid = withPrefix(id);
      try { editor.updateShapes([{ id: sid as any, type: editor.getShape(sid as any)?.type as any, props: props || {} }]); } catch {}
      break;
    }
    case 'delete_shape': {
      const { ids } = action.params as any;
      try { editor.deleteShapes(withPrefixes(ids) as any); } catch {}
      break;
    }
    case 'move': {
      const { ids, dx, dy } = action.params as any;
      try {
        const shapes = withPrefixes(ids as string[]);
        for (const id of shapes) {
          const shape = editor.getShape(id as any) as any;
          if (!shape) continue;
          const nextX = (shape.x ?? 0) + (dx || 0);
          const nextY = (shape.y ?? 0) + (dy || 0);
          editor.updateShapes([{ id: id as any, type: shape.type as any, x: nextX, y: nextY } as any]);
        }
      } catch {}
      break;
    }
    case 'resize': {
      try {
        const { id, w, h } = action.params as any;
        if (!id || typeof w !== 'number' || typeof h !== 'number') break;
        const sid = withPrefix(id);
        const shape = editor.getShape(sid as any) as any;
        if (!shape) break;
        if (shape.type === 'geo' || shape.type === 'text') {
          editor.updateShapes([
            { id: sid as any, type: shape.type as any, props: { ...(shape.props ?? {}), w, h } },
          ]);
        } else if (typeof editor.fitBoundsToContent === 'function') {
          editor.fitBoundsToContent?.([sid] as any, { w, h });
        } else {
          editor.updateShapes([
            { id: sid as any, type: shape.type as any, props: { ...(shape.props ?? {}), w, h } },
          ]);
        }
      } catch {}
      break;
    }
    case 'rotate': {
      try {
        const { ids, angle } = action.params as any;
        const shapeIds = (withPrefixes(ids as string[]) as any[]);
        editor.rotateShapesBy(shapeIds as any, angle, undefined as any);
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
    case 'align':
      try {
        const { ids, mode } = action.params as any;
        editor.alignShapes((withPrefixes(ids as string[]) as any[]), mode);
      } catch {}
      break;
    case 'distribute':
      try {
        const { ids, axis } = action.params as any;
        editor.distributeShapes((withPrefixes(ids as string[]) as any[]), axis);
      } catch {}
      break;
    case 'stack':
      try {
        const { ids, direction, gap } = action.params as any;
        editor.stackShapes((withPrefixes(ids as string[]) as any[]), direction, gap ?? 0);
      } catch {}
      break;
    case 'reorder':
      try {
        const { ids, mode } = action.params as any;
        const mapped = (withPrefixes(ids as string[]) as any[]);
        if (mode === 'bring_to_front') editor.bringToFront(mapped as any);
        else if (mode === 'send_to_back') editor.sendToBack(mapped as any);
        else if (mode === 'forward') editor.bringForward(mapped as any);
        else if (mode === 'backward') editor.sendBackward(mapped as any);
      } catch {}
      break;
    case 'set_viewport': {
      if (!ctx.isHost) break;
      const { bounds } = action.params as any;
      try {
        if (bounds) {
          editor.zoomToBounds(bounds, { inset: 32, animation: { duration: 120 } });
        }
      } catch {}
      break;
    }
    case 'draw_pen': {
      try {
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
        editor.createShape?.({
          id: shapeId as any,
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
      } catch {}
      break;
    }
    case 'think':
    case 'todo':
    case 'add_detail':
    default:
      break;
  }
}
