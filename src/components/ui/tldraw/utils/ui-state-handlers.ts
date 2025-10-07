import type { Editor } from 'tldraw';
import type { RefObject } from 'react';
import type { CanvasEventMap, LiveKitBus } from './types';
import { createCanvasNavigationHandlers } from './canvas-navigation-handlers';
import { toPlainText } from './rich-text';

interface UiStateHandlersDeps {
  editor: Editor;
  containerRef: RefObject<HTMLDivElement>;
  bus: LiveKitBus;
}

export function createUiStateHandlers({
  editor,
  containerRef,
  bus,
}: UiStateHandlersDeps): CanvasEventMap {
  const navigationHandlers = createCanvasNavigationHandlers(editor, containerRef);

  const handleListShapes: EventListener = (event) => {
    const detail = (event as CustomEvent).detail || {};
    const callId: string | undefined = detail.callId;

    try {
      const shapes = (editor.getCurrentPageShapes() as any[]).map((shape) => {
        const base: Record<string, unknown> = { id: shape.id, type: shape.type };
        try {
          if (shape.type === 'note') {
            base.text = toPlainText(shape.props?.richText);
            base.scale = shape.props?.scale;
          } else if (shape.type === 'geo') {
            base.geo = shape.props?.geo;
            base.w = shape.props?.w;
            base.h = shape.props?.h;
          } else if (shape.type === 'custom') {
            base.name = shape.props?.name || shape.props?.customComponent;
          }
        } catch {
          // ignore shape serialization errors
        }
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
      } catch {
        // ignore result send failures
      }

      try {
        bus.send('editor_action', {
          type: 'list_shapes',
          count: shapes.length,
          timestamp: Date.now(),
        });
      } catch {
        // ignore telemetry issues
      }
    } catch (error) {
      try {
        bus.send('tool_error', {
          type: 'tool_error',
          id: callId || `list-${Date.now()}`,
          tool: 'canvas_list_shapes',
          error: error instanceof Error ? error.message : String(error),
          timestamp: Date.now(),
          source: 'editor',
        });
      } catch {
        // ignore error dispatch failures
      }
    }
  };

  return {
    ...navigationHandlers,
    'tldraw:listShapes': handleListShapes,
  };
}
