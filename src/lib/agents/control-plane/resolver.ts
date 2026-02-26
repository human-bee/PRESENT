import { createHash } from 'node:crypto';
import { modelControlKnobsSchema, modelControlModelsSchema, modelControlPatchSchema } from './schemas';
import { getModelControlProfilesForResolution } from './profiles';
import type {
  ApplyMode,
  ModelControlPatch,
  ResolveModelControlInput,
  ResolvedModelControl,
} from './types';

const CACHE_TTL_MS = 10_000;

type CacheEntry = {
  exp: number;
  value: ResolvedModelControl;
};

const resolverCache = new Map<string, CacheEntry>();

const APPLY_MODE_BY_PATH: Array<{ prefix: string; mode: ApplyMode }> = [
  { prefix: 'knobs.conductor.taskLeaseTtlMs', mode: 'restart_required' },
  { prefix: 'knobs.conductor.taskIdlePollMs', mode: 'restart_required' },
  { prefix: 'knobs.conductor.taskIdlePollMaxMs', mode: 'restart_required' },
  { prefix: 'knobs.conductor.taskMaxRetryAttempts', mode: 'restart_required' },
  { prefix: 'knobs.conductor.taskRetryBaseDelayMs', mode: 'restart_required' },
  { prefix: 'knobs.conductor.taskRetryMaxDelayMs', mode: 'restart_required' },
  { prefix: 'knobs.conductor.taskRetryJitterRatio', mode: 'restart_required' },
  { prefix: 'knobs.conductor.roomConcurrency', mode: 'next_session' },
  { prefix: 'models.voiceRealtime', mode: 'next_session' },
  { prefix: 'models.voiceRealtimePrimary', mode: 'next_session' },
  { prefix: 'models.voiceRealtimeSecondary', mode: 'next_session' },
  { prefix: 'models.voiceRouter', mode: 'next_session' },
  { prefix: 'models.voiceStt', mode: 'next_session' },
  { prefix: 'knobs.voice.realtimeModelStrategy', mode: 'next_session' },
];

const deepMerge = <T extends Record<string, unknown>>(target: T, patch: Record<string, unknown>): T => {
  const output: Record<string, unknown> = { ...target };
  for (const [key, value] of Object.entries(patch)) {
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      output[key] &&
      typeof output[key] === 'object' &&
      !Array.isArray(output[key])
    ) {
      output[key] = deepMerge(output[key] as Record<string, unknown>, value as Record<string, unknown>);
      continue;
    }
    output[key] = value;
  }
  return output as T;
};

const flattenPaths = (value: unknown, prefix = ''): string[] => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return prefix ? [prefix] : [];
  const entries = Object.entries(value as Record<string, unknown>);
  if (!entries.length) return prefix ? [prefix] : [];
  const paths: string[] = [];
  for (const [key, next] of entries) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (!next || typeof next !== 'object' || Array.isArray(next)) {
      paths.push(path);
      continue;
    }
    paths.push(...flattenPaths(next, path));
  }
  return paths;
};

const applyModeForPath = (path: string): ApplyMode => {
  for (const entry of APPLY_MODE_BY_PATH) {
    if (path.startsWith(entry.prefix)) return entry.mode;
  }
  return 'live';
};

const normalizePatch = (value: unknown): ModelControlPatch => {
  const parsed = modelControlPatchSchema.safeParse(value ?? {});
  if (parsed.success) return parsed.data;
  const record =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const partial: ModelControlPatch = {};
  const models = modelControlModelsSchema.safeParse(record.models);
  if (models.success && models.data) {
    partial.models = models.data;
  }
  const knobs = modelControlKnobsSchema.safeParse(record.knobs);
  if (knobs.success && knobs.data) {
    partial.knobs = knobs.data;
  }
  return partial;
};

const assignFieldSource = (
  map: Record<
    string,
    {
      scope: 'env' | 'request' | 'global' | 'room' | 'user' | 'task';
      scopeId: string;
      profileId?: string;
      version?: number;
    }
  >,
  patch: ModelControlPatch,
  source: {
    scope: 'env' | 'request' | 'global' | 'room' | 'user' | 'task';
    scopeId: string;
    profileId?: string;
    version?: number;
  },
): void => {
  const paths = flattenPaths(patch);
  for (const path of paths) {
    map[path] = source;
  }
};

