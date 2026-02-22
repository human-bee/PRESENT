import { describe, expect, it } from '@jest/globals';
import { sanitizeShapeProps } from './shape-utils';

describe('sanitizeShapeProps line normalization', () => {
  it('converts endPoint props into TLDraw line points records', () => {
    const result = sanitizeShapeProps(
      {
        endPoint: { x: 24, y: 96 },
        endArrowType: 'arrow',
        color: 'red',
      },
      'line',
    );

    expect(result.points).toEqual({
      a1: { id: 'a1', index: 'a1', x: 0, y: 0 },
      a2: { id: 'a2', index: 'a2', x: 24, y: 96 },
    });
    expect(result.endPoint).toBeUndefined();
    expect(result.startPoint).toBeUndefined();
    expect((result as Record<string, unknown>).endArrowType).toBeUndefined();
  });

  it('preserves valid points and strips unsupported endpoint props', () => {
    const result = sanitizeShapeProps(
      {
        startPoint: { x: 10, y: 12 },
        endPoint: { x: 30, y: 42 },
        points: {
          a1: { id: 'a1', index: 'a1', x: 1, y: 2 },
          a2: { id: 'a2', index: 'a2', x: 9, y: 10 },
        },
      },
      'line',
    );

    expect(result.points).toEqual({
      a1: { id: 'a1', index: 'a1', x: 1, y: 2 },
      a2: { id: 'a2', index: 'a2', x: 9, y: 10 },
    });
    expect(result.endPoint).toBeUndefined();
    expect(result.startPoint).toBeUndefined();
  });

  it('rewrites malformed line point maps into valid indexed point records', () => {
    const result = sanitizeShapeProps(
      {
        points: {
          p1: { x: -40, y: 20 },
          p2: { x: 80, y: 20 },
        },
      },
      'line',
    );

    expect(result.points).toEqual({
      a1: { id: 'a1', index: 'a1', x: -40, y: 20 },
      a2: { id: 'a2', index: 'a2', x: 80, y: 20 },
    });
  });

  it('falls back to a deterministic second point when only one point is provided', () => {
    const result = sanitizeShapeProps(
      {
        points: [{ x: 10, y: 30 }],
      },
      'line',
    ) as Record<string, unknown>;

    expect(result.points).toEqual({
      a1: { id: 'a1', index: 'a1', x: 10, y: 30 },
      a2: { id: 'a2', index: 'a2', x: 130, y: 30 },
    });
  });
});

describe('sanitizeShapeProps note normalization', () => {
  it('strips unsupported width/height props for notes', () => {
    const result = sanitizeShapeProps(
      {
        text: 'BUNNY_LOOKS_ENERGETIC',
        w: 200,
        h: 100,
        color: 'yellow',
      },
      'note',
    ) as Record<string, unknown>;

    expect(result.w).toBeUndefined();
    expect(result.h).toBeUndefined();
    expect(result.text).toBeUndefined();
    expect(result.richText).toBeDefined();
  });
});
