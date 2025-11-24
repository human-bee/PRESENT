const DEFAULT_REASON = 'Heuristic decision';
export function choosePlan(normalized, intent, evaluation, score) {
    if (evaluation.isSingleWord) {
        return {
            shouldSend: false,
            summary: normalized.trimmed || normalized.raw,
            confidence: Math.max(25, score.total),
            reason: 'Single word utterance without actionable keyword',
            intent: intent.intent,
            structuredContext: intent.structuredContext,
        };
    }
    const shouldSend = score.total >= 60 || evaluation.hasDecisionKeyword;
    const reason = evaluation.hasDecisionKeyword ? 'Contains actionable keyword' : DEFAULT_REASON;
    return {
        shouldSend,
        summary: normalized.trimmed || normalized.raw,
        confidence: score.total,
        reason,
        intent: intent.intent,
        structuredContext: intent.structuredContext,
    };
}
//# sourceMappingURL=plan.js.map