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

const CANVAS_TOOLS: Record<string, string> = {};

export function useToolRegistry(deps: ToolRegistryDeps): ToolRegistryApi {
  const { contextKey } = deps;

  const handlers = useMemo(() => {
    const map = new Map<string, ToolHandler>();

    // Legacy canvas_* tools removed for unified Canvas Agent

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

    map.set('update_component', async ({ params, dispatchTL }) => {
      const messageId = String(params?.componentId || params?.messageId || '');
      const patch = params?.patch;
      if (!messageId) {
        return { status: 'ERROR', message: 'update_component requires componentId' };
      }
      let nextPatch: Record<string, unknown>;
      if (typeof patch === 'string') {
        try {
          const parsed = JSON.parse(patch);
          nextPatch = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : { instruction: patch };
        } catch {
          nextPatch = { instruction: patch };
        }
      } else {
        nextPatch = (patch as Record<string, unknown> | undefined) ?? {};
      }
      const runtimePatch: Record<string, unknown> = { ...nextPatch };
      const timestamp = Date.now();
      if (typeof runtimePatch.updatedAt !== 'number') {
        runtimePatch.updatedAt = timestamp;
      }
      if (typeof runtimePatch.duration === 'number' && Number.isFinite(runtimePatch.duration)) {
        const durationSeconds = Math.max(1, Math.round(runtimePatch.duration as number));
        const minutes = Math.floor(durationSeconds / 60);
        const seconds = durationSeconds % 60;
        runtimePatch.configuredDuration = durationSeconds;
        if (typeof runtimePatch.timeLeft !== 'number') {
          runtimePatch.timeLeft = durationSeconds;
        }
        runtimePatch.initialMinutes = minutes;
        runtimePatch.initialSeconds = seconds;
        delete runtimePatch.duration;
      }
      if (typeof runtimePatch.durationSeconds === 'number' && Number.isFinite(runtimePatch.durationSeconds as number)) {
        const durationSeconds = Math.max(1, Math.round(runtimePatch.durationSeconds as number));
        const minutes = Math.floor(durationSeconds / 60);
        const seconds = durationSeconds % 60;
        runtimePatch.configuredDuration = durationSeconds;
        if (typeof runtimePatch.timeLeft !== 'number') {
          runtimePatch.timeLeft = durationSeconds;
        }
        runtimePatch.initialMinutes = minutes;
        runtimePatch.initialSeconds = seconds;
      }
      if (
        typeof runtimePatch.initialMinutes === 'number' &&
        typeof runtimePatch.initialSeconds === 'number'
      ) {
        const minutes = Math.max(1, Math.round(runtimePatch.initialMinutes as number));
        const seconds = Math.max(0, Math.min(59, Math.round(runtimePatch.initialSeconds as number)));
        const durationSeconds = minutes * 60 + seconds;
        runtimePatch.configuredDuration = durationSeconds;
        if (typeof runtimePatch.timeLeft !== 'number') {
          runtimePatch.timeLeft = durationSeconds;
        }
        runtimePatch.initialMinutes = minutes;
        runtimePatch.initialSeconds = seconds;
      }
      dispatchTL('tldraw:merge_component_state', {
        messageId,
        patch: runtimePatch,
        meta: { source: 'update_component' },
      });
      const result = await ComponentRegistry.update(messageId, runtimePatch);
      return { status: 'SUCCESS', message: 'Component updated', ...result };
    });

    map.set('mermaid_create_stream', async ({ params, dispatchTL }) => {
      const text = typeof params?.text === 'string' ? params.text : 'graph TD; A-->B;';
      const normalized = normalizeMermaidText(text);
      const result = dispatchTL('tldraw:create_mermaid_stream', { text: normalized });
      return { ...result, normalized }; // merge status+message from dispatch
    });

    map.set('mermaid_update_stream', async ({ params, dispatchTL }) => {
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

    return map;
  }, [contextKey]);

  return {
    getHandler: (tool: string) => handlers.get(tool),
    listTools: () => Array.from(handlers.keys()),
  };
}
