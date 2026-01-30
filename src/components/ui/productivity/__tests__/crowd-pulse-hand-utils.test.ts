import { computeCrowdMetrics, countExtendedFingers, type HandLandmark } from '../crowd-pulse-hand-utils';

const makeLandmarks = (open: boolean): HandLandmark[] => {
  const base = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
  const tipIndices = [8, 12, 16, 20];
  const pipIndices = [6, 10, 14, 18];
  for (let i = 0; i < tipIndices.length; i += 1) {
    base[tipIndices[i]] = { x: 0.5, y: open ? 0.2 : 0.7, z: 0 };
    base[pipIndices[i]] = { x: 0.5, y: 0.6, z: 0 };
  }
  return base;
};

describe('crowd-pulse-hand-utils', () => {
  it('counts extended fingers for an open hand', () => {
    expect(countExtendedFingers(makeLandmarks(true))).toBe(4);
  });

  it('counts zero extended fingers for a closed hand', () => {
    expect(countExtendedFingers(makeLandmarks(false))).toBe(0);
  });

  it('computes crowd metrics for open hands', () => {
    const landmarks = [makeLandmarks(true), makeLandmarks(true)];
    const metrics = computeCrowdMetrics(landmarks, [
      [{ score: 0.9 }],
      [{ score: 0.8 }],
    ]);
    expect(metrics.handCount).toBe(2);
    expect(metrics.totalHands).toBe(2);
    expect(metrics.confidence).toBeGreaterThan(0.7);
    expect(metrics.noiseLevel).toBe(0);
  });

  it('computes noise level when no open palms are found', () => {
    const landmarks = [makeLandmarks(false), makeLandmarks(false)];
    const metrics = computeCrowdMetrics(landmarks);
    expect(metrics.handCount).toBe(0);
    expect(metrics.totalHands).toBe(2);
    expect(metrics.noiseLevel).toBe(1);
  });
});
