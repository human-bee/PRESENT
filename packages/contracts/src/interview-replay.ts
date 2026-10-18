import { z } from 'zod';

export const speechGenerationSchema = z.object({
  model: z.string().max(100), voice: z.string().max(80),
  firstByteMs: z.number().nonnegative(), completeMs: z.number().nonnegative(),
});

export const replayManifestSchema = z.object({
  label: z.string().max(200),
  provider: z.string().max(100),
  synthetic: z.literal(true),
  sampleRate: z.literal(24000),
  durationMs: z.number().positive().max(3600000),
  state: z.enum(['audio-ready', 'running', 'complete', 'failed']).default('audio-ready'),
  transcriptionModel: z.string().max(100).optional(),
  decisionModel: z.string().max(100).optional(),
  failure: z.string().max(500).optional(),
  clips: z.array(z.object({
    id: z.string().min(1).max(160),
    role: z.enum(['recruiter', 'candidate']),
    speaker: z.string().max(120),
    file: z.string().regex(/^turn-\d{3}\.wav$/),
    startMs: z.number().nonnegative(),
    endMs: z.number().positive(),
    text: z.string().max(4000),
    sourceIndex: z.number().int().nonnegative(),
    voice: z.string().max(80),
    generation: speechGenerationSchema.optional(),
  })).max(150),
});
export type ReplayManifest = z.infer<typeof replayManifestSchema>;
