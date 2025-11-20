const coerceNumber = (value) => {
    if (typeof value === 'number' && Number.isFinite(value))
        return value;
    if (typeof value === 'string' && value.trim().length > 0) {
        const parsed = Number.parseFloat(value);
        if (Number.isFinite(parsed))
            return parsed;
    }
    return undefined;
};
const fallbackNote = (entry) => {
    const note = entry.label ?? entry.name ?? entry.text ?? entry.type;
    return typeof note === 'string' && note.trim().length > 0 ? note.trim() : 'shape';
};
const simpleShapeFromSummary = (shape) => {
    if (!shape?.id)
        return null;
    const meta = shape.meta || {};
    const x = coerceNumber(meta.x) ?? 0;
    const y = coerceNumber(meta.y) ?? 0;
    return {
        _type: 'unknown',
        note: fallbackNote(shape),
        shapeId: shape.id,
        subType: shape.type ?? 'shape',
        x,
        y,
    };
};
const simpleShapeFromSelection = (shape) => {
    if (!shape?.id)
        return null;
    const meta = shape.meta || {};
    const x = coerceNumber(shape.x ?? meta.x) ?? 0;
    const y = coerceNumber(shape.y ?? meta.y) ?? 0;
    return {
        _type: 'unknown',
        note: fallbackNote(shape),
        shapeId: shape.id,
        subType: shape.type ?? 'shape',
        x,
        y,
    };
};
export function buildTeacherContextItems(source) {
    const items = [];
    const selected = (source.selectedShapes ?? [])
        .map((entry) => simpleShapeFromSelection(entry))
        .filter((shape) => Boolean(shape));
    const shapes = (source.shapes ?? [])
        .map((entry) => simpleShapeFromSummary(entry))
        .filter((shape) => Boolean(shape));
    selected.slice(0, 8).forEach((shape) => {
        items.push({ type: 'shape', shape, source: 'user' });
    });
    if (shapes.length > 0) {
        items.push({ type: 'shapes', shapes: shapes.slice(0, 24), source: 'agent' });
    }
    if (source.viewport) {
        items.push({ type: 'area', bounds: source.viewport, source: 'user' });
    }
    return items;
}
//# sourceMappingURL=context-items.js.map