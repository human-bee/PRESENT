import { peripheralClusters } from './peripheral';

const makeShape = (id: string, x: number, y: number, w = 40, h = 40) => ({
  id,
  type: 'geo',
  x,
  y,
  w,
  h,
  meta: { width: w, height: h },
});

describe('peripheralClusters', () => {
  it('groups shapes outside the viewport', () => {
    const viewport = { x: 0, y: 0, w: 200, h: 200 };
    const shapes = [
      makeShape('in-view', 10, 10),
      makeShape('right-1', 400, 10),
      makeShape('right-2', 450, 30),
      makeShape('left-1', -420, 0),
      makeShape('left-2', -460, -20),
    ];

    const clusters = peripheralClusters(shapes as any, viewport, 320, 10);
    expect(clusters.length).toBeGreaterThan(0);
    expect(clusters[0].sample.length).toBeGreaterThan(0);
  });
});

