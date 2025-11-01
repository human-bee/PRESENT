export type CanvasAgentPreset = 'creative' | 'precise';

const DEFAULTS = {
  creative: { temperature: 0.85, topP: 0.95, maxOutputTokens: 4096, followups: 3 },
  precise: { temperature: 0.2, topP: 0.8, maxOutputTokens: 2048, followups: 2 },
} as const;

const toNumber = (value: string | undefined): number | undefined => {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

export function resolvePreset(env: NodeJS.ProcessEnv = process.env): CanvasAgentPreset {
  const raw = (env.CANVAS_AGENT_PRESET || 'creative').toLowerCase().trim();
  return raw === 'precise' ? 'precise' : 'creative';
}

export type ModelTuning = {
  temperature: number;
  topP: number;
  maxOutputTokens: number;
};

export function getModelTuning(preset: CanvasAgentPreset, env: NodeJS.ProcessEnv = process.env): ModelTuning {
  const base = DEFAULTS[preset];
  const temperature = toNumber(env.CANVAS_AGENT_TEMPERATURE) ?? base.temperature;
  const topP = toNumber(env.CANVAS_AGENT_TOP_P) ?? base.topP;
  const maxOutputTokens = toNumber(env.CANVAS_AGENT_MAX_OUT) ?? base.maxOutputTokens;
  return { temperature, topP, maxOutputTokens };
}

export function resolveFollowupDepth(env: NodeJS.ProcessEnv = process.env, preset?: CanvasAgentPreset): number {
  const preferred = toNumber(env.CANVAS_AGENT_FOLLOWUP_MAX_DEPTH) ?? toNumber(env.CANVAS_AGENT_MAX_FOLLOWUPS);
  if (preferred !== undefined) return Math.max(0, Math.floor(preferred));
  const effectivePreset = preset ?? resolvePreset(env);
  return DEFAULTS[effectivePreset].followups;
}

