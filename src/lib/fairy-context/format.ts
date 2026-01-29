import type { FairyContextPart } from './types';

export type { FairyContextPart } from './types';

const truncate = (value: string, maxChars: number) => {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}...`;
};

const previewValue = (value: unknown, maxChars: number) => {
  if (value == null) return '';
  if (typeof value === 'string') return truncate(value, maxChars);
  try {
    return truncate(JSON.stringify(value), maxChars);
  } catch {
    return truncate(String(value), maxChars);
  }
};

export function formatFairyContextParts(parts: FairyContextPart[], maxChars = 4000) {
  if (!Array.isArray(parts) || parts.length === 0) return '';
  const sections: string[] = [];
  for (const part of parts) {
    if (!part || typeof part !== 'object') continue;
    const type = String(part.type || '').trim();
    if (!type) continue;

    if (type === 'present_context') {
      const text = typeof (part as any).text === 'string' ? (part as any).text : '';
      if (text) sections.push(`## Conversation Context\n${truncate(text, maxChars)}`);
      continue;
    }

    if (type === 'documents') {
      const docs = Array.isArray((part as any).documents) ? (part as any).documents : [];
      const lines = docs
        .map((doc: any) => {
          const title = typeof doc?.title === 'string' ? doc.title : 'Untitled';
          const docType = typeof doc?.type === 'string' ? doc.type : 'text';
          const preview = typeof doc?.preview === 'string' ? doc.preview : '';
          return `- ${title} (${docType})${preview ? `: ${truncate(preview, 600)}` : ''}`;
        })
        .filter(Boolean);
      if (lines.length) sections.push(`## Documents\n${lines.join('\n')}`);
      continue;
    }

    if (type === 'widgets') {
      const widgets = Array.isArray((part as any).widgets) ? (part as any).widgets : [];
      const lines = widgets
        .map((widget: any) => {
          const componentType = typeof widget?.componentType === 'string' ? widget.componentType : 'Widget';
          const messageId = typeof widget?.messageId === 'string' ? widget.messageId : '';
          const history = Array.isArray(widget?.history)
            ? widget.history.map((h: any) => h?.key).filter(Boolean)
            : [];
          const propsPreview = widget?.props ? previewValue(widget.props, 400) : '';
          const historyText = history.length ? ` updates: ${history.join(', ')}` : '';
          return `- ${componentType}${messageId ? ` (${messageId})` : ''}${historyText}${propsPreview ? ` props: ${propsPreview}` : ''}`;
        })
        .filter(Boolean);
      if (lines.length) sections.push(`## Widget Activity\n${lines.join('\n')}`);
      continue;
    }

    if (type === 'canvas_components') {
      const items = Array.isArray((part as any).items) ? (part as any).items : [];
      const lines = items
        .map((item: any) => {
          const name = typeof item?.name === 'string' ? item.name : '';
          const componentId = typeof item?.componentId === 'string' ? item.componentId : '';
          const state = item?.state ? previewValue(item.state, 400) : '';
          const size = item?.size ? previewValue(item.size, 120) : '';
          const label = name || componentId || 'custom-shape';
          const meta = [size ? `size:${size}` : '', state ? `state:${state}` : ''].filter(Boolean).join(' ');
          return `- ${label}${meta ? ` (${meta})` : ''}`;
        })
        .filter(Boolean);
      if (lines.length) sections.push(`## Canvas Components\n${lines.join('\n')}`);
      continue;
    }

    if (type === 'selection_ids') {
      const ids = Array.isArray((part as any).ids) ? (part as any).ids : [];
      if (ids.length) sections.push(`## Selection\n${ids.join(', ')}`);
      continue;
    }

    if (type === 'dispatch_metadata') {
      const metadata = (part as any).metadata;
      if (metadata != null) {
        sections.push(`## Dispatch Metadata\n${previewValue(metadata, 800)}`);
      }
      continue;
    }

    sections.push(`## ${type}\n${previewValue(part, 800)}`);
  }

  return sections.join('\n\n');
}
