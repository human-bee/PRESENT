type Rect = { x: number; y: number; w: number; h: number };

/** Keep new instruments near the viewport without covering existing work. */
export function findOpenPosition(preferred: Rect, occupied: readonly Rect[], gap = 28): { x: number; y: number } {
  const boxes = occupied.filter(box => [box.x, box.y, box.w, box.h].every(Number.isFinite) && box.w > 0 && box.h > 0);
  const clear = ({ x, y }: { x: number; y: number }) => boxes.every(box =>
    x + preferred.w + gap <= box.x || box.x + box.w + gap <= x || y + preferred.h + gap <= box.y || box.y + box.h + gap <= y);
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
