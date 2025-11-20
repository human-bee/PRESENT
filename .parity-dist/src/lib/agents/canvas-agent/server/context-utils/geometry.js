const toNumber = (value) => (typeof value === 'number' ? value : undefined);
const extractScalar = (shape, key) => {
    const direct = toNumber(shape[key]);
    if (direct !== undefined)
        return direct;
    const fromMeta = toNumber(shape.meta?.[key]);
    if (fromMeta !== undefined)
        return fromMeta;
    const metaKey = key === 'w' ? 'width' : key === 'h' ? 'height' : key;
    return toNumber(shape.meta?.[metaKey]);
};
export const shapeBounds = (shape) => {
    const x = extractScalar(shape, 'x');
    const y = extractScalar(shape, 'y');
    const w = extractScalar(shape, 'w');
    const h = extractScalar(shape, 'h');
    if (x === undefined || y === undefined || w === undefined || h === undefined) {
        return null;
    }
    return { x, y, w, h };
};
export const intersects = (a, b) => {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
};
export const shapesInViewport = (all, viewport, cap = 300) => {
    if (!viewport)
        return all.slice(0, cap);
    const filtered = [];
    for (const shape of all) {
        const bounds = shapeBounds(shape);
        if (!bounds)
            continue;
        if (intersects(bounds, viewport)) {
            filtered.push(shape);
            if (filtered.length >= cap)
                break;
        }
    }
    return filtered;
};
export const toBlurryShape = (shape) => {
    const bounds = shapeBounds(shape);
    const meta = typeof shape.meta === 'object' && shape.meta ? shape.meta : undefined;
    const text = typeof shape.text === 'string'
        ? shape.text
        : typeof meta?.text === 'string'
            ? meta.text
            : null;
    const label = typeof shape.label === 'string'
        ? shape.label
        : typeof meta?.label === 'string'
            ? meta.label
            : null;
    const parentId = typeof shape.parentId === 'string' ? shape.parentId : null;
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
//# sourceMappingURL=geometry.js.map