import { z } from 'zod';
import { briefFieldSchema } from './interviews';
import { speechGenerationSchema } from './interview-replay';

export const interviewSceneSchema = z.enum(['meet', 'brief', 'canvas']);
export type InterviewScene = z.infer<typeof interviewSceneSchema>;
export const interviewAssetSchema = z.object({
  id: z.string().uuid(), kind: z.enum(['resume', 'linkedin', 'portfolio', 'github', 'image', 'video', 'note', 'link', 'workboard']),
  title: z.string().trim().min(1).max(180),
  url: z.string().max(2000).refine((value) => { try { return ['http:', 'https:'].includes(new URL(value).protocol); } catch { return false; } }).optional(),
  fileId: z.string().uuid().optional(), mime: z.enum(['application/pdf', 'image/png', 'image/jpeg', 'image/webp']).optional(),
  bytes: z.number().int().nonnegative().optional(), text: z.string().max(6000).default(''), caption: z.string().max(800).default(''),
  field: briefFieldSchema.default('work'), included: z.boolean().default(false),
  x: z.number().min(0).max(5000).default(30), y: z.number().min(0).max(5000).default(80),
  createdAt: z.number().nonnegative(), createdBy: z.enum(['recruiter', 'candidate']),
});
export type InterviewAsset = z.infer<typeof interviewAssetSchema>;
export const latestBriefUpdateSchema = z.object({
  field: briefFieldSchema, text: z.string().max(1600), timestamp: z.number(), actor: z.enum(['recruiter', 'candidate', 'agent']),
});
export type LatestBriefUpdate = z.infer<typeof latestBriefUpdateSchema>;
export const pipelineTraceSchema = z.object({
  id: z.string().uuid(), transcriptId: z.string().max(160), origin: z.enum(['manual', 'live', 'audio-test']),
  input: z.string().max(4000), model: z.string().max(100), state: z.enum(['running', 'complete', 'failed', 'paused']),
  receivedAt: z.number(), speechEndedAt: z.number().optional(), transcribedAt: z.number().optional(),
  speechGeneration: speechGenerationSchema.optional(),
  decisionStartedAt: z.number().optional(), decisionCompletedAt: z.number().optional(), validatedAt: z.number().optional(), savedAt: z.number().optional(),
  renderedAt: z.number().optional(), widgetsAt: z.number().optional(),
  renderedBy: z.record(z.string(), z.number()).optional(), widgetObservedAt: z.record(z.string(), z.number()).optional(),
  patches: z.array(z.object({ field: briefFieldSchema, text: z.string().max(1600), accepted: z.boolean() })).max(2),
  widgetTargets: z.array(z.enum(['guide', 'evidence', 'canvas'])).max(3),
});
export type PipelineTrace = z.infer<typeof pipelineTraceSchema>;
export type StudioSnapshot = { scene: InterviewScene; focus: z.infer<typeof briefFieldSchema>; assets: InterviewAsset[] };
