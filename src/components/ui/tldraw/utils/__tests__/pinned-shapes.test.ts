import type { Editor } from '@tldraw/tldraw';
import { updatePinnedShapes } from '../pinned-shapes';

describe('pinned-shapes utilities', () => {
  it('updates pinned shapes based on viewport position', () => {
    const updateShapes = jest.fn();
    const editor = {
      getCurrentPageShapes: jest.fn(() => [
        {
          id: 'custom-1',
          type: 'custom',
          props: { pinned: true, pinnedX: 0.25, pinnedY: 0.75, w: 200, h: 100 },
        },
      ]),
      getViewportScreenBounds: jest.fn(() => ({ width: 1200, height: 800 })),
      screenToPage: jest.fn(({ x, y }: { x: number; y: number }) => ({ x, y })),
      updateShapes,
    } as unknown as Editor;

    updatePinnedShapes(editor);

    expect(updateShapes).toHaveBeenCalledTimes(1);
    const updates = updateShapes.mock.calls[0][0] as Array<Record<string, number | string>>;
    const target = updates[0] as { id: string; x: number; y: number };
    expect(target.id).toBe('custom-1');
    expect(target.x).toBeCloseTo(1200 * 0.25 - 200 / 2, 5);
    expect(target.y).toBeCloseTo(800 * 0.75 - 100 / 2, 5);
  });
});
