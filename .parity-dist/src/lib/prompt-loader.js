/**
 * Minimal prompt loader for agent + YouTube helpers.
 * Uses in-memory templates with clear placeholders.
 */
const PROMPTS = {
    enhancedDecisionTemplate: `You are a meeting-aware decision engine.

Given the following conversational input (with context already embedded), decide whether to forward it to the UI generation system.

Return strict JSON with fields: should_send (boolean), summary (<= 60 words), confidence (0-100), reason.

INPUT:
%TRANSCRIPT%
`,
    videoQualityAnalysis: `Analyze a list of YouTube videos for quality.
Consider:
- recency
- verified/official channels
- view-to-like ratios
- content depth vs clickbait
Return a brief rubric and how to score results 1-5.
`,
};
export async function getPrompt(name) {
    const found = PROMPTS[name];
    if (found)
        return found;
    // Safe fallback prompt to keep agent running if a name is unknown
    return `Provide a concise JSON decision for the following input:\n%TRANSCRIPT%`;
}
//# sourceMappingURL=prompt-loader.js.map