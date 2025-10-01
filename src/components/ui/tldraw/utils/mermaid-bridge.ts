import { createShapeId } from 'tldraw';
import { nanoid } from 'nanoid';
import type { Editor } from 'tldraw';

import { normalizeMermaidText, getMermaidLastNode } from '@/components/TO BE REFACTORED/tool-dispatcher';

import type { LiveKitBus } from './types';

interface RegisterMermaidBridgeOptions {
  editor: Editor;
  bus: LiveKitBus;
  stewardFlowchartEnabled: boolean;
}

type MermaidSession = {
  text: string;
  last?: string;
};

const MERMAID_CREATE_FLAG = '__present_mermaid_create_handler';
const MERMAID_UPDATE_FLAG = '__present_mermaid_update_handler';
const MERMAID_PATCH_FLAG = '__present_mermaid_shapePatch_handler';

export function registerMermaidBridge({
  editor,
  bus,
  stewardFlowchartEnabled,
}: RegisterMermaidBridgeOptions): () => void {
  if (typeof window === 'undefined') {
    return () => {};
  }

  const cleanups: Array<() => void> = [];
  const lastTsByShape = new Map<string, number>();

  const offUiUpdate = bus.on('ui_update', (msg: any) => {
    try {
      if (!msg || typeof msg !== 'object') return;
      const componentId = String(msg.componentId || '');
      const patch = (msg.patch || {}) as Record<string, unknown>;
      const ts = typeof msg.timestamp === 'number' ? msg.timestamp : Date.now();
      if (!componentId || !patch) return;

      const shape = editor.getShape(componentId as any) as any;
      if (!shape || shape.type !== 'mermaid_stream') return;

      const last = lastTsByShape.get(componentId) || 0;
      if (ts < last) return;
      lastTsByShape.set(componentId, ts);

      const nextProps: Record<string, unknown> = {};
      if (stewardFlowchartEnabled) {
        const doc = (patch as any).flowchartDoc as string | undefined;
        const formatRaw = (patch as any).format as string | undefined;
        const format = typeof formatRaw === 'string' ? formatRaw.toLowerCase() : undefined;
        try {
          console.log('[Canvas][ui_update] steward patch received', {
            componentId,
            format: formatRaw,
            hasDoc: !!doc,
          });
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
        if (typeof (patch as any).mermaidText === 'string') nextProps.mermaidText = (patch as any).mermaidText;
        if (typeof (patch as any).keepLastGood === 'boolean')
          nextProps.keepLastGood = (patch as any).keepLastGood;
        if (typeof (patch as any).w === 'number') nextProps.w = (patch as any).w;
        if (typeof (patch as any).h === 'number') nextProps.h = (patch as any).h;
      }
      if (Object.keys(nextProps).length === 0) return;
      try {
        console.log('[Canvas][ui_update] apply', { componentId, keys: Object.keys(nextProps), ts });
      } catch {}
      editor.updateShapes([{ id: componentId as any, type: 'mermaid_stream' as any, props: nextProps }]);
      if (stewardFlowchartEnabled) {
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

  cleanups.push(offUiUpdate);

  const registerMermaidHandler = (flag: string, event: string, handler: EventListener) => {
    const g: any = window as any;
    const existing = g[flag] as EventListener | undefined;
    if (existing) {
      window.removeEventListener(event, existing);
    }
    window.addEventListener(event, handler);
    g[flag] = handler;
    cleanups.push(() => {
      const stored = g[flag] as EventListener | undefined;
      if (stored === handler) {
        window.removeEventListener(event, handler);
        delete g[flag];
      }
    });
  };

  const updateMermaidSession = (normalizedText: string, lastOverride?: string) => {
    if (stewardFlowchartEnabled) return;
    try {
      const g: any = window as any;
      const session: MermaidSession = {
        text: normalizedText,
        last:
          typeof lastOverride === 'string' ? lastOverride : getMermaidLastNode(normalizedText),
      };
      g.__present_mermaid_session = session;
    } catch {}
  };

  const handleShapePatch = (e: Event) => {
    try {
      const detail = (e as CustomEvent).detail || {};
      const shapeId = String(detail.shapeId || '');
      const patch = (detail.patch || {}) as Record<string, unknown>;
      if (!shapeId || !patch) return;
      const ts = Date.now();
      try {
        console.log('[Canvas][shapePatch] send', { shapeId, keys: Object.keys(patch), ts });
      } catch {}
      bus.send('ui_update', { componentId: shapeId, patch, timestamp: ts });
    } catch {}
  };

  registerMermaidHandler(MERMAID_PATCH_FLAG, 'custom:shapePatch', handleShapePatch as EventListener);

  const handleCreateMermaidStream = (event: Event) => {
    try {
      const detail = (event as CustomEvent).detail || {};
      const requestedText = typeof detail.text === 'string' ? detail.text : undefined;
      const normalized = stewardFlowchartEnabled
        ? requestedText || 'graph TD;\nA-->B;'
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
      setTimeout(() => {
        try {
          g.__present_mermaid_creating = false;
        } catch {}
      }, 250);
    } catch (err) {
      console.warn('[CanvasControl] create_mermaid_stream error', err);
      try {
        (window as any).__present_mermaid_creating = false;
      } catch {}
    }
  };

  registerMermaidHandler(
    MERMAID_CREATE_FLAG,
    'tldraw:create_mermaid_stream',
    handleCreateMermaidStream as EventListener,
  );

  const handleUpdateMermaidStream = (event: Event) => {
    const detail = (event as CustomEvent).detail || {};
    const providedShapeId = detail.shapeId ? String(detail.shapeId) : '';
    const text = typeof detail.text === 'string' ? detail.text : '';
    if (!providedShapeId && !text) return;
    const g: any = window as any;
    const shapeId = providedShapeId || g.__present_mermaid_last_shape_id || '';
    if (!shapeId) return;
    try {
      const normalized = stewardFlowchartEnabled ? text : normalizeMermaidText(text);
      try {
        console.log('[Canvas][update_mermaid] apply', { shapeId, len: normalized.length });
      } catch {}
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
    MERMAID_UPDATE_FLAG,
    'tldraw:update_mermaid_stream',
    handleUpdateMermaidStream as EventListener,
  );

  return () => {
    cleanups.forEach((cleanup) => {
      try {
        cleanup();
      } catch {}
    });
  };
}
