"use client";

import { useMemo } from 'react';
import { ComponentRegistry } from '@/lib/component-registry';
import type { ToolCall, ToolParameters, ToolRunResult } from '../utils/toolTypes';
import { getMermaidLastNode, normalizeMermaidText } from '../utils';

export interface ToolRegistryDeps {
  contextKey?: string;
}

export interface ToolHandlerContext {
  call: ToolCall;
  params: ToolParameters;
  dispatchTL: (eventName: string, detail?: unknown) => ToolRunResult;
  scheduleStewardRun: (roomName: string, docId: string) => void;
  stewardEnabled: boolean;
  emitEditorAction: (payload: Record<string, unknown>) => void;
}

export type ToolHandler = (context: ToolHandlerContext) => Promise<ToolRunResult | undefined>;

export interface ToolRegistryApi {
  getHandler: (tool: string) => ToolHandler | undefined;
  listTools: () => string[];
}

export const CANVAS_TOOLS: Record<string, string> = {
  canvas_focus: 'tldraw:canvas_focus',
  canvas_zoom_all: 'tldraw:canvas_zoom_all',
  canvas_create_note: 'tldraw:create_note',
  canvas_pin_selected: 'tldraw:pinSelected',
  canvas_unpin_selected: 'tldraw:unpinSelected',
  canvas_lock_selected: 'tldraw:lockSelected',
  canvas_unlock_selected: 'tldraw:unlockSelected',
  canvas_arrange_grid: 'tldraw:arrangeGrid',
  canvas_create_rectangle: 'tldraw:createRectangle',
  canvas_create_ellipse: 'tldraw:createEllipse',
  canvas_align_selected: 'tldraw:alignSelected',
  canvas_distribute_selected: 'tldraw:distributeSelected',
  canvas_draw_smiley: 'tldraw:drawSmiley',
  canvas_toggle_grid: 'tldraw:toggleGrid',
  canvas_set_background: 'tldraw:setBackground',
  canvas_set_theme: 'tldraw:setTheme',
  canvas_select: 'tldraw:select',
  canvas_select_by_note: 'tldraw:selectNote',
  canvas_color_shape: 'tldraw:colorShape',
  canvas_delete_shape: 'tldraw:deleteShape',
  canvas_rename_note: 'tldraw:renameNote',
  canvas_connect_shapes: 'tldraw:connectShapes',
  canvas_label_arrow: 'tldraw:labelArrow',
};

export const CANVAS_TOOL_NAMES = Object.keys(CANVAS_TOOLS);

