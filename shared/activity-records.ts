import { z } from 'zod';
import { activityKinds } from './activity-templates';
import { evidenceReportSchema } from './evidence';
import { meetingSchema, emptyMeeting } from './meeting';
import { audienceSchema, emptyAudience } from './audience';
import {
  observationSchema,
  comparisonSchema,
  resolutionSuggestionSchema,
  conversationPlanSchema,
} from './conversation-plan';
const id = z.string().min(1).max(100);
const text = z.string().trim().min(1).max(1500);
const nullableId = id.nullable();
export const sideSchema = z.object({
  id,
  name: z.string().trim().min(1).max(60),
  color: z.number().int().min(0).max(5),
});
export const seatSchema = z.object({
  actor: id,
  name: z.string().min(1).max(80),
  sideId: nullableId,
});
export const utteranceSchema = z.object({
  captureProof: z.string().default(''),
  interpretation: conversationPlanSchema.nullable().default(null),
  id,
  at: z.number(),
  text,
  source: z.enum(['typed', 'room-voice', 'participant-voice']),
  epoch: z.number().default(0),
  speakerId: nullableId,
  speakerName: z.string().max(80),
  sideId: nullableId,
  extraction: z.enum(['pending', 'running', 'done', 'failed', 'off']),
  error: z.string().max(250).nullable(),
  model: z.string().nullable(),
  elapsedMs: z.number().nullable(),
});
export const claimSchema = z.object({
  epoch: z.number().default(0),
  quote: z.string().max(1500).default(''),
  id,
  text,
  utteranceId: nullableId,
  speakerId: nullableId,
  sideId: nullableId,
  version: z.number().int().min(1),
  origin: z.enum(['participant', 'model-suggestion']),
  review: z.enum(['open', 'disputed', 'accepted', 'withdrawn']),
  research: z.object({
    status: z.enum(['idle', 'pending', 'running', 'done', 'failed']),
    token: z.string(),
    version: z.number(),
    error: z.string().max(250).nullable(),
    elapsedMs: z.number().nullable(),
  }),
  evidence: evidenceReportSchema.nullable(),
  corrections: z
    .array(
      z.object({
        actor: id,
        at: z.number(),
        text,
        reason: z.string().max(300),
      }),
    )
    .max(6),
});
export const visualSchema = z.object({
  epoch: z.number().default(0),
  quote: z.string().max(1500).default(''),
  utteranceId: z.string().nullable().default(null),
  id,
  sideId: nullableId,
  query: z.string().max(160),
  status: z.enum(['pending', 'done', 'failed']),
  error: z.string().max(250).nullable(),
  images: z
    .array(
      z.object({
        title: z.string().max(200),
        url: z.string().url(),
        sourceUrl: z.string().url(),
        attribution: z.string().max(600),
        license: z.string().max(100),
      }),
    )
    .max(2),
});
export const chartSchema = z.object({
  epoch: z.number().default(0),
  provenance: z.enum(['participant', 'source-extracted']).default('participant'),
  scope: z.string().max(400).default(''),
  caveats: z.array(z.string().max(250)).max(4).default([]),
  sourceRows: z
    .array(
      z.object({
        label: z.string(),
        valueText: z.string(),
        unitText: z.string().default(''),
        unitQuote: z.string().default(''),
        sourceId: z.string(),
        quote: z.string().max(300),
        cohort: z.string(),
        sourceUrl: z.string(),
        pageHash: z.string(),
      }),
    )
    .max(6)
    .default([]),
  id,
  title: z.string().max(120),
  unit: z.string().max(40),
  sourceUrl: z.string().url(),
  sourceTitle: z.string().max(160),
  suppliedBy: id,
  values: z
    .array(z.object({ label: z.string().max(60), value: z.number().finite() }))
    .min(2)
    .max(8),
});
export const activitySchema = z.object({
  epoch: z.number().default(0),
  observations: z.array(observationSchema).max(24).default([]),
  comparisons: z.array(comparisonSchema).max(8).default([]),
  resolutionSuggestions: z.array(resolutionSuggestionSchema).max(12).default([]),
  meeting: meetingSchema.default(emptyMeeting),
  audience: audienceSchema.default(emptyAudience),
  id,
  kind: z.enum(activityKinds),
  topic: z.string().min(1).max(180),
  createdAt: z.number(),
  createdBy: id,
  ambient: z.boolean(),
  autoResearch: z.boolean(),
  sides: z.array(sideSchema).min(2).max(6),
  seats: z.array(seatSchema).max(24),
  utterances: z.array(utteranceSchema).max(60),
  omitted: z.number().int().min(0),
  claims: z.array(claimSchema).max(24),
  visuals: z.array(visualSchema).max(8),
  charts: z.array(chartSchema).max(6),
  events: z.array(z.object({ id, at: z.number(), actor: id, text: z.string().max(300) })).max(80),
});
export type Activity = z.infer<typeof activitySchema>;
export type ActivityKind = Activity['kind'];
export type Claim = z.infer<typeof claimSchema>;
export type Utterance = z.infer<typeof utteranceSchema>;
export const roomOSSchema = z.object({
  version: z.literal(1),
  activeId: nullableId,
  activities: z.array(activitySchema).max(4),
});
export type RoomOS = z.infer<typeof roomOSSchema>;
