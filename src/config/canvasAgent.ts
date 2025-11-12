import { z } from 'zod';

const DEFAULT_SCREENSHOT_TIMEOUT_MS = 3500;
const MIN_SCREENSHOT_TIMEOUT_MS = 2500;

const coerceScreenshotTimeout = (value?: string): number => {
  const parsed = value ? Number.parseInt(value, 10) : DEFAULT_SCREENSHOT_TIMEOUT_MS;
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_SCREENSHOT_TIMEOUT_MS;
  }
  return Math.max(parsed, MIN_SCREENSHOT_TIMEOUT_MS);
};

const CanvasAgentEnvSchema = z
  .object({
  CANVAS_AGENT_UNIFIED: z
    .string()
    .optional()
    .transform((v) => v === undefined ? true : v === 'true'),
  CANVAS_STEWARD_MODEL: z.string().optional(),
  CANVAS_STEWARD_DEBUG: z
    .string()
    .optional()
    .transform((v) => v === 'true'),
  CANVAS_AGENT_SCREENSHOT_TIMEOUT_MS: z
    .string()
    .optional()
    .transform((v) => coerceScreenshotTimeout(v))
    .pipe(z.number().int().positive()),
  CANVAS_AGENT_TTFB_SLO_MS: z
    .string()
    .optional()
    .transform((v) => (v ? Number.parseInt(v, 10) : 200))
    .pipe(z.number().int().positive()),
  NEXT_PUBLIC_CANVAS_AGENT_CLIENT_ENABLED: z
    .string()
    .optional()
    .transform((v) => v === 'true'),
  CANVAS_AGENT_MAX_FOLLOWUPS: z
    .string()
    .optional()
    .transform((v) => (v ? Number.parseInt(v, 10) : 3))
    .pipe(z.number().int().nonnegative()),
  })
  .passthrough();

export type CanvasAgentConfig = {
  unified: boolean;
  modelName?: string;
  debug: boolean;
  screenshotTimeoutMs: number;
  ttfbSloMs: number;
  clientEnabled: boolean;
  maxFollowups: number;
};

export function getCanvasAgentConfig(): CanvasAgentConfig {
  const parsed = CanvasAgentEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    try {
      console.warn('[CanvasAgent] Invalid env, using defaults', parsed.error.flatten());
    } catch {}
  }
  const env = parsed.success ? parsed.data : ({} as any);
  return {
    unified: Boolean(env.CANVAS_AGENT_UNIFIED ?? true),
    modelName: env.CANVAS_STEWARD_MODEL,
    debug: Boolean(env.CANVAS_STEWARD_DEBUG ?? false),
    screenshotTimeoutMs:
      typeof env.CANVAS_AGENT_SCREENSHOT_TIMEOUT_MS === 'number'
        ? env.CANVAS_AGENT_SCREENSHOT_TIMEOUT_MS
        : DEFAULT_SCREENSHOT_TIMEOUT_MS,
    ttfbSloMs: Number(env.CANVAS_AGENT_TTFB_SLO_MS ?? 200),
    clientEnabled: Boolean(env.NEXT_PUBLIC_CANVAS_AGENT_CLIENT_ENABLED ?? false),
    maxFollowups: Number(env.CANVAS_AGENT_MAX_FOLLOWUPS ?? 3),
  };
}
