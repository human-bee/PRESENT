export type Vec = { x: number; y: number };

export const add = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y });

export class OffsetManager {
  private origin: Vec = { x: 0, y: 0 };

  setOrigin(v: Vec) {
    this.origin = { x: v.x, y: v.y };
  }

  getOrigin(): Vec {
    return this.origin;
  }

  serialize(point: Vec): Vec {
    return sub(point, this.origin);
  }

  interpret(point: Vec): Vec {
    return add(point, this.origin);
  }
}

export function serializeBounds<T extends { x: number; y: number; w: number; h: number }>(bounds: T, offset: OffsetManager): T {
  const { x, y } = offset.serialize({ x: bounds.x, y: bounds.y });
  return { ...bounds, x, y };
}

export function interpretBounds<T extends { x: number; y: number; w: number; h: number }>(bounds: T, offset: OffsetManager): T {
  const { x, y } = offset.interpret({ x: bounds.x, y: bounds.y });
  return { ...bounds, x, y };
}

