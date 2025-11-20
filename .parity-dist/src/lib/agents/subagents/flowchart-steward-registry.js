import { flowchartSteward, runFlowchartSteward } from './flowchart-steward';
import { flowchartStewardFast, flowchartStewardFastReady, runFlowchartStewardFast, } from './flowchart-steward-fast';
const FAST_VARIANT_FLAGS = new Set(['fast', 'groq', 'stewardfast', 'true', '1', 'cerebras']);
const resolveVariantFlag = () => {
    const explicitVariant = process.env.FLOWCHART_STEWARD_VARIANT;
    if (explicitVariant) {
        return explicitVariant.trim().toLowerCase();
    }
    const provider = process.env.AGENT_LLM_PROVIDER;
    return provider ? provider.trim().toLowerCase() : '';
};
const rawVariant = resolveVariantFlag();
const prefersFast = FAST_VARIANT_FLAGS.has(rawVariant);
if (prefersFast && !flowchartStewardFastReady) {
    try {
        console.warn('⚠️ [StewardRegistry] FLOWCHART_STEWARD_VARIANT requests FAST but GROQ_API_KEY is missing. Falling back to standard steward.');
    }
    catch { }
}
export const isFlowchartStewardFastActive = prefersFast && flowchartStewardFastReady;
export const activeFlowchartSteward = isFlowchartStewardFastActive
    ? flowchartStewardFast
    : flowchartSteward;
export async function runActiveFlowchartSteward(params) {
    const { mode = 'auto', ...rest } = params;
    if (mode === 'slow') {
        return runFlowchartSteward(rest);
    }
    if (mode === 'fast') {
        if (flowchartStewardFastReady) {
            return runFlowchartStewardFast(rest);
        }
        return runFlowchartSteward(rest);
    }
    if (isFlowchartStewardFastActive) {
        return runFlowchartStewardFast(rest);
    }
    return runFlowchartSteward(rest);
}
//# sourceMappingURL=flowchart-steward-registry.js.map