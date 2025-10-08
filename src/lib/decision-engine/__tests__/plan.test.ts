import { choosePlan } from '../core/plan';
import { normalizeTranscript } from '../core/normalize';
import { detectIntent, evaluateRules } from '../core/rules';
import { computeScore } from '../core/scoring';

describe('plan', () => {
  it('suppresses single word utterance', () => {
    const normalized = normalizeTranscript('Hi');
    const intent = detectIntent(normalized, {});
    const evaluation = evaluateRules(normalized);
    const score = computeScore(evaluation);
    const plan = choosePlan(normalized, intent, evaluation, score);
    expect(plan.shouldSend).toBe(false);
    expect(plan.confidence).toBeLessThanOrEqual(50);
  });

  it('approves actionable request', () => {
    const normalized = normalizeTranscript('Create a timer component for 5 minutes');
    const intent = detectIntent(normalized, {});
    const evaluation = evaluateRules(normalized);
    const score = computeScore(evaluation);
    const plan = choosePlan(normalized, intent, evaluation, score);
    expect(plan.shouldSend).toBe(true);
    expect(plan.intent).toBe('ui_component');
  });
});
