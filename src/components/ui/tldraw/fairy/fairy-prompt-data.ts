'use client';

import { useCallback } from 'react';
import { useEditor } from '@tldraw/tldraw';
import { useCanvasContext } from '@/lib/hooks/use-canvas-context';
import type { Editor } from '@tldraw/tldraw';

const MAX_CONTEXT_CHARS = 6000;
const MAX_STATE_CHARS = 4000;
const MAX_WIDGETS = 6;
const MAX_CUSTOM_SHAPES = 6;

type PromptDataOptions = {
  metadata?: unknown;
  selectionIds?: string[];
};

const truncateText = (value: string, maxChars: number) => {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}…(truncated)`;
};

const safeJsonPreview = (value: unknown, maxChars: number) => {
  if (value == null) return value;
  try {
    const json = JSON.stringify(value);
    if (json.length <= maxChars) return value;
    return {
      __truncated: true,
      preview: json.slice(0, maxChars),
      bytes: json.length,
    };
  } catch {
    return String(value);
  }
};

const buildCustomShapeSnapshots = (editor: Editor) => {
  if (!editor?.getCurrentPageShapes) return [];
  const shapes = editor.getCurrentPageShapes();
  const snapshots: Array<Record<string, unknown>> = [];

  for (const shape of shapes) {
    if (!shape || typeof shape !== 'object') continue;
    if (shape.type !== 'custom') continue;
    const props = (shape as any).props || {};
    const componentId = typeof props.customComponent === 'string' ? props.customComponent : undefined;
    if (!componentId) continue;
    const name = typeof props.name === 'string' ? props.name : undefined;
    const state = props.state ? safeJsonPreview(props.state, MAX_STATE_CHARS) : null;
    snapshots.push({
      id: (shape as any).id,
      componentId,
      name,
      state,
      size:
        typeof props.w === 'number' && typeof props.h === 'number'
          ? { w: props.w, h: props.h }
          : undefined,
    });
    if (snapshots.length >= MAX_CUSTOM_SHAPES) break;
  }

  return snapshots;
};

export function useFairyPromptData() {
  const editor = useEditor();
  const { getPromptContext, widgets } = useCanvasContext();

  return useCallback(
    (options: PromptDataOptions = {}) => {
      const data: Array<Record<string, unknown>> = [];

      const promptContext = getPromptContext({
        transcriptLines: 16,
        maxDocumentLength: 1200,
        includeWidgets: false,
      });

      if (promptContext) {
        data.push({
          type: 'present_context',
          text: truncateText(promptContext, MAX_CONTEXT_CHARS),
        });
      }

      if (widgets && widgets.length > 0) {
        const widgetSnapshots = widgets.slice(0, MAX_WIDGETS).map((widget) => ({
          componentType: widget.componentType,
          messageId: widget.messageId,
          props: safeJsonPreview(widget.props, MAX_STATE_CHARS),
          lastUpdated: widget.lastUpdated ?? null,
        }));
        data.push({ type: 'widgets', widgets: widgetSnapshots });
      }

      if (editor) {
        const customSnapshots = buildCustomShapeSnapshots(editor);
        if (customSnapshots.length > 0) {
          data.push({ type: 'canvas_components', items: customSnapshots });
        }
      }

      if (options.metadata !== undefined && options.metadata !== null) {
        data.push({
          type: 'dispatch_metadata',
          metadata: safeJsonPreview(options.metadata, MAX_STATE_CHARS),
        });
      }

      if (options.selectionIds && options.selectionIds.length > 0) {
        data.push({
          type: 'selection_ids',
          ids: options.selectionIds.slice(0, 20),
        });
      }

      return data;
    },
    [editor, getPromptContext, widgets],
  );
}
