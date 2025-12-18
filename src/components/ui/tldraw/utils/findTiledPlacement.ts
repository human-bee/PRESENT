type Rect = { x: number; y: number; w: number; h: number };

type ViewportBounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  midX: number;
  midY: number;
  w: number;
  h: number;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const snap = (value: number, step: number) => Math.round(value / step) * step;

const intersects = (a: Rect, b: Rect) =>
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

const getShapeRect = (shape: any): Rect | null => {
  const w = Number(shape?.props?.w);
  const h = Number(shape?.props?.h);
  const x = Number(shape?.x);
  const y = Number(shape?.y);
  if (![w, h, x, y].every((n) => Number.isFinite(n))) return null;
  return { x, y, w, h };
};

export function findTiledPlacement(
  editor: any,
  size: { w: number; h: number },
  opts?: {
    margin?: number;
    gap?: number;
    step?: number;
    placeableTypes?: string[];
    viewport?: ViewportBounds | null;
  },
): { x: number; y: number } {
  if (!editor) return { x: Math.random() * 500, y: Math.random() * 300 };

  const viewport: ViewportBounds | null =
    opts?.viewport ?? (editor.getViewportPageBounds?.() as ViewportBounds | null) ?? null;
  if (!viewport) return { x: Math.random() * 500, y: Math.random() * 300 };

  const margin = typeof opts?.margin === 'number' ? opts.margin : 48;
  const gap = typeof opts?.gap === 'number' ? opts.gap : 24;
  const step = typeof opts?.step === 'number' ? opts.step : 24;
  const placeables = new Set(opts?.placeableTypes ?? ['custom', 'toolbox', 'mermaid_stream', 'infographic']);

  const viewMinX = viewport.minX + margin;
  const viewMinY = viewport.minY + margin;
  const viewMaxX = viewport.maxX - margin - size.w;
  const viewMaxY = viewport.maxY - margin - size.h;

  const extendedPadX = viewport.w * 2 + margin;
  const extendedPadY = viewport.h * 2 + margin;
  const extMinX = viewport.minX - extendedPadX;
  const extMinY = viewport.minY - extendedPadY;
  const extMaxX = viewport.maxX + extendedPadX - size.w;
  const extMaxY = viewport.maxY + extendedPadY - size.h;

  const occupiedFromEditor = (editor.getCurrentPageShapes?.() ?? [])
    .filter((shape: any) => shape && placeables.has(shape.type))
    .map((shape: any) => getShapeRect(shape))
    .filter(Boolean)
    .map((rect: any) => ({
      x: rect.x - gap / 2,
      y: rect.y - gap / 2,
      w: rect.w + gap,
      h: rect.h + gap,
    })) as Rect[];

  const rawCenterX = viewport.midX - size.w / 2;
  const rawCenterY = viewport.midY - size.h / 2;
  const canClampToView = viewMaxX >= viewMinX && viewMaxY >= viewMinY;
  const centered = {
    x: canClampToView ? snap(clamp(rawCenterX, viewMinX, viewMaxX), step) : snap(rawCenterX, step),
    y: canClampToView ? snap(clamp(rawCenterY, viewMinY, viewMaxY), step) : snap(rawCenterY, step),
  };

  if (occupiedFromEditor.length === 0) {
    return centered;
  }

  const isInBounds = (x: number, y: number) => x >= extMinX && x <= extMaxX && y >= extMinY && y <= extMaxY;
  const isFree = (x: number, y: number) => {
    const rect = { x, y, w: size.w, h: size.h };
    return !occupiedFromEditor.some((occ) => intersects(rect, occ));
  };

  const startRect = { x: centered.x, y: centered.y, w: size.w, h: size.h };
  if (!occupiedFromEditor.some((rect) => intersects(startRect, rect))) {
    return centered;
  }

  const maxRadius = Math.max(80, Math.ceil(Math.max(viewport.w, viewport.h) / step));
  for (let radius = 1; radius <= maxRadius; radius += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      const x = centered.x + dx * step;
      const yTop = centered.y - radius * step;
      const yBottom = centered.y + radius * step;
      if (isInBounds(x, yTop) && isFree(x, yTop)) return { x, y: yTop };
      if (isInBounds(x, yBottom) && isFree(x, yBottom)) return { x, y: yBottom };
    }
    for (let dy = -radius + 1; dy <= radius - 1; dy += 1) {
      const y = centered.y + dy * step;
      const xLeft = centered.x - radius * step;
      const xRight = centered.x + radius * step;
      if (isInBounds(xLeft, y) && isFree(xLeft, y)) return { x: xLeft, y };
      if (isInBounds(xRight, y) && isFree(xRight, y)) return { x: xRight, y };
    }
  }

  return centered;
}

