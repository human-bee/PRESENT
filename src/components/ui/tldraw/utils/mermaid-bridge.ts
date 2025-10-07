 
import { nanoid } from 'nanoid';
import { Editor, createShapeId } from 'tldraw';
import { normalizeMermaidText, getMermaidLastNode } from '@/components/TO BE REFACTORED/tool-dispatcher';
import type { MutableRefObject } from 'react';
import { registerSingletonWindowListener, registerWindowListener } from './window-listeners';
import type { LiveKitBus } from './types';

const STEWARD_FLOWCHART =
  typeof process !== 'undefined' && process.env.NEXT_PUBLIC_STEWARD_FLOWCHART_ENABLED === 'true';

declare global {
  interface Window {
    __present_mermaid_session?: {
      text: string;
      last?: string;
    };
    __present_mermaid_last_shape_id?: string;
    __present_mermaid_creating?: boolean;
  }
}

interface MermaidBridgeOptions {
  editor: Editor;
  bus: LiveKitBus;
  lastTimestampsRef: MutableRefObject<Map<string, number>>;
}

function updateMermaidSession(normalizedText: string, lastOverride?: string) {
  if (STEWARD_FLOWCHART || typeof window === 'undefined') {
    return;
  }
  try {
    window.__present_mermaid_session = {
      text: normalizedText,
      last: typeof lastOverride === 'string' ? lastOverride : getMermaidLastNode(normalizedText),
    };
  } catch {
    // swallow
  }
}

export function attachMermaidBridge({ editor, bus, lastTimestampsRef }: MermaidBridgeOptions) {
  const cleanupFns: Array<() => void> = [];

  const offUiUpdate = bus.on('ui_update', (payload: any) => {
    try {
      if (!payload || typeof payload !== 'object') return;
      const componentId = String(payload.componentId || '');
      const patch = (payload.patch || {}) as Record<string, unknown>;
      const ts = typeof payload.timestamp === 'number' ? payload.timestamp : Date.now();
      if (!componentId || !patch) return;

      const shape = editor.getShape(componentId as any) as any;
      if (!shape || shape.type !== 'mermaid_stream') return;

      const lastTs = lastTimestampsRef.current.get(componentId) || 0;
      if (ts < lastTs) return;
      lastTimestampsRef.current.set(componentId, ts);

      const nextProps: Record<string, unknown> = {};
      if (STEWARD_FLOWCHART) {
        const doc = (patch as any).flowchartDoc as string | undefined;
        const formatRaw = (patch as any).format as string | undefined;
        const format = typeof formatRaw === 'string' ? formatRaw.toLowerCase() : undefined;
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
      editor.updateShapes([{ id: componentId as any, type: 'mermaid_stream' as any, props: nextProps }]);
      if (STEWARD_FLOWCHART) {
        try {
          window.__present_mermaid_last_shape_id = componentId;
          if (window.__present_mermaid_session) delete window.__present_mermaid_session;
        } catch {
          // ignore
        }
      }
    } catch {
      // ignore
    }
  });

  cleanupFns.push(offUiUpdate ?? (() => {}));

  const shapePatchCleanup = registerSingletonWindowListener(
    '__present_mermaid_shapePatch_handler',
    'custom:shapePatch',
    (event) => {
      const detail = (event as CustomEvent).detail || {};
      const shapeId = String(detail.shapeId || '');
      const patch = (detail.patch || {}) as Record<string, unknown>;
      if (!shapeId || !patch) return;
      const ts = Date.now();
      bus.send('ui_update', { componentId: shapeId, patch, timestamp: ts });
    },
  );
  cleanupFns.push(shapePatchCleanup);

  const createStreamCleanup = registerSingletonWindowListener(
    '__present_mermaid_create_handler',
    'tldraw:create_mermaid_stream',
    (event) => {
      const detail = (event as CustomEvent).detail || {};
      const requestedText = typeof detail.text === 'string' ? detail.text : undefined;
      const normalized = STEWARD_FLOWCHART
        ? (requestedText || 'graph TD;\nA-->B;')
        : normalizeMermaidText(requestedText || 'graph TD;\nA-->B;');

      if (typeof window !== 'undefined') {
        if (window.__present_mermaid_creating === true) {
          return;
        }
        window.__present_mermaid_creating = true;
      }

      try {
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
        if (typeof window !== 'undefined') {
          window.__present_mermaid_last_shape_id = id;
        }
        updateMermaidSession(normalized);
      } finally {
        if (typeof window !== 'undefined') {
          window.setTimeout(() => {
            if (window) window.__present_mermaid_creating = false;
          }, 250);
        }
      }
    },
  );
  cleanupFns.push(createStreamCleanup);

  const updateStreamCleanup = registerSingletonWindowListener(
    '__present_mermaid_update_handler',
    'tldraw:update_mermaid_stream',
    (event) => {
      const detail = (event as CustomEvent).detail || {};
      const providedShapeId = detail.shapeId ? String(detail.shapeId) : '';
      const text = typeof detail.text === 'string' ? detail.text : '';
      if (!providedShapeId && !text) return;
      const shapeId = providedShapeId || (typeof window !== 'undefined' ? window.__present_mermaid_last_shape_id : '') || '';
      if (!shapeId) return;
      try {
        const normalized = STEWARD_FLOWCHART ? text : normalizeMermaidText(text);
        editor.updateShapes([
          { id: shapeId as any, type: 'mermaid_stream' as any, props: { mermaidText: normalized } },
        ]);
        if (typeof window !== 'undefined') {
          window.__present_mermaid_last_shape_id = shapeId;
        }
        updateMermaidSession(normalized);
        try {
          window.dispatchEvent(
            new CustomEvent('custom:shapePatch', {
              detail: { shapeId, patch: { mermaidText: normalized } },
            }),
          );
        } catch {
          // ignore
        }
      } catch {
        // swallow
      }
    },
  );
  cleanupFns.push(updateStreamCleanup);

  if (typeof window !== 'undefined') {
    const resetCleanup = registerWindowListener('beforeunload', () => {
      window.__present_mermaid_creating = false;
    });
    cleanupFns.push(resetCleanup);
  }

  return () => {
    cleanupFns.forEach((cleanup) => {
      try {
        cleanup();
      } catch {
        // ignore cleanup failure
      }
    });
  };
}
