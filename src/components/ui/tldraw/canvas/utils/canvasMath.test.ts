import { clampZoom, getGridSpacing, snapToGrid } from './canvasMath';

describe('canvasMath', () => {
  describe('clampZoom', () => {
    it('clamps below minimum', () => {
      expect(clampZoom(0.01, 0.1, 4)).toBe(0.1);
    });

    it('clamps above maximum', () => {
      expect(clampZoom(10, 0.1, 4)).toBe(4);
    });

    it('returns value within range', () => {
      expect(clampZoom(1.5, 0.1, 4)).toBe(1.5);
    });
  });

  describe('getGridSpacing', () => {
    it('derives major and minor spacing based on zoom', () => {
      const spacing = getGridSpacing(0.5, 100);
      expect(spacing.major).toBeGreaterThan(0);
      expect(spacing.minor).toBe(spacing.major / 4);
    });

    it('caps spacing within thresholds', () => {
      expect(getGridSpacing(100, 100).major).toBe(400);
      expect(getGridSpacing(0.001, 100).major).toBe(20);
    });
  });

  describe('snapToGrid', () => {
    it('snaps to nearest grid multiple', () => {
      expect(snapToGrid(22, 10)).toBe(20);
      expect(snapToGrid(27, 10)).toBe(30);
    });
  });
});