const envDefaults = (): ModelControlPatch => {
  const parseIntSafe = (value: string | undefined): number | undefined => {
    if (!value) return undefined;
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : undefined;
  };
  const parseFloatSafe = (value: string | undefined): number | undefined => {
    if (!value) return undefined;
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  };
  return {
    models: {
      canvasSteward: process.env.CANVAS_STEWARD_MODEL,
      voiceRouter: process.env.VOICE_AGENT_ROUTER_MODEL,
      // Keep explicit override separate so adaptive primary/secondary selection remains effective by default.
      voiceRealtime: process.env.VOICE_AGENT_REALTIME_MODEL,
      voiceRealtimePrimary: process.env.VOICE_AGENT_REALTIME_MODEL_PRIMARY || 'gpt-realtime-1.5',
      voiceRealtimeSecondary: process.env.VOICE_AGENT_REALTIME_MODEL_SECONDARY || 'gpt-realtime-mini',
      voiceStt:
        process.env.VOICE_AGENT_STT_MODEL ||
        process.env.VOICE_AGENT_INPUT_TRANSCRIPTION_MODEL ||
        process.env.AGENT_STT_MODEL,
      searchModel: process.env.CANVAS_STEWARD_SEARCH_MODEL || process.env.DEBATE_STEWARD_SEARCH_MODEL,
      fastDefault: process.env.FAST_STEWARD_MODEL,
    },
    knobs: {
      canvas: {
        preset:
          process.env.CANVAS_AGENT_PRESET === 'precise' || process.env.CANVAS_AGENT_PRESET === 'creative'
            ? process.env.CANVAS_AGENT_PRESET
            : undefined,
        temperature: parseFloatSafe(process.env.CANVAS_AGENT_TEMPERATURE),
        topP: parseFloatSafe(process.env.CANVAS_AGENT_TOP_P),
        maxOutputTokens: parseIntSafe(process.env.CANVAS_AGENT_MAX_OUT),
        ttfbSloMs: parseIntSafe(process.env.CANVAS_AGENT_TTFB_SLO_MS),
        screenshotTimeoutMs: parseIntSafe(process.env.CANVAS_AGENT_SCREENSHOT_TIMEOUT_MS),
        screenshotRetries: parseIntSafe(process.env.CANVAS_AGENT_SCREENSHOT_RETRIES),
        screenshotRetryDelayMs: parseIntSafe(process.env.CANVAS_AGENT_SCREENSHOT_RETRY_DELAY_MS),
        followupMaxDepth:
          parseIntSafe(process.env.CANVAS_AGENT_FOLLOWUP_MAX_DEPTH) ??
          parseIntSafe(process.env.CANVAS_AGENT_MAX_FOLLOWUPS),
        lowActionThreshold: parseIntSafe(process.env.CANVAS_AGENT_LOW_ACTION_THRESHOLD),
        promptMaxChars: parseIntSafe(process.env.CANVAS_AGENT_PROMPT_MAX_CHARS),
        transcriptWindowMs: parseIntSafe(process.env.CANVAS_AGENT_TRANSCRIPT_WINDOW_MS),
      },
      voice: {
        transcriptionEnabled:
          process.env.VOICE_AGENT_TRANSCRIPTION_ENABLED === 'true'
            ? true
            : process.env.VOICE_AGENT_TRANSCRIPTION_ENABLED === 'false'
              ? false
              : undefined,
        realtimeModelStrategy:
          process.env.VOICE_AGENT_REALTIME_MODEL_STRATEGY === 'fixed' ||
          process.env.VOICE_AGENT_REALTIME_MODEL_STRATEGY === 'adaptive_profile'
            ? process.env.VOICE_AGENT_REALTIME_MODEL_STRATEGY
            : 'adaptive_profile',
        turnDetection:
          process.env.VOICE_AGENT_TURN_DETECTION === 'none' ||
          process.env.VOICE_AGENT_TURN_DETECTION === 'server_vad' ||
          process.env.VOICE_AGENT_TURN_DETECTION === 'semantic_vad'
            ? process.env.VOICE_AGENT_TURN_DETECTION
            : undefined,
        inputNoiseReduction:
          process.env.VOICE_AGENT_INPUT_NOISE_REDUCTION === 'none' ||
          process.env.VOICE_AGENT_INPUT_NOISE_REDUCTION === 'near_field' ||
          process.env.VOICE_AGENT_INPUT_NOISE_REDUCTION === 'far_field'
            ? process.env.VOICE_AGENT_INPUT_NOISE_REDUCTION
            : undefined,
        replyTimeoutMs: parseIntSafe(process.env.VOICE_AGENT_REPLY_TIMEOUT_MS),
        interruptTimeoutMs: parseIntSafe(process.env.VOICE_AGENT_INTERRUPT_TIMEOUT_MS),
        transcriptionReadyTimeoutMs: parseIntSafe(process.env.VOICE_AGENT_TRANSCRIPTION_READY_TIMEOUT_MS),
      },
      conductor: {
        roomConcurrency: parseIntSafe(process.env.ROOM_CONCURRENCY),
        taskLeaseTtlMs: parseIntSafe(process.env.TASK_LEASE_TTL_MS),
        taskIdlePollMs: parseIntSafe(process.env.TASK_IDLE_POLL_MS),
        taskIdlePollMaxMs: parseIntSafe(process.env.TASK_IDLE_POLL_MAX_MS),
        taskMaxRetryAttempts: parseIntSafe(process.env.TASK_MAX_RETRY_ATTEMPTS),
        taskRetryBaseDelayMs: parseIntSafe(process.env.TASK_RETRY_BASE_DELAY_MS),
        taskRetryMaxDelayMs: parseIntSafe(process.env.TASK_RETRY_MAX_DELAY_MS),
        taskRetryJitterRatio: parseFloatSafe(process.env.TASK_RETRY_JITTER_RATIO),
      },
      search: {
        model: process.env.CANVAS_STEWARD_SEARCH_MODEL || process.env.DEBATE_STEWARD_SEARCH_MODEL,
        cacheTtlSec: parseIntSafe(process.env.FACT_CHECK_CACHE_TTL_SEC),
        costPerMinuteLimit: parseIntSafe(process.env.COST_SEARCH_PER_MINUTE_LIMIT),
      },
      fastStewards: {
        defaultModel: process.env.FAST_STEWARD_MODEL,
      },
    },
  };
};

