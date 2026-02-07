import { resolveFollowupDepth, resolvePreset, type CanvasAgentPreset } from './model/presets';

const DEFAULT_SCREENSHOT_TIMEOUT_MS = 3500;
const MIN_SCREENSHOT_TIMEOUT_MS = 2500;
const DEFAULT_SCREENSHOT_EDGE = 1024;
const MIN_SCREENSHOT_EDGE = 64;
const DEFAULT_PROMPT_MAX_CHARS = 200000;
const DEFAULT_TRANSCRIPT_WINDOW_MS = 5 * 60 * 1000;
const MIN_TRANSCRIPT_WINDOW_MS = 15 * 1000;
const MAX_TRANSCRIPT_WINDOW_MS = 30 * 60 * 1000;

const coerceScreenshotTimeout = (value?: string): number => {
  const parsed = value ? Number.parseInt(value, 10) : DEFAULT_SCREENSHOT_TIMEOUT_MS;
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_SCREENSHOT_TIMEOUT_MS;
  }
  return Math.max(parsed, MIN_SCREENSHOT_TIMEOUT_MS);
};

const clampScreenshotEdge = (value?: string, fallback = DEFAULT_SCREENSHOT_EDGE): number => {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.max(MIN_SCREENSHOT_EDGE, Math.min(4096, Math.floor(parsed)));
};

const parseDownscaleEdges = (raw: string | undefined, base: number, minEdge: number): number[] => {
  const defaults = [0.75, 0.6, 0.5, 0.4];
  const ratios = raw
    ? raw
        .split(',')
        .map((entry) => Number.parseFloat(entry.trim()))
        .filter((ratio) => Number.isFinite(ratio) && ratio > 0 && ratio < 1)
    : defaults;
  const values = ratios
    .map((ratio) => Math.max(minEdge, Math.floor(base * ratio)))
    .filter((edge) => edge < base);
  const unique = Array.from(new Set(values));
  unique.sort((a, b) => b - a);
  return unique;
};

const sanitizeEdgeList = (input: unknown, base: number, minEdge: number): number[] | undefined => {
  if (!Array.isArray(input)) return undefined;
  const edges = input
    .map((value) => Number(value))
    .filter((edge) => Number.isFinite(edge))
    .map((edge) => Math.max(minEdge, Math.min(base - 1, Math.floor(edge))));
  const unique = Array.from(new Set(edges.filter((edge) => edge < base)));
  unique.sort((a, b) => b - a);
  return unique.length ? unique : undefined;
};

const coerceTranscriptWindowMs = (value?: string): number => {
  if (!value) return DEFAULT_TRANSCRIPT_WINDOW_MS;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return DEFAULT_TRANSCRIPT_WINDOW_MS;
  return Math.max(MIN_TRANSCRIPT_WINDOW_MS, Math.min(MAX_TRANSCRIPT_WINDOW_MS, parsed));
};

export type ScreenshotConfig = {
  timeoutMs: number;
  retries: number;
  retryDelayMs: number;
  maxEdge: number;
  minEdge: number;
};

export type PromptConfig = {
  maxChars: number;
  downscaleEdges: number[];
};

export type FollowupConfig = {
  maxDepth: number;
  lowActionThreshold: number;
};

export type CanvasAgentMode = 'present' | 'tldraw-teacher' | 'shadow';

export type CanvasAgentConfig = {
  modelName?: string;
  debug: boolean;
  preset: CanvasAgentPreset;
  clientEnabled: boolean;
  ttfbSloMs: number;
  mode: CanvasAgentMode;
  /** Placeholder for upcoming HTTP-based teacher worker endpoint */
  teacherEndpoint?: string;
  transcriptWindowMs: number;
  screenshot: ScreenshotConfig;
  prompt: PromptConfig;
  followups: FollowupConfig;
};

type ConfigOverrides = Partial<Omit<CanvasAgentConfig, 'screenshot' | 'prompt' | 'followups'>> & {
  screenshot?: Partial<ScreenshotConfig>;
  prompt?: Partial<PromptConfig>;
  followups?: Partial<FollowupConfig>;
};

