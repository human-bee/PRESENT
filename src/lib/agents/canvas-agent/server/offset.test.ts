import { OffsetManager, serializeBounds, interpretBounds } from './offset';

describe('OffsetManager', () => {
  it('serializes and interprets points and bounds without drift', () => {
    const offset = new OffsetManager();
    offset.setOrigin({ x: 100, y: 50 });

    const modelPoint = offset.serialize({ x: 120, y: 80 });
    expect(modelPoint).toEqual({ x: 20, y: 30 });

    const worldPoint = offset.interpret(modelPoint);
    expect(worldPoint).toEqual({ x: 120, y: 80 });

    const normalizedBounds = serializeBounds({ x: 140, y: 90, w: 20, h: 10 }, offset);
    expect(normalizedBounds).toEqual({ x: 40, y: 40, w: 20, h: 10 });

    const worldBounds = interpretBounds(normalizedBounds, offset);
    expect(worldBounds).toEqual({ x: 140, y: 90, w: 20, h: 10 });
  });
});

