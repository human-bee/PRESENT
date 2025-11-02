import { simpleSelected } from './selected';

describe('simpleSelected', () => {
  const shapes = [
    { id: 'a', type: 'text', x: 0, y: 0, w: 100, h: 40, meta: { text: 'Hello', color: 'blue' } },
    { id: 'b', type: 'rect', x: 50, y: 80, w: 120, h: 60, meta: { fill: 'solid', dash: 'dashed' } },
  ];

  it('returns simplified entries respecting cap', () => {
    const result = simpleSelected(shapes as any, ['a', 'b'], 1);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: 'a', type: 'text', text: 'Hello' });
  });

  it('includes style hints when available', () => {
    const result = simpleSelected(shapes as any, ['b']);
    expect(result[0]?.style).toEqual(
      expect.objectContaining({ color: null, fill: 'solid', dash: 'dashed' }),
    );
  });
});

