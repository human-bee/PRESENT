export type Bounds = { x: number; y: number; w: number; h: number };

export type ShapeLike = {
  id: string;
  type: string;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  meta?: Record<string, unknown>;
};

const toNumber = (value: unknown): number | undefined => (typeof value === 'number' ? value : undefined);

const extractScalar = (shape: ShapeLike, key: 'x' | 'y' | 'w' | 'h') => {
  const direct = toNumber((shape as Record<string, unknown>)[key]);
  if (direct !== undefined) return direct;
  const fromMeta = toNumber(shape.meta?.[key]);
  if (fromMeta !== undefined) return fromMeta;
  const metaKey = key === 'w' ? 'width' : key === 'h' ? 'height' : key;
  return toNumber(shape.meta?.[metaKey]);
};

export const shapeBounds = (shape: ShapeLike): Bounds | null => {
  const x = extractScalar(shape, 'x');
  const y = extractScalar(shape, 'y');
  const w = extractScalar(shape, 'w');
  const h = extractScalar(shape, 'h');
  if (x === undefined || y === undefined || w === undefined || h === undefined) {
    return null;
  }
  return { x, y, w, h };
};

export const intersects = (a: Bounds, b: Bounds): boolean => {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
};

export const shapesInViewport = (all: ShapeLike[], viewport?: Bounds, cap = 300): ShapeLike[] => {
  if (!viewport) return all.slice(0, cap);
  const filtered: ShapeLike[] = [];
  for (const shape of all) {
    const bounds = shapeBounds(shape);
    if (!bounds) continue;
    if (intersects(bounds, viewport)) {
      filtered.push(shape);
      if (filtered.length >= cap) break;
    }
  }
  return filtered;
};

export const toBlurryShape = (shape: ShapeLike) => {
  const bounds = shapeBounds(shape);
  const meta = typeof shape.meta === 'object' && shape.meta ? (shape.meta as Record<string, unknown>) : undefined;
  const text =
    typeof (shape as any).text === 'string'
      ? (shape as any).text
      : typeof meta?.text === 'string'
        ? (meta.text as string)
        : null;
  const label =
    typeof (shape as any).label === 'string'
      ? (shape as any).label
      : typeof meta?.label === 'string'
        ? (meta.label as string)
        : null;
  const parentId = typeof (shape as any).parentId === 'string' ? ((shape as any).parentId as string) : null;
  return {
    id: shape.id,
    type: shape.type,
    x: bounds?.x ?? null,
    y: bounds?.y ?? null,
    w: bounds?.w ?? null,
    h: bounds?.h ?? null,
    text,
    label,
    parentId,
  };
};

