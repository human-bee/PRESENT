import { shapeBounds, type ShapeLike } from './geometry';

type StyleProps = {
  color: string | null;
  fill: string | null;
  dash: string | null;
  size: string | null;
};

const coerceStyle = (shape: ShapeLike): StyleProps => {
  const props = typeof shape.meta === 'object' && shape.meta ? (shape.meta as Record<string, unknown>) : {};
  const styleSource = (shape as unknown as { style?: Record<string, unknown> }).style ?? props;
  const lookup = (key: string): string | null => {
    const value = (styleSource as Record<string, unknown>)[key];
    return typeof value === 'string' && value.length > 0 ? value : null;
  };
  return {
    color: lookup('color'),
    fill: lookup('fill'),
    dash: lookup('dash'),
    size: lookup('size'),
  };
};

const extractText = (shape: ShapeLike): string | null => {
  const direct = (shape as unknown as { text?: unknown }).text;
  if (typeof direct === 'string') return direct;
  const meta = typeof shape.meta === 'object' && shape.meta ? (shape.meta as Record<string, unknown>) : {};
  const metaText = meta.text;
  return typeof metaText === 'string' ? metaText : null;
};

export function simpleSelected(shapes: ShapeLike[], selection: string[], cap = 24) {
  if (!Array.isArray(selection) || selection.length === 0) return [];
  const byId = new Map(shapes.map((shape) => [shape.id, shape]));
  const result: Array<Record<string, unknown>> = [];
  for (const id of selection) {
    const shape = byId.get(id);
    if (!shape) continue;
    const bounds = shapeBounds(shape);
    result.push({
      id: shape.id,
      type: shape.type,
      x: bounds?.x ?? null,
      y: bounds?.y ?? null,
      w: bounds?.w ?? null,
      h: bounds?.h ?? null,
      text: extractText(shape),
      style: coerceStyle(shape),
    });
    if (result.length >= cap) break;
  }
  return result;
}

