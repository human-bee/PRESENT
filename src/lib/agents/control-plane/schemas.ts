import { z } from 'zod';
import { KNOB_SCOPES, MODEL_PROVIDERS, type KnobScope, type ModelProvider } from './types';

export const modelProviderSchema = z.enum(MODEL_PROVIDERS);
export const knobScopeSchema = z.enum(KNOB_SCOPES);

const boundedInt = (min: number, max: number) => z.number().int().min(min).max(max);

export const canvasKnobPatchSchema = z
  .object({
    preset: z.enum(['creative', 'precise']).optional(),
    temperature: z.number().min(0).max(2).optional(),
    topP: z.number().min(0).max(1).optional(),
    maxOutputTokens: boundedInt(1, 32000).optional(),
    ttfbSloMs: boundedInt(1, 10000).optional(),
    screenshotTimeoutMs: boundedInt(250, 30000).optional(),
    screenshotRetries: boundedInt(0, 8).optional(),
    screenshotRetryDelayMs: boundedInt(10, 10000).optional(),
    followupMaxDepth: boundedInt(0, 12).optional(),
    lowActionThreshold: boundedInt(0, 40).optional(),
    promptMaxChars: boundedInt(2000, 500000).optional(),
    transcriptWindowMs: boundedInt(1000, 3_600_000).optional(),
  })
  .strict();

export const voiceKnobPatchSchema = z
  .object({
    transcriptionEnabled: z.boolean().optional(),
    sttModel: z.string().trim().min(1).max(120).optional(),
    realtimeModel: z.string().trim().min(1).max(120).optional(),
    realtimeModelStrategy: z.enum(['fixed', 'adaptive_profile']).optional(),
    routerModel: z.string().trim().min(1).max(120).optional(),
    turnDetection: z.enum(['none', 'server_vad', 'semantic_vad']).optional(),
    inputNoiseReduction: z.enum(['none', 'near_field', 'far_field']).optional(),
    replyTimeoutMs: boundedInt(100, 120000).optional(),
    interruptTimeoutMs: boundedInt(50, 120000).optional(),
    transcriptionReadyTimeoutMs: boundedInt(100, 120000).optional(),
  })
  .strict();

export const conductorKnobPatchSchema = z
  .object({
    roomConcurrency: boundedInt(1, 256).optional(),
    taskLeaseTtlMs: boundedInt(500, 300000).optional(),
    taskIdlePollMs: boundedInt(10, 60000).optional(),
    taskIdlePollMaxMs: boundedInt(10, 120000).optional(),
    taskMaxRetryAttempts: boundedInt(1, 30).optional(),
    taskRetryBaseDelayMs: boundedInt(10, 120000).optional(),
    taskRetryMaxDelayMs: boundedInt(10, 300000).optional(),
    taskRetryJitterRatio: z.number().min(0).max(0.99).optional(),
  })
  .strict();

export const searchKnobPatchSchema = z
  .object({
    model: z.string().trim().min(1).max(120).optional(),
    cacheTtlSec: boundedInt(1, 86400).optional(),
    maxResults: boundedInt(1, 6).optional(),
    includeAnswer: z.boolean().optional(),
    costPerMinuteLimit: boundedInt(1, 10000).optional(),
  })
  .strict();

export const fastStewardKnobPatchSchema = z
  .object({
    defaultModel: z.string().trim().min(1).max(120).optional(),
    bySteward: z.record(z.string(), z.string().trim().min(1).max(120)).optional(),
  })
  .strict();

export const modelControlPatchSchema = z
  .object({
    models: z.lazy(() => modelControlModelsSchema).optional(),
    knobs: z.lazy(() => modelControlKnobsSchema).optional(),
  })
  .strict();

export const modelControlModelsSchema = z
  .object({
    canvasSteward: z.string().trim().min(1).max(120).optional(),
    voiceRouter: z.string().trim().min(1).max(120).optional(),
    voiceRealtime: z.string().trim().min(1).max(120).optional(),
    voiceRealtimePrimary: z.string().trim().min(1).max(120).optional(),
    voiceRealtimeSecondary: z.string().trim().min(1).max(120).optional(),
    voiceStt: z.string().trim().min(1).max(120).optional(),
    searchModel: z.string().trim().min(1).max(120).optional(),
    fastDefault: z.string().trim().min(1).max(120).optional(),
    fastBySteward: z.record(z.string(), z.string().trim().min(1).max(120)).optional(),
  })
  .strict();

export const modelControlKnobsSchema = z
  .object({
    canvas: canvasKnobPatchSchema.optional(),
    voice: voiceKnobPatchSchema.optional(),
    conductor: conductorKnobPatchSchema.optional(),
    search: searchKnobPatchSchema.optional(),
    fastStewards: fastStewardKnobPatchSchema.optional(),
  })
  .strict();

export const modelControlProfileUpsertSchema = z
  .object({
    scopeType: knobScopeSchema,
    scopeId: z.string().trim().min(1).max(200),
    taskPrefix: z.string().trim().min(1).max(120).nullable().optional(),
    enabled: z.boolean().optional(),
    priority: boundedInt(0, 1000).optional(),
    config: modelControlPatchSchema,
  })
  .strict();

export const resolveModelControlRequestSchema = z
  .object({
    task: z.string().trim().min(1).max(200).optional(),
    room: z.string().trim().min(1).max(200).optional(),
    userId: z.string().trim().min(1).max(120).optional(),
    billingUserId: z.string().trim().min(1).max(120).optional(),
    requestModel: z.string().trim().min(1).max(120).optional(),
    requestProvider: modelProviderSchema.optional(),
    includeUserScope: z.boolean().optional(),
  })
  .strict();

export const sharedKeyUpsertSchema = z
  .object({
    provider: modelProviderSchema,
    apiKey: z.string().trim().min(8).max(512).optional(),
    enabled: z.boolean().optional(),
    delete: z.boolean().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (!value.delete && typeof value.apiKey !== 'string') {
      ctx.addIssue({
        code: 'custom',
        path: ['apiKey'],
        message: 'apiKey is required unless delete=true',
      });
    }
  });

export const sharedKeyPasswordSchema = z
  .object({
    password: z.string().max(256).nullable(),
    required: z.boolean().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.required && (!value.password || value.password.trim().length === 0)) {
      ctx.addIssue({
        code: 'custom',
        path: ['password'],
        message: 'password is required when required=true',
      });
    }
  });

export const unlockSharedKeySchema = z
  .object({
    roomScope: z.string().trim().min(1).max(200).optional(),
    password: z.string().max(256).optional(),
  })
  .strict();

export type ModelControlProfileUpsertInput = z.infer<typeof modelControlProfileUpsertSchema>;
export type ResolveModelControlRequestInput = z.infer<typeof resolveModelControlRequestSchema>;
export type SharedKeyUpsertInput = z.infer<typeof sharedKeyUpsertSchema>;
export type SharedKeyPasswordInput = z.infer<typeof sharedKeyPasswordSchema>;
export type UnlockSharedKeyInput = z.infer<typeof unlockSharedKeySchema>;
export type ParsedKnobScope = KnobScope;
export type ParsedModelProvider = ModelProvider;
