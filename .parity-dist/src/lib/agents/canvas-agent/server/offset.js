export const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
export class OffsetManager {
    constructor() {
        this.origin = { x: 0, y: 0 };
    }
    setOrigin(v) {
        this.origin = { x: v.x, y: v.y };
    }
    getOrigin() {
        return this.origin;
    }
    serialize(point) {
        return sub(point, this.origin);
    }
    interpret(point) {
        return add(point, this.origin);
    }
}
export function serializeBounds(bounds, offset) {
    const { x, y } = offset.serialize({ x: bounds.x, y: bounds.y });
    return { ...bounds, x, y };
}
export function interpretBounds(bounds, offset) {
    const { x, y } = offset.interpret({ x: bounds.x, y: bounds.y });
    return { ...bounds, x, y };
}
//# sourceMappingURL=offset.js.map