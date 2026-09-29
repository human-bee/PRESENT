type Rect = { x: number; y: number; w: number; h: number };

function collisionQuery(preferred: Rect, boxes: readonly Rect[], gap: number) {
  const overlaps = (point: { x: number; y: number }, box: Rect) => !(point.x + preferred.w + gap <= box.x ||
    box.x + box.w + gap <= point.x || point.y + preferred.h + gap <= box.y || box.y + box.h + gap <= point.y);
  const scan = (point: { x: number; y: number }) => !boxes.some(box => overlaps(point, box));
  if (boxes.length < 128 || !Number.isFinite(gap) || gap < 0) return scan;
  const cell = Math.max(256, preferred.w + gap, preferred.h + gap);
  const cells = new Map<string, Rect[]>(), large: Rect[] = [];
  const range = (x: number, y: number, w: number, h: number) => {
    const left = Math.floor(x / cell), top = Math.floor(y / cell);
    const right = Math.floor((x + w) / cell), bottom = Math.floor((y + h) / cell);
    // Huge coordinates/boxes take the exact scan path, never an unbounded grid loop.
    return [left, top, right, bottom].every(Number.isSafeInteger) && right - left < 8 && bottom - top < 8
      ? { left, top, right, bottom } : null;
  };
  for (const box of boxes) {
    const bounds = range(box.x, box.y, box.w, box.h);
    if (!bounds) { large.push(box); continue; }
    for (let x = bounds.left; x <= bounds.right; x++) for (let y = bounds.top; y <= bounds.bottom; y++) {
      const key = `${x},${y}`, values = cells.get(key);
      if (values) values.push(box); else cells.set(key, [box]);
    }
  }
  return (point: { x: number; y: number }) => {
    const bounds = range(point.x - gap, point.y - gap, preferred.w + 2 * gap, preferred.h + 2 * gap);
    if (!bounds) return scan(point);
    if (large.some(box => overlaps(point, box))) return false;
    for (let x = bounds.left; x <= bounds.right; x++) for (let y = bounds.top; y <= bounds.bottom; y++) {
      if (cells.get(`${x},${y}`)?.some(box => overlaps(point, box))) return false;
    }
    return true;
  };
}

/** Keep new instruments near the viewport without covering existing work. */
export function findOpenPosition(preferred: Rect, occupied: readonly Rect[], gap = 28): { x: number; y: number } {
  const boxes = occupied.filter(box => [box.x, box.y, box.w, box.h].every(Number.isFinite) && box.w > 0 && box.h > 0);
  const clear = collisionQuery(preferred, boxes, gap);
  if (clear(preferred)) return { x: preferred.x, y: preferred.y };
  const candidates = boxes.flatMap(box => {
    const left = box.x - preferred.w - gap, right = box.x + box.w + gap;
    const top = box.y - preferred.h - gap, bottom = box.y + box.h + gap;
    return [
      { x: left, y: preferred.y }, { x: right, y: preferred.y },
      { x: preferred.x, y: top }, { x: preferred.x, y: bottom },
      { x: left, y: box.y }, { x: right, y: box.y },
      { x: box.x, y: top }, { x: box.x, y: bottom },
    ];
  });
  const distance = (point: { x: number; y: number }) => (point.x - preferred.x) ** 2 + (point.y - preferred.y) ** 2;
  candidates.sort((a, b) => distance(a) - distance(b));
  return candidates.find(clear) ?? { x: Math.max(preferred.x, ...boxes.map(box => box.x + box.w + gap)), y: preferred.y };
}
