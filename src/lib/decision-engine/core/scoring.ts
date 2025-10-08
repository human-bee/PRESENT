import type { RuleEvaluation, ScoreBreakdown } from './types';

export function computeScore(evaluation: RuleEvaluation): ScoreBreakdown {
  const adjustments: ScoreBreakdown['adjustments'] = [];
  let total = 50;

  if (evaluation.isSingleWord) {
    adjustments.push({ reason: 'single_word', delta: -25 });
    total -= 25;
  }

  if (evaluation.hasDecisionKeyword) {
    adjustments.push({ reason: 'actionable_keyword', delta: 15 });
    total += 15;
  }

  total = Math.max(0, Math.min(100, total));

  return {
    base: 50,
    adjustments,
    total,
  };
}
