import { z } from 'zod';

const ApplyConfigSchema = z
  .object({
    // Legacy field tolerated for backwards compatibility with previously written payloads.
    internalToken: z.string().trim().min(1).optional(),
    vercel: z
      .object({
        token: z.string().trim().min(1).optional(),
        teamId: z.string().trim().min(1).optional(),
        projectId: z.string().trim().min(1).optional(),
        projectName: z.string().trim().min(1).optional(),
      })
      .strict()
      .optional(),
    railway: z
      .object({
        token: z.string().trim().min(1).optional(),
        projectId: z.string().trim().min(1).optional(),
        environmentId: z.string().trim().min(1).optional(),
        environmentName: z.string().trim().min(1).optional(),
        conductorServiceId: z.string().trim().min(1).optional(),
        realtimeServiceId: z.string().trim().min(1).optional(),
        conductorServiceName: z.string().trim().min(1).optional(),
        realtimeServiceName: z.string().trim().min(1).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export type ModelControlApplyConfig = z.infer<typeof ApplyConfigSchema>;

let cachedRaw: string | null = null;
let cachedConfig: ModelControlApplyConfig | null = null;

const normalizeRawConfig = (raw: string): string => {
  let normalized = raw.trim();
  // Vercel CLI env updates can accidentally persist a trailing literal "\n".
  while (normalized.endsWith('\\n') || normalized.endsWith('\\r')) {
    normalized = normalized.slice(0, -2).trimEnd();
  }
  return normalized;
};

export function getModelControlApplyConfig(): ModelControlApplyConfig {
  const raw = normalizeRawConfig(process.env.MODEL_CONTROL_APPLY_CONFIG_JSON || '');
  if (!raw) return {};
  if (cachedConfig && cachedRaw === raw) {
    return cachedConfig;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Invalid MODEL_CONTROL_APPLY_CONFIG_JSON: expected valid JSON');
  }
  const result = ApplyConfigSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error('Invalid MODEL_CONTROL_APPLY_CONFIG_JSON: schema validation failed');
  }
  cachedRaw = raw;
  cachedConfig = result.data;
  return result.data;
}

export function pickFirstNonEmpty(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return null;
}
