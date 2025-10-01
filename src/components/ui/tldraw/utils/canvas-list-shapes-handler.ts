import type { Editor } from 'tldraw';

import type { LiveKitBus } from './types';
import { renderPlaintextFromRichText } from './rich-text';
import { withWindowListeners } from './window-listeners';

export function registerCanvasListShapesHandler(editor: Editor, bus: LiveKitBus): () => void {
  return withWindowListeners((add) => {
    const handleListShapes = (event: Event) => {
      const detail = (event as CustomEvent).detail || {};
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

    add('tldraw:listShapes', handleListShapes as EventListener);
  });
}