const cacheKeyFor = (input: ResolveModelControlInput): string => {
  const payload = JSON.stringify({
    task: input.task ?? null,
    room: input.room ?? null,
    userId: input.userId ?? null,
    billingUserId: input.billingUserId ?? null,
    requestModel: input.requestModel ?? null,
    requestProvider: input.requestProvider ?? null,
    allowRequestModelOverride: input.allowRequestModelOverride === true,
    includeUserScope: input.includeUserScope !== false,
  });
  return createHash('sha1').update(payload).digest('hex');
};

export async function resolveModelControl(
  input: ResolveModelControlInput,
  options: { skipCache?: boolean } = {},
): Promise<ResolvedModelControl> {
  const key = cacheKeyFor(input);
  const now = Date.now();
  if (!options.skipCache) {
    const cached = resolverCache.get(key);
    if (cached && cached.exp > now) return cached.value;
  }
  const envPatch = normalizePatch(envDefaults());
  let effective = envPatch;
  const fieldSources: ResolvedModelControl['fieldSources'] = {};
  assignFieldSource(fieldSources, envPatch, { scope: 'env', scopeId: 'env' });
  const profiles = await getModelControlProfilesForResolution({
    task: input.task,
    room: input.room,
    userId: input.userId,
    includeUserScope: input.includeUserScope,
  });
  const sources: ResolvedModelControl['sources'] = [];
  for (const profile of profiles) {
    const normalizedProfilePatch = normalizePatch(profile.config);
    effective = deepMerge(
      effective as Record<string, unknown>,
      normalizedProfilePatch as Record<string, unknown>,
    ) as ModelControlPatch;
    assignFieldSource(fieldSources, normalizedProfilePatch, {
      scope: profile.scope_type,
      scopeId: profile.scope_id,
      profileId: profile.id,
      version: profile.version,
    });
    sources.push({
      id: profile.id,
      scope: profile.scope_type,
      scopeId: profile.scope_id,
      taskPrefix: profile.task_prefix,
      priority: profile.priority,
      version: profile.version,
    });
  }
  if (input.allowRequestModelOverride === true && input.requestModel) {
    const task = (input.task || '').toLowerCase();
    if (task.startsWith('search.') || task.startsWith('scorecard.fact_') || task.startsWith('scorecard.verify')) {
      const requestPatch = {
        models: { searchModel: input.requestModel },
      };
      effective = deepMerge(effective as Record<string, unknown>, requestPatch) as ModelControlPatch;
      assignFieldSource(fieldSources, requestPatch, { scope: 'request', scopeId: 'request' });
    } else {
      const requestPatch = {
        models: { canvasSteward: input.requestModel },
      };
      effective = deepMerge(effective as Record<string, unknown>, requestPatch) as ModelControlPatch;
      assignFieldSource(fieldSources, requestPatch, { scope: 'request', scopeId: 'request' });
    }
  }
  const paths = flattenPaths(effective);
  const applyModes: Record<string, ApplyMode> = {};
  for (const path of paths) {
    applyModes[path] = applyModeForPath(path);
  }
  const configVersion = createHash('sha1')
    .update(
      JSON.stringify({
        effective,
        sourceIds: sources.map((source) => `${source.id}:${source.version}`),
      }),
    )
    .digest('hex')
    .slice(0, 12);
  const resolved: ResolvedModelControl = {
    effective,
    sources,
    applyModes,
    fieldSources,
    resolvedAt: new Date().toISOString(),
    configVersion,
  };
  resolverCache.set(key, { exp: now + CACHE_TTL_MS, value: resolved });
  if (resolverCache.size > 1000) {
    for (const [entryKey, entry] of resolverCache) {
      if (entry.exp <= now) resolverCache.delete(entryKey);
    }
  }
  return resolved;
}

export function clearModelControlResolverCache(): void {
  resolverCache.clear();
}
