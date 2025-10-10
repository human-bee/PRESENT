import { describe, expect, it } from '@jest/globals';
import { summarizeCanvasSnapshot } from '../supabase-context';

describe('summarizeCanvasSnapshot', () => {
  it('returns sorted lightweight summaries for TLDraw shapes', () => {
    const snapshot = {
      store: {
        'shape:rect1': {
          typeName: 'shape',
          id: 'shape:rect1',
          type: 'geo',
          index: 'a1',
          x: 10,
          y: 20,
          props: { w: 120, h: 80, text: 'Box' },
        },
        'camera:page': { typeName: 'camera', id: 'camera:page' },
        'shape:ellipse1': {
          typeName: 'shape',
          id: 'shape:ellipse1',
          type: 'geo',
          index: 'a2',
          x: 100,
          y: 120,
          props: { w: 60, h: 60, label: 'Circle' },
        },
      },
    };

    const result = summarizeCanvasSnapshot(snapshot, 10);
    expect(result.shapeCount).toBe(2);
    expect(result.shapes).toEqual([
      expect.objectContaining({ id: 'shape:rect1', type: 'geo', text: 'Box', index: 'a1' }),
      expect.objectContaining({ id: 'shape:ellipse1', type: 'geo', label: 'Circle', index: 'a2' }),
    ]);
    expect(result.updatedAt).toEqual(expect.any(Number));
  });
});