export function useToolRegistry(deps: ToolRegistryDeps): ToolRegistryApi {
  const { contextKey } = deps;

  const handlers = useMemo(() => {
    const map = new Map<string, ToolHandler>();

    const resolveRoomFromWindow = () => {
      try {
        const globalAny = window as any;
        const candidates: unknown[] = [
          globalAny?.__present?.livekitRoomName,
          globalAny?.__present_roomName,
          globalAny?.__present_canvas_room,
        ];
        const match = candidates.find((value) => typeof value === 'string' && value.trim().length > 0);
        return match ? String(match).trim() : undefined;
      } catch {
        return undefined;
      }
    };

    // Canvas dispatch helpers
    Object.entries(CANVAS_TOOLS).forEach(([tool, eventName]) => {
      map.set(tool, async ({ dispatchTL, params }) => dispatchTL(eventName, params));
    });

    map.set('list_components', async () => {
      const components = ComponentRegistry.list(contextKey);
      return { status: 'SUCCESS', components };
    });

    map.set('create_component', async ({ params, emitEditorAction }) => {
      const componentType = String(params?.type ?? '').trim();
      const messageId = String(params?.messageId || params?.componentId || '') || `ui-${Date.now().toString(36)}`;

      try {
        window.dispatchEvent(
          new CustomEvent('custom:showComponent', {
            detail: {
              messageId,
              component: {
                type: componentType,
                props: params,
              },
              contextKey,
            },
          }),
        );
        emitEditorAction({ type: 'create_component', componentType, messageId });
        return { status: 'SUCCESS', message: `Rendered ${componentType}`, messageId };
      } catch (error) {
        return { status: 'ERROR', message: error instanceof Error ? error.message : String(error) };
      }
    });

    map.set('update_component', async ({ params }) => {
      const messageId = String(params?.componentId || params?.messageId || '');
      const patch = params?.patch;
      if (!messageId) {
        return { status: 'ERROR', message: 'update_component requires componentId' };
      }
      const nextPatch =
        typeof patch === 'string' ? { instruction: patch } : ((patch as Record<string, unknown> | undefined) ?? {});
      const result = await ComponentRegistry.update(messageId, nextPatch);
      return { status: 'SUCCESS', message: 'Component updated', ...result };
    });

    map.set('canvas_create_mermaid_stream', async ({ params, dispatchTL }) => {
      const text = typeof params?.text === 'string' ? params.text : 'graph TD; A-->B;';
      const normalized = normalizeMermaidText(text);
      const result = dispatchTL('tldraw:create_mermaid_stream', { text: normalized });
      return { ...result, normalized }; // merge status+message from dispatch
    });

    map.set('canvas_update_mermaid_stream', async ({ params, dispatchTL }) => {
      const shapeId = typeof params?.shapeId === 'string' ? params.shapeId : undefined;
      if (!shapeId) {
        return { status: 'ERROR', message: 'Missing shapeId' };
      }
      const text = normalizeMermaidText(String(params?.text || ''));
      const lastNode = getMermaidLastNode(text);
      dispatchTL('tldraw:update_mermaid_stream', { shapeId, text });
      return { status: 'SUCCESS', shapeId, lastNode };
    });

    map.set('canvas_list_shapes', async ({ call, emitEditorAction }) => {
      window.dispatchEvent(
        new CustomEvent('tldraw:listShapes', { detail: { callId: call.id } }),
      );
      emitEditorAction({ type: 'canvas_command', command: 'tldraw:listShapes', callId: call.id });
      return { status: 'ACK', message: 'Listing shapes' };
    });

    map.set('dispatch_to_conductor', async ({ call, params, emitEditorAction }) => {
      const task = typeof params?.task === 'string' ? params.task.trim() : '';
      const nested =
        params?.params && typeof params.params === 'object' && !Array.isArray(params.params)
          ? { ...(params.params as Record<string, unknown>) }
          : {};
      if (params && typeof params === 'object' && !Array.isArray(params)) {
        Object.entries(params as Record<string, unknown>).forEach(([key, value]) => {
          if (key === 'task' || key === 'params' || value === undefined) return;
          nested[key] = value as unknown;
        });
      }
      const directRoom =
        typeof (params as Record<string, unknown> | undefined)?.room === 'string'
          ? String((params as Record<string, unknown>).room)
          : undefined;
      const resolvedRoom =
        (directRoom && directRoom.trim()) ||
        (typeof nested.room === 'string' && nested.room.trim()) ||
        (typeof call.roomId === 'string' && call.roomId.trim()) ||
        resolveRoomFromWindow();
      if (resolvedRoom) {
        nested.room = resolvedRoom.trim();
      }

      if (!task) {
        return { status: 'ERROR', message: 'dispatch_to_conductor requires task' };
      }

      try {
        const res = await fetch('/api/steward/handoff', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ task, params: nested }),
        });
        if (!res.ok) {
          let text = '';
          try {
            text = await res.text();
          } catch {}
          return {
            status: 'ERROR',
            message: text || `Failed to hand off task ${task}`,
          };
        }
        emitEditorAction({
          type: 'conductor_handoff',
          task,
          room: nested.room,
          timestamp: Date.now(),
        });
        return { status: 'SUCCESS', message: 'Conductor handoff scheduled', task };
      } catch (error) {
        return {
          status: 'ERROR',
          message: error instanceof Error ? error.message : String(error),
        };
      }
    });

    return map;
  }, [contextKey]);

  return {
    getHandler: (tool: string) => handlers.get(tool),
    listTools: () => Array.from(handlers.keys()),
  };
}
