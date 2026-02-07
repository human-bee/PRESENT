import { flowchartSteward, runFlowchartSteward } from './flowchart-steward';
import {
  flowchartStewardFastReady,
  runFlowchartStewardFast,
} from './flowchart-steward-fast';
import { BYOK_REQUIRED } from '@/lib/agents/shared/byok-flags';
import { getDecryptedUserModelKey } from '@/lib/agents/shared/user-model-keys';

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
    console.warn(
      '⚠️ [StewardRegistry] FLOWCHART_STEWARD_VARIANT requests FAST but CEREBRAS_API_KEY is missing. Falling back to standard steward.',
    );
  } catch {}
}

export const isFlowchartStewardFastActive = prefersFast && flowchartStewardFastReady;

// For backwards compat - returns the slow Agent instance (fast variant doesn't use Agent)
export const activeFlowchartSteward = flowchartSteward;

export type FlowchartStewardMode = 'auto' | 'fast' | 'slow';

export async function runActiveFlowchartSteward(params: {
  room: string;
  docId: string;
  windowMs?: number;
  mode?: FlowchartStewardMode;
  billingUserId?: string;
}) {
  const { mode = 'auto', billingUserId, ...rest } = params;
  if (mode === 'slow') {
    return runFlowchartSteward({ ...rest, billingUserId });
  }
  if (mode === 'fast') {
    if (BYOK_REQUIRED && billingUserId) {
      const cerebrasKey = await getDecryptedUserModelKey({ userId: billingUserId, provider: 'cerebras' });
      if (!cerebrasKey) {
        return runFlowchartSteward({ ...rest, billingUserId });
      }
    }
    if (flowchartStewardFastReady) {
      return runFlowchartStewardFast({ ...rest, billingUserId });
    }
    return runFlowchartSteward({ ...rest, billingUserId });
  }
  if (BYOK_REQUIRED && billingUserId) {
    const cerebrasKey = await getDecryptedUserModelKey({ userId: billingUserId, provider: 'cerebras' });
    if (cerebrasKey) {
      return runFlowchartStewardFast({ ...rest, billingUserId });
    }
    return runFlowchartSteward({ ...rest, billingUserId });
  }
  if (isFlowchartStewardFastActive) {
    return runFlowchartStewardFast({ ...rest, billingUserId });
  }
  return runFlowchartSteward({ ...rest, billingUserId });
}
