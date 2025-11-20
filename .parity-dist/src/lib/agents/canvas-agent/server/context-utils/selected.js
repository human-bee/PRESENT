import { shapeBounds } from './geometry';
const coerceStyle = (shape) => {
    const props = typeof shape.meta === 'object' && shape.meta ? shape.meta : {};
    const styleSource = shape.style ?? props;
    const lookup = (key) => {
        const value = styleSource[key];
        return typeof value === 'string' && value.length > 0 ? value : null;
    };
    return {
        color: lookup('color'),
        fill: lookup('fill'),
        dash: lookup('dash'),
        size: lookup('size'),
    };
};
const extractText = (shape) => {
    const direct = shape.text;
    if (typeof direct === 'string')
        return direct;
    const meta = typeof shape.meta === 'object' && shape.meta ? shape.meta : {};
    const metaText = meta.text;
    return typeof metaText === 'string' ? metaText : null;
};
export function simpleSelected(shapes, selection, cap = 24) {
    if (!Array.isArray(selection) || selection.length === 0)
        return [];
    const byId = new Map(shapes.map((shape) => [shape.id, shape]));
    const result = [];
    for (const id of selection) {
        const shape = byId.get(id);
        if (!shape)
            continue;
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
        if (result.length >= cap)
            break;
    }
    return result;
}
//# sourceMappingURL=selected.js.map