const parseOverrides = (raw?: string): ConfigOverrides => {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      return parsed as ConfigOverrides;
    }
  } catch {
    console.warn('[CanvasAgent:Config] Failed to parse CANVAS_AGENT_CONFIG JSON; falling back to env defaults');
  }
  return {};
};

const parseAgentMode = (raw?: string): CanvasAgentMode => {
  const value = (raw ?? '').toLowerCase();
  if (value === 'teacher' || value === 'tldraw-teacher') return 'tldraw-teacher';
  if (value === 'shadow') return 'shadow';
  return 'present';
};

export function loadCanvasAgentConfig(env: NodeJS.ProcessEnv = process.env): CanvasAgentConfig {
  const preset = resolvePreset(env);
  const screenshotMaxEdge = clampScreenshotEdge(env.CANVAS_AGENT_SCREENSHOT_MAX_SIZE);
  const screenshotMinEdge = clampScreenshotEdge(
    env.CANVAS_AGENT_SCREENSHOT_MIN_EDGE,
    Math.min(512, screenshotMaxEdge),
  );
  const teacherEndpoint = (env.CANVAS_TEACHER_ENDPOINT ?? '').trim();
  const promptDownscaleEdges = parseDownscaleEdges(
    env.CANVAS_AGENT_PROMPT_DOWNSCALE_RATIOS,
    screenshotMaxEdge,
    screenshotMinEdge,
  );
  const baseConfig: CanvasAgentConfig = {
    modelName: env.CANVAS_STEWARD_MODEL,
    debug: env.CANVAS_STEWARD_DEBUG === 'true',
    preset,
    clientEnabled: env.NEXT_PUBLIC_CANVAS_AGENT_CLIENT_ENABLED === 'true',
    ttfbSloMs: Number(env.CANVAS_AGENT_TTFB_SLO_MS ?? 200),
    mode: parseAgentMode(env.CANVAS_AGENT_MODE),
    teacherEndpoint: teacherEndpoint.length ? teacherEndpoint : undefined,
    transcriptWindowMs: coerceTranscriptWindowMs(env.CANVAS_AGENT_TRANSCRIPT_WINDOW_MS),
    screenshot: {
      timeoutMs: coerceScreenshotTimeout(env.CANVAS_AGENT_SCREENSHOT_TIMEOUT_MS),
      retries: Math.max(0, Number.parseInt(env.CANVAS_AGENT_SCREENSHOT_RETRIES ?? '1', 10) || 0),
      retryDelayMs: Math.max(100, Number.parseInt(env.CANVAS_AGENT_SCREENSHOT_RETRY_DELAY_MS ?? '450', 10) || 450),
      maxEdge: screenshotMaxEdge,
      minEdge: screenshotMinEdge,
    },
    prompt: {
      maxChars: Math.max(
        120000,
        Number.parseInt(env.CANVAS_AGENT_PROMPT_MAX_CHARS ?? String(DEFAULT_PROMPT_MAX_CHARS), 10) ||
          DEFAULT_PROMPT_MAX_CHARS,
      ),
      downscaleEdges: promptDownscaleEdges,
    },
    followups: {
      maxDepth: resolveFollowupDepth(env, preset),
      lowActionThreshold: Math.max(0, Number.parseInt(env.CANVAS_AGENT_LOW_ACTION_THRESHOLD ?? '6', 10) || 6),
    },
  };

  const overrides = parseOverrides(env.CANVAS_AGENT_CONFIG);
  const merged: CanvasAgentConfig = {
    ...baseConfig,
    ...overrides,
    screenshot: { ...baseConfig.screenshot, ...(overrides.screenshot ?? {}) },
    prompt: { ...baseConfig.prompt, ...(overrides.prompt ?? {}) },
    followups: { ...baseConfig.followups, ...(overrides.followups ?? {}) },
  };

  const overrideDownscale = sanitizeEdgeList(
    overrides.prompt?.downscaleEdges,
    merged.screenshot.maxEdge,
    merged.screenshot.minEdge,
  );
  if (overrideDownscale) {
    merged.prompt.downscaleEdges = overrideDownscale;
  }

  return merged;
}
