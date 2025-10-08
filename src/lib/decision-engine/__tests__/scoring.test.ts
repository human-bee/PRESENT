import { computeScore } from '../core/scoring';

describe('scoring', () => {
  it('penalizes single word utterances', () => {
    const score = computeScore({ isSingleWord: true, hasDecisionKeyword: false });
    expect(score.total).toBeLessThan(50);
  });

  it('rewards actionable keywords', () => {
    const score = computeScore({ isSingleWord: false, hasDecisionKeyword: true });
    expect(score.total).toBeGreaterThan(50);
  });
});
