import { normalizeTranscript } from './core/normalize';
import { detectIntent, evaluateRules } from './core/rules';
import { computeScore } from './core/scoring';
import { choosePlan } from './core/plan';
export function decide(transcript, config = {}) {
    const normalized = normalizeTranscript(transcript);
    const intent = detectIntent(normalized, config);
    const evaluation = evaluateRules(normalized);
    const score = computeScore(evaluation);
    return choosePlan(normalized, intent, evaluation, score);
}
//# sourceMappingURL=facade.js.map