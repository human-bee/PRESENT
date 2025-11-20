import { shapeBounds } from './geometry';
export const peripheralClusters = (shapes, viewport, gridSize = 320, cap = 24) => {
    if (!viewport)
        return [];
    const buckets = new Map();
    for (const shape of shapes) {
        const bounds = shapeBounds(shape);
        if (!bounds)
            continue;
        const overlapsViewport = bounds.x + bounds.w > viewport.x &&
            bounds.x < viewport.x + viewport.w &&
            bounds.y + bounds.h > viewport.y &&
            bounds.y < viewport.y + viewport.h;
        if (overlapsViewport)
            continue;
        const cx = bounds.x + bounds.w / 2;
        const cy = bounds.y + bounds.h / 2;
        const gx = Math.floor(cx / gridSize);
        const gy = Math.floor(cy / gridSize);
        const key = `${gx}:${gy}`;
        const entry = buckets.get(key) ?? { sumX: 0, sumY: 0, ids: [] };
        entry.sumX += cx;
        entry.sumY += cy;
        if (entry.ids.length < 5)
            entry.ids.push(shape.id);
        buckets.set(key, entry);
    }
    const clusters = [];
    for (const [, entry] of buckets) {
        const { ids, sumX, sumY } = entry;
        if (!ids.length)
            continue;
        clusters.push({ cx: sumX / ids.length, cy: sumY / ids.length, count: ids.length, sample: [...ids] });
    }
    clusters.sort((a, b) => b.count - a.count);
    return clusters.slice(0, cap);
};
//# sourceMappingURL=peripheral.js.map