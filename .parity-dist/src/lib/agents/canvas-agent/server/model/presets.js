const DEFAULTS = {
    creative: { temperature: 0.85, topP: 0.95, maxOutputTokens: 4096, followups: 3 },
    precise: { temperature: 0.2, topP: 0.8, maxOutputTokens: 2048, followups: 2 },
};
const toNumber = (value) => {
    if (value === undefined)
        return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
};
export function resolvePreset(env = process.env) {
    const raw = (env.CANVAS_AGENT_PRESET || 'creative').toLowerCase().trim();
    return raw === 'precise' ? 'precise' : 'creative';
}
export function getModelTuning(preset, env = process.env) {
    const base = DEFAULTS[preset];
    const temperature = toNumber(env.CANVAS_AGENT_TEMPERATURE) ?? base.temperature;
    const topP = toNumber(env.CANVAS_AGENT_TOP_P) ?? base.topP;
    const maxOutputTokens = toNumber(env.CANVAS_AGENT_MAX_OUT) ?? base.maxOutputTokens;
    return { temperature, topP, maxOutputTokens };
}
export function resolveFollowupDepth(env = process.env, preset) {
    const preferred = toNumber(env.CANVAS_AGENT_FOLLOWUP_MAX_DEPTH) ?? toNumber(env.CANVAS_AGENT_MAX_FOLLOWUPS);
    if (preferred !== undefined)
        return Math.max(0, Math.floor(preferred));
    const effectivePreset = preset ?? resolvePreset(env);
    return DEFAULTS[effectivePreset].followups;
}
//# sourceMappingURL=presets.js.map