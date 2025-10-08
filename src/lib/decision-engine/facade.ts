import { normalizeTranscript } from './core/normalize';
import { detectIntent, evaluateRules } from './core/rules';
import { computeScore } from './core/scoring';
import { choosePlan } from './core/plan';
import type { DecisionEngineConfig, PlanOutput } from './core/types';

export function decide(transcript: string, config: DecisionEngineConfig = {}): PlanOutput {
  const normalized = normalizeTranscript(transcript);
  const intent = detectIntent(normalized, config);
  const evaluation = evaluateRules(normalized);
  const score = computeScore(evaluation);
  return choosePlan(normalized, intent, evaluation, score);
}
