import type { Editor } from '@tldraw/tldraw';

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

const summarizeWidgetHistory = (
  history: Array<{ key: string; next: unknown; ts: number }> | undefined,
  maxItems: number,
  maxChars: number,
) => {
  if (!Array.isArray(history) || history.length === 0) return undefined;
  const trimmed = history.slice(-maxItems).map((entry) => ({
    key: entry.key,
    ts: entry.ts,
    next: safeJsonPreview(entry.next, maxChars),
  }));
  return trimmed;
};

const buildCustomShapeSnapshots = (
  editor: Editor | null,
  maxShapes: number,
  maxStateChars: number,
) => {
  if (!editor?.getCurrentPageShapes) return [] as Array<Record<string, unknown>>;
  const shapes = editor.getCurrentPageShapes();
  const snapshots: Array<Record<string, unknown>> = [];

  for (const shape of shapes) {
    if (!shape || typeof shape !== 'object') continue;
    if ((shape as any).type !== 'custom') continue;
    const props = (shape as any).props || {};
    const componentId = typeof props.customComponent === 'string' ? props.customComponent : undefined;
    if (!componentId) continue;
    const name = typeof props.name === 'string' ? props.name : undefined;
    const state = props.state ? safeJsonPreview(props.state, maxStateChars) : null;
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
    if (snapshots.length >= maxShapes) break;
  }

  return snapshots;
};

export {
  truncateText,
  safeJsonPreview,
  summarizeWidgetHistory,
  buildCustomShapeSnapshots,
};
