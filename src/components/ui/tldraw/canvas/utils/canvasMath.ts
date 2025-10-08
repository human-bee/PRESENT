export function clampZoom(zoom: number, min = 0.1, max = 4): number {
  return Math.min(max, Math.max(min, zoom));
}

export function getGridSpacing(zoom: number, base = 100) {
  const scaled = base * zoom;
  const clamped = Math.min(400, Math.max(20, scaled));
  return {
    major: clamped,
    minor: clamped / 4,
  };
}

export function snapToGrid(value: number, spacing: number): number {
  return Math.round(value / spacing) * spacing;
}

