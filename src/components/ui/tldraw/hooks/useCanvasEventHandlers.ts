/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useRef } from 'react';
import { Editor, createShapeId, toRichText } from '@tldraw/tldraw';
import { nanoid } from 'nanoid';
import { Room } from 'livekit-client';
import { createLiveKitBus } from '@/lib/livekit/livekit-bus';
import { normalizeMermaidText, getMermaidLastNode } from '@/components/TO BE REFACTORED/tool-dispatcher';

const STEWARD_FLOWCHART =
  typeof process !== 'undefined' && process.env.NEXT_PUBLIC_STEWARD_FLOWCHART_ENABLED === 'true';

function renderPlaintextFromRichText(_editor: any, richText: any | undefined): string {
  try {
    if (!richText) return '';
    if (typeof richText === 'string') return richText;
    if (Array.isArray(richText)) return richText.map((n: any) => (typeof n === 'string' ? n : n?.text || '')).join(' ');
    return String(richText?.text || '');
  } catch {
    return '';
  }
}

/**
 * Sets up all canvas event handlers for TLDraw integration
 * @param editor - TLDraw editor instance
 * @param room - LiveKit room instance
 * @param containerRef - Reference to the container element for grid/theme/background controls
 * @returns Cleanup function
 */
export function useCanvasEventHandlers(
  editor: Editor | null,
  room: Room | undefined,
  containerRef: React.RefObject<HTMLDivElement>,
  options?: { enabled?: boolean },
) {
  const { enabled = true } = options ?? {};
  const lastTsByShape = useRef(new Map<string, number>());

  useEffect(() => {
    if (!enabled || !editor || !room) return;

    const bus = createLiveKitBus(room);

    // Mermaid helper functions
    const registerMermaidHandler = (flag: string, event: string, handler: EventListener) => {
      const g: any = window as any;
      const existing = g[flag] as EventListener | undefined;
      if (existing) {
        window.removeEventListener(event, existing);
      }
      window.addEventListener(event, handler);
      g[flag] = handler;
      return handler;
    };

    const removeMermaidHandler = (flag: string, event: string) => {
      const g: any = window as any;
      const existing = g[flag] as EventListener | undefined;
      if (existing) {
        window.removeEventListener(event, existing);
        delete g[flag];
      }
    };

    const updateMermaidSession = (normalizedText: string, lastOverride?: string) => {
      if (STEWARD_FLOWCHART) return;
      try {
        const g: any = window as any;
        g.__present_mermaid_session = {
          text: normalizedText,
          last: typeof lastOverride === 'string' ? lastOverride : getMermaidLastNode(normalizedText),
        };
      } catch {}
    };

    // LiveKit bus ui_update handler for mermaid_stream shapes
    const offUiUpdate = bus.on('ui_update', (msg: any) => {
      try {
        if (!msg || typeof msg !== 'object') return;
        const componentId = String(msg.componentId || '');
        const patch = (msg.patch || {}) as Record<string, unknown>;
        const ts = typeof msg.timestamp === 'number' ? msg.timestamp : Date.now();
        if (!componentId || !patch) return;

        const shape = editor.getShape(componentId as any) as any;
        if (!shape || shape.type !== 'mermaid_stream') return;

        const last = lastTsByShape.current.get(componentId) || 0;
        if (ts < last) return; // drop stale
        lastTsByShape.current.set(componentId, ts);

        const nextProps: Record<string, unknown> = {};
        if (STEWARD_FLOWCHART) {
          const doc = (patch as any).flowchartDoc as string | undefined;
          const formatRaw = (patch as any).format as string | undefined;
          const format = typeof formatRaw === 'string' ? formatRaw.toLowerCase() : undefined;
          try {
            console.log('[Canvas][ui_update] steward patch received', { componentId, format: formatRaw, hasDoc: !!doc });
          } catch {}
          if (typeof doc === 'string' && doc.length > 0) {
            let mermaidText: string | undefined;
            if (format === 'mermaid') {
              mermaidText = doc;
            } else if (format === 'markdown' || format === 'streamdown') {
              const match = doc.match(/```mermaid\s*([\s\S]*?)```/i);
              mermaidText = match ? match[1] : doc;
            } else {
              mermaidText = doc;
            }
            if (typeof mermaidText === 'string') nextProps.mermaidText = mermaidText;
          }
        } else {
          if (typeof patch.mermaidText === 'string') nextProps.mermaidText = patch.mermaidText;
          if (typeof patch.keepLastGood === 'boolean') nextProps.keepLastGood = patch.keepLastGood;
          if (typeof patch.w === 'number') nextProps.w = patch.w;
          if (typeof patch.h === 'number') nextProps.h = patch.h;
        }
        if (Object.keys(nextProps).length === 0) return;
        try { console.log('[Canvas][ui_update] apply', { componentId, keys: Object.keys(nextProps), ts }); } catch {}
        editor.updateShapes([{ id: componentId as any, type: 'mermaid_stream' as any, props: nextProps }]);
        if (STEWARD_FLOWCHART) {
          try {
            const g: any = window as any;
            g.__present_mermaid_last_shape_id = componentId;
            if (g.__present_mermaid_session) delete g.__present_mermaid_session;
          } catch {}
        }
      } catch {
        // ignore
      }
    });

    // Bridge local shape patch events → LiveKit bus
    const handleShapePatch = (e: Event) => {
      try {
        const detail = (e as CustomEvent).detail || {};
        const shapeId = String(detail.shapeId || '');
        const patch = (detail.patch || {}) as Record<string, unknown>;
        if (!shapeId || !patch) return;
        const ts = Date.now();
        try { console.log('[Canvas][shapePatch] send', { shapeId, keys: Object.keys(patch), ts }); } catch {}
        bus.send('ui_update', { componentId: shapeId, patch, timestamp: ts });
      } catch {}
    };
    registerMermaidHandler(
      '__present_mermaid_shapePatch_handler',
      'custom:shapePatch',
      handleShapePatch as EventListener,
    );

    // Canvas control event handlers
    const handleFocusEvent = (e: Event) => {
      const detail = (e as CustomEvent).detail || {};
      const target: 'all' | 'selected' | 'component' | 'shape' = detail.target || 'all';
      const padding: number = typeof detail.padding === 'number' ? detail.padding : 64;

      try {
        if (target === 'all') {
          if ((editor as any).zoomToFit) {
            (editor as any).zoomToFit();
          } else {
            const bounds = editor.getCurrentPageBounds();
            if (bounds && (editor as any).zoomToBounds) {
              (editor as any).zoomToBounds(bounds, {
                animation: { duration: 320 },
                inset: padding,
              });
            }
          }
          return;
        }

        if (target === 'selected') {
          if ((editor as any).zoomToSelection) {
            (editor as any).zoomToSelection({ inset: padding });
            return;
          }
        }

        let shapeId: string | null = null;
        if (target === 'shape' && detail.shapeId) {
          shapeId = detail.shapeId;
        }
        if (target === 'component' && detail.componentId) {
          const custom = editor
            .getCurrentPageShapes()
            .find(
              (s: any) => s.type === 'custom' && s.props?.customComponent === detail.componentId,
            );
          shapeId = custom?.id ?? null;
        }

        if (shapeId) {
          const b = editor.getShapePageBounds(shapeId as any);
          if (b && (editor as any).zoomToBounds) {
            (editor as any).zoomToBounds(b, {
              animation: { duration: 320 },
              inset: padding,
            });
          }
        }
      } catch (err) {
        console.warn('[CanvasControl] focus error', err);
      }
    };

    const handleZoomAll = () => {
      try {
        if ((editor as any).zoomToFit) {
          (editor as any).zoomToFit();
          return;
        }
        const bounds = editor.getCurrentPageBounds();
        if (bounds && (editor as any).zoomToBounds) {
          (editor as any).zoomToBounds(bounds, { animation: { duration: 320 } });
        }
      } catch (err) {
        console.warn('[CanvasControl] zoomAll error', err);
      }
    };

    const handleCreateNote = (e: Event) => {
      const detail = (e as CustomEvent).detail || {};
      const text: string = (detail.text || '').toString().trim() || 'Note';

      try {
        const viewport = editor.getViewportPageBounds();
        const x = viewport ? viewport.midX : 0;
        const y = viewport ? viewport.midY : 0;
        const noteId = createShapeId(`note-${nanoid()}`);
        editor.createShape({
          id: noteId,
          type: 'note' as any,
          x: x,
          y: y,
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

    const handleArrangeGrid = (e: Event) => {
      try {
        const detail = (e as CustomEvent).detail || {};
        const selectionOnly = Boolean(detail.selectionOnly);
        const spacing = typeof detail.spacing === 'number' ? detail.spacing : 24;
        let targets = (editor.getSelectedShapes() as any[]).filter(
          (s) => s.type === 'custom',
        );
        if (!selectionOnly || targets.length === 0) {
          targets = (editor.getCurrentPageShapes() as any[]).filter(
            (s) => s.type === 'custom',
          );
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

    const handleCreateRectangle = (e: Event) => {
      try {
        const detail = (e as CustomEvent).detail || {};
        const w = typeof detail.w === 'number' ? detail.w : 300;
        const h = typeof detail.h === 'number' ? detail.h : 200;
        const viewport = editor.getViewportPageBounds();
        const x = typeof detail.x === 'number' ? detail.x : viewport ? viewport.midX - w / 2 : 0;
        const y = typeof detail.y === 'number' ? detail.y : viewport ? viewport.midY - h / 2 : 0;
        editor.createShape({
          id: createShapeId(`rect-${nanoid()}`),
          type: 'geo' as any,
          x,
          y,
          props: { w, h, geo: 'rectangle' },
        } as any);
      } catch (err) {
        console.warn('[CanvasControl] create_rectangle error', err);
      }
    };

    const handleCreateEllipse = (e: Event) => {
      try {
        const detail = (e as CustomEvent).detail || {};
        const w = typeof detail.w === 'number' ? detail.w : 280;
        const h = typeof detail.h === 'number' ? detail.h : 180;
        const viewport = editor.getViewportPageBounds();
        const x = typeof detail.x === 'number' ? detail.x : viewport ? viewport.midX - w / 2 : 0;
        const y = typeof detail.y === 'number' ? detail.y : viewport ? viewport.midY - h / 2 : 0;
        editor.createShape({
          id: createShapeId(`ellipse-${nanoid()}`),
          type: 'geo' as any,
          x,
          y,
          props: { w, h, geo: 'ellipse' },
        } as any);
      } catch (err) {
        console.warn('[CanvasControl] create_ellipse error', err);
      }
    };

    const handleAlignSelected = (e: Event) => {
      try {
        const detail = (e as CustomEvent).detail || {};
        const axis: 'x' | 'y' = detail.axis || 'x';
        const mode: string = detail.mode || (axis === 'x' ? 'center' : 'middle');
        const targets = (editor.getSelectedShapes() as any[]).filter(
          (s) => s.type === 'custom',
        );
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

    const handleDistributeSelected = (e: Event) => {
      try {
        const detail = (e as CustomEvent).detail || {};
        const axis: 'x' | 'y' = detail.axis || 'x';
        const targets = (editor.getSelectedShapes() as any[]).filter(
          (s) => s.type === 'custom',
        );
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
          if (axis === 'x')
            updates.push({ id: items[i].s.id, type: items[i].s.type, x: targetPos });
          else updates.push({ id: items[i].s.id, type: items[i].s.type, y: targetPos });
        }
        if (updates.length) editor.updateShapes(updates as any);
      } catch (err) {
        console.warn('[CanvasControl] distribute_selected error', err);
      }
    };

    const handleDrawSmiley = (e: Event) => {
      try {
        const detail = (e as CustomEvent).detail || {};
        const size = typeof detail.size === 'number' ? detail.size : 300;
        const viewport = editor.getViewportPageBounds();
        const cx = viewport ? viewport.midX : 0;
        const cy = viewport ? viewport.midY : 0;

        const faceW = size;
        const faceH = size;
        const faceId = createShapeId(`smiley-face-${nanoid()}`);
        editor.createShape({
          id: faceId,
          type: 'geo' as any,
          x: cx - faceW / 2,
          y: cy - faceH / 2,
          props: { w: faceW, h: faceH, geo: 'ellipse' },
        } as any);

        const eyeW = Math.max(16, size * 0.12);
        const eyeH = Math.max(16, size * 0.12);
        const eyeOffsetX = size * 0.22;
        const eyeOffsetY = size * 0.18;
        const lEyeId = createShapeId(`smiley-eye-l-${nanoid()}`);
        editor.createShape({
          id: lEyeId,
          type: 'geo' as any,
          x: cx - eyeOffsetX - eyeW / 2,
          y: cy - eyeOffsetY - eyeH / 2,
          props: { w: eyeW, h: eyeH, geo: 'ellipse' },
        } as any);
        const rEyeId = createShapeId(`smiley-eye-r-${nanoid()}`);
        editor.createShape({
          id: rEyeId,
          type: 'geo' as any,
          x: cx + eyeOffsetX - eyeW / 2,
          y: cy - eyeOffsetY - eyeH / 2,
          props: { w: eyeW, h: eyeH, geo: 'ellipse' },
        } as any);

        const mouthW = size * 0.5;
        const mouthH = size * 0.22;
        const mouthY = cy + size * 0.15;
        const mouthId = createShapeId(`smiley-mouth-${nanoid()}`);
        editor.createShape({
          id: mouthId,
          type: 'geo' as any,
          x: cx - mouthW / 2,
          y: mouthY - mouthH / 2,
          props: { w: mouthW, h: mouthH, geo: 'ellipse' },
        } as any);
        try {
          bus.send('editor_action', {
            type: 'draw_smiley',
            faceId,
            lEyeId,
            rEyeId,
            mouthId,
            size,
            timestamp: Date.now(),
          });
        } catch {}
      } catch (err) {
        console.warn('[CanvasControl] draw_smiley error', err);
      }
    };

    const handleCreateMermaidStream = (e: Event) => {
      try {
        const detail = (e as CustomEvent).detail || {};
        const requestedText = typeof detail.text === 'string' ? detail.text : undefined;
        const normalized = STEWARD_FLOWCHART
          ? (requestedText || 'graph TD;\nA-->B;')
          : normalizeMermaidText(requestedText || 'graph TD;\nA-->B;');
        const g: any = window as any;
        if (g.__present_mermaid_creating === true) {
          console.warn('⚠️ [Canvas] Creation in progress; skipping duplicate create attempt');
          return;
        }
        g.__present_mermaid_creating = true;
        try {
          const hasUtil = !!(editor as any).getShapeUtil?.('mermaid_stream');
          if (!hasUtil) {
            setTimeout(() => {
              try {
                window.dispatchEvent(
                  new CustomEvent('tldraw:create_mermaid_stream', { detail: { text: normalized } }),
                );
              } catch {}
            }, 150);
            g.__present_mermaid_creating = false;
            return;
          }
        } catch {}
        const viewport = editor.getViewportPageBounds();
        const x = viewport ? viewport.midX - 200 : 0;
        const y = viewport ? viewport.midY - 150 : 0;
        const id = createShapeId(`mermaid-${nanoid()}`);
        editor.createShape({
          id,
          type: 'mermaid_stream' as any,
          x,
          y,
          props: {
            w: 400,
            h: 300,
            name: 'Mermaid (stream)',
            mermaidText: normalized,
            compileState: 'idle',
            keepLastGood: true,
          },
        } as any);
        try {
          g.__present_mermaid_last_shape_id = id;
          updateMermaidSession(normalized);
        } catch {}
        setTimeout(() => { try { g.__present_mermaid_creating = false; } catch {} }, 250);
      } catch (err) {
        console.warn('[CanvasControl] create_mermaid_stream error', err);
        try { (window as any).__present_mermaid_creating = false; } catch {}
      }
    };
    registerMermaidHandler(
      '__present_mermaid_create_handler',
      'tldraw:create_mermaid_stream',
      handleCreateMermaidStream as EventListener,
    );

    const handleUpdateMermaidStream = (e: Event) => {
      const detail = (e as CustomEvent).detail || {};
      const providedShapeId = detail.shapeId ? String(detail.shapeId) : '';
      const text = typeof detail.text === 'string' ? detail.text : '';
      if (!providedShapeId && !text) return;
      const g: any = window as any;
      const shapeId = providedShapeId || g.__present_mermaid_last_shape_id || '';
      if (!shapeId) return;
      try {
        const normalized = STEWARD_FLOWCHART ? text : normalizeMermaidText(text);
        try { console.log('[Canvas][update_mermaid] apply', { shapeId, len: normalized.length }); } catch {}
        editor.updateShapes([
          { id: shapeId as any, type: 'mermaid_stream' as any, props: { mermaidText: normalized } },
        ]);
        try {
          g.__present_mermaid_last_shape_id = shapeId;
          updateMermaidSession(normalized);
        } catch {}
        try {
          window.dispatchEvent(
            new CustomEvent('custom:shapePatch', {
              detail: { shapeId, patch: { mermaidText: normalized } },
            }),
          );
        } catch {}
      } catch (err) {
        console.warn('[CanvasControl] update_mermaid_stream error', err);
      }
    };
    registerMermaidHandler(
      '__present_mermaid_update_handler',
      'tldraw:update_mermaid_stream',
      handleUpdateMermaidStream as EventListener,
    );

    const handleListShapes = (e: Event) => {
      const detail = (e as CustomEvent).detail || {};
      const callId: string | undefined = detail.callId;
      try {
        const shapes = (editor.getCurrentPageShapes() as any[]).map((s) => {
          const base: any = { id: s.id, type: s.type };
          try {
            if (s.type === 'note') {
              base.text = renderPlaintextFromRichText(editor as any, s.props?.richText);
              base.scale = s.props?.scale;
            } else if (s.type === 'geo') {
              base.geo = s.props?.geo;
              base.w = s.props?.w;
              base.h = s.props?.h;
            } else if (s.type === 'custom') {
              base.name = s.props?.name || s.props?.customComponent;
            }
          } catch {}
          return base;
        });
        try {
          bus.send('tool_result', {
            type: 'tool_result',
            id: callId || `list-${Date.now()}`,
            tool: 'canvas_list_shapes',
            result: { shapes },
            timestamp: Date.now(),
            source: 'editor',
          });
        } catch {}
        try {
          bus.send('editor_action', {
            type: 'list_shapes',
            count: shapes.length,
            timestamp: Date.now(),
          });
        } catch {}
      } catch (err) {
        try {
          bus.send('tool_error', {
            type: 'tool_error',
            id: callId || `list-${Date.now()}`,
            tool: 'canvas_list_shapes',
            error: err instanceof Error ? err.message : String(err),
            timestamp: Date.now(),
            source: 'editor',
          });
        } catch {}
      }
    };

    const handleToggleGrid = () => {
      const el = containerRef.current;
      if (!el) return;
      const has = el.dataset.grid === 'on';
      if (has) {
        delete el.dataset.grid;
        el.style.backgroundImage = '';
      } else {
        el.dataset.grid = 'on';
        el.style.backgroundImage =
          'radial-gradient(circle, rgba(0,0,0,0.12) 1px, transparent 1px)';
        el.style.backgroundSize = '16px 16px';
      }
    };

    const handleSetBackground = (e: Event) => {
      const el = containerRef.current;
      if (!el) return;
      const detail = (e as CustomEvent).detail || {};
      if (detail.color) {
        el.style.backgroundColor = String(detail.color);
        if (el.dataset.grid !== 'on') el.style.backgroundImage = '';
      } else if (detail.image) {
        el.style.backgroundImage = `url(${detail.image})`;
        el.style.backgroundSize = 'cover';
        el.style.backgroundPosition = 'center';
      }
    };

    const handleSetTheme = (e: Event) => {
      const el = containerRef.current;
      if (!el) return;
      const detail = (e as CustomEvent).detail || {};
      const theme = String(detail.theme || '').toLowerCase();
      el.dataset.theme = theme === 'dark' ? 'dark' : 'light';
    };

    const handleSelect = (e: Event) => {
      try {
        const detail = (e as CustomEvent).detail || {};
        const nameQuery = (detail.nameContains as string | undefined)?.toLowerCase();
        const typeQuery = detail.type as string | undefined;
        const within = detail.withinBounds as
          | { x: number; y: number; w: number; h: number }
          | undefined;
        const shapes = editor.getCurrentPageShapes().filter((s: any) => {
          if (typeQuery && s.type !== typeQuery) return false;
          if (nameQuery) {
            const n = (s.props?.name || s.props?.customComponent || s.id || '')
              .toString()
              .toLowerCase();
            if (!n.includes(nameQuery)) return false;
          }
          if (within) {
            const b = editor.getShapePageBounds(s.id);
            if (!b) return false;
            const inside =
              b.x >= within.x &&
              b.y >= within.y &&
              b.x + b.w <= within.x + within.w &&
              b.y + b.h <= within.y + within.h;
            if (!inside) return false;
          }
          return true;
        });
        const ids = shapes.map((s: any) => s.id);
        if (ids.length) {
          editor.select(ids as any);
          if ((editor as any).zoomToSelection)
            (editor as any).zoomToSelection({ inset: 48 });
        }
      } catch (err) {
        console.warn('[CanvasControl] select error', err);
      }
    };

    const handleSelectNote = (e: Event) => {
      try {
        const detail = (e as CustomEvent).detail || {};
        const query = String(detail.text || '').toLowerCase();
        if (!query) return;
        const notes = (editor.getCurrentPageShapes() as any[]).filter((s) => s.type === 'note');
        const match = notes.find((n) => {
          try {
            const t = renderPlaintextFromRichText(editor as any, n.props?.richText || undefined)
              ?.toString()
              ?.toLowerCase();
            return t && t.includes(query);
          } catch {
            return false;
          }
        });
        if (match) {
          editor.select([match.id] as any);
          if ((editor as any).zoomToSelection)
            (editor as any).zoomToSelection({ inset: 64 });
        }
      } catch (err) {
        console.warn('[CanvasControl] selectNote error', err);
      }
    };

    const resolveTargetShape = (detail: any) => {
      const byId = detail?.shapeId as string | undefined;
      if (byId) return byId;
      const text = (detail?.textContains || detail?.contains || '').toString().toLowerCase();
      if (text) {
        const notes = (editor.getCurrentPageShapes() as any[]).filter((s) => s.type === 'note');
        const match = notes.find((n) => {
          try {
            const t = renderPlaintextFromRichText(editor as any, n.props?.richText || undefined)
              ?.toString()
              ?.toLowerCase();
            return t && t.includes(text);
          } catch {
            return false;
          }
        });
        if (match) return match.id;
      }
      return undefined;
    };

    const handleColorShape = (e: Event) => {
      try {
        const detail = (e as CustomEvent).detail || {};
        const color = (detail.color || '').toString();
        const id = resolveTargetShape(detail);
        if (!id || !color) return;
        const s = editor.getShape(id as any) as any;
        if (s?.type === 'note') {
          editor.updateShapes([{ id: s.id, type: 'note' as const, props: { color } }]);
        }
      } catch (err) {
        console.warn('[CanvasControl] colorShape error', err);
      }
    };

    const handleDeleteShape = (e: Event) => {
      try {
        const detail = (e as CustomEvent).detail || {};
        const id = resolveTargetShape(detail);
        if (!id) return;
        editor.deleteShapes([id as any]);
      } catch (err) {
        console.warn('[CanvasControl] deleteShape error', err);
      }
    };

    const handleRenameNote = (e: Event) => {
      try {
        const detail = (e as CustomEvent).detail || {};
        const id = resolveTargetShape(detail);
        const text = (detail.text || '').toString();
        if (!id || !text) return;
        const s = editor.getShape(id as any) as any;
        if (s?.type === 'note') {
          editor.updateShapes([{ id: s.id, type: 'note' as const, props: { richText: toRichText(text) } }]);
        }
      } catch (err) {
        console.warn('[CanvasControl] renameNote error', err);
      }
    };

    // Register all event listeners
    window.addEventListener('tldraw:canvas_focus', handleFocusEvent as EventListener);
    window.addEventListener('tldraw:canvas_zoom_all', handleZoomAll as EventListener);
    window.addEventListener('tldraw:create_note', handleCreateNote as EventListener);
    window.addEventListener('tldraw:pinSelected', handlePinSelected as EventListener);
    window.addEventListener('tldraw:unpinSelected', handleUnpinSelected as EventListener);
    window.addEventListener('tldraw:lockSelected', handleLockSelected as EventListener);
    window.addEventListener('tldraw:unlockSelected', handleUnlockSelected as EventListener);
    window.addEventListener('tldraw:arrangeGrid', handleArrangeGrid as EventListener);
    window.addEventListener('tldraw:createRectangle', handleCreateRectangle as EventListener);
    window.addEventListener('tldraw:createEllipse', handleCreateEllipse as EventListener);
    window.addEventListener('tldraw:alignSelected', handleAlignSelected as EventListener);
    window.addEventListener('tldraw:distributeSelected', handleDistributeSelected as EventListener);
    window.addEventListener('tldraw:drawSmiley', handleDrawSmiley as EventListener);
    window.addEventListener('tldraw:listShapes', handleListShapes as EventListener);
    window.addEventListener('tldraw:toggleGrid', handleToggleGrid as EventListener);
    window.addEventListener('tldraw:setBackground', handleSetBackground as EventListener);
    window.addEventListener('tldraw:setTheme', handleSetTheme as EventListener);
    window.addEventListener('tldraw:select', handleSelect as EventListener);
    window.addEventListener('tldraw:selectNote', handleSelectNote as EventListener);
    window.addEventListener('tldraw:colorShape', handleColorShape as EventListener);
    window.addEventListener('tldraw:deleteShape', handleDeleteShape as EventListener);
    window.addEventListener('tldraw:renameNote', handleRenameNote as EventListener);

    // Cleanup function
    return () => {
      offUiUpdate?.();
      window.removeEventListener('tldraw:canvas_focus', handleFocusEvent as EventListener);
      window.removeEventListener('tldraw:canvas_zoom_all', handleZoomAll as EventListener);
      window.removeEventListener('tldraw:create_note', handleCreateNote as EventListener);
      window.removeEventListener('tldraw:listShapes', handleListShapes as EventListener);
      window.removeEventListener('tldraw:pinSelected', handlePinSelected as EventListener);
      window.removeEventListener('tldraw:unpinSelected', handleUnpinSelected as EventListener);
      window.removeEventListener('tldraw:lockSelected', handleLockSelected as EventListener);
      window.removeEventListener('tldraw:unlockSelected', handleUnlockSelected as EventListener);
      window.removeEventListener('tldraw:arrangeGrid', handleArrangeGrid as EventListener);
      window.removeEventListener('tldraw:createRectangle', handleCreateRectangle as EventListener);
      window.removeEventListener('tldraw:createEllipse', handleCreateEllipse as EventListener);
      window.removeEventListener('tldraw:alignSelected', handleAlignSelected as EventListener);
      window.removeEventListener('tldraw:distributeSelected', handleDistributeSelected as EventListener);
      window.removeEventListener('tldraw:drawSmiley', handleDrawSmiley as EventListener);
      removeMermaidHandler('__present_mermaid_create_handler', 'tldraw:create_mermaid_stream');
      removeMermaidHandler('__present_mermaid_update_handler', 'tldraw:update_mermaid_stream');
      removeMermaidHandler('__present_mermaid_shapePatch_handler', 'custom:shapePatch');
      window.removeEventListener('tldraw:toggleGrid', handleToggleGrid as EventListener);
      window.removeEventListener('tldraw:setBackground', handleSetBackground as EventListener);
      window.removeEventListener('tldraw:setTheme', handleSetTheme as EventListener);
      window.removeEventListener('tldraw:select', handleSelect as EventListener);
      window.removeEventListener('tldraw:selectNote', handleSelectNote as EventListener);
      window.removeEventListener('tldraw:colorShape', handleColorShape as EventListener);
      window.removeEventListener('tldraw:deleteShape', handleDeleteShape as EventListener);
      window.removeEventListener('tldraw:renameNote', handleRenameNote as EventListener);
    };
  }, [editor, room, containerRef, enabled]);
}
