import { z } from 'zod';
import { activityKinds } from './activity-templates';
import { claimSchema, chartSchema } from './activity-records';
import { pageIdSchema } from './room';
import { meetingCommands } from './meeting';
import { audienceCommands } from './audience';
const id = z.string().min(1).max(100),
  nullableId = id.nullable(),
  text = z.string().trim().min(1).max(1500);
export const activityCommandSchema = z.discriminatedUnion('type', [
  ...meetingCommands,
  ...audienceCommands,
  z.object({
    type: z.literal('configure'),
    topic: z.string().trim().min(1).max(180),
    ambient: z.boolean(),
    autoResearch: z.boolean(),
  }),
  z.object({
    type: z.literal('seat'),
    sideId: nullableId,
    name: z.string().trim().min(1).max(80),
  }),
  z.object({
    type: z.literal('side'),
    sideId: id.optional(),
    name: z.string().trim().min(1).max(60),
  }),
  z.object({ type: z.literal('say'), text }),
  z.object({
    type: z.literal('attribute'),
    utteranceId: id,
    speakerId: nullableId,
    sideId: nullableId,
  }),
  z.object({ type: z.literal('extract'), utteranceId: id }),
  z.object({
    type: z.literal('claim'),
    text,
    utteranceId: nullableId,
    sideId: nullableId,
  }),
  z.object({
    type: z.literal('correct'),
    claimId: id,
    text,
    sideId: nullableId,
    reason: z.string().trim().min(1).max(300),
  }),
  z.object({
    type: z.literal('review'),
    claimId: id,
    review: claimSchema.shape.review,
    reason: z.string().trim().min(1).max(300),
  }),
  z.object({ type: z.literal('research'), claimId: id }),
  z.object({
    type: z.literal('visual'),
    sideId: nullableId,
    query: z.string().trim().min(1).max(160),
  }),
  z.object({
    type: z.literal('chart'),
    chart: chartSchema.omit({ id: true, suppliedBy: true }),
  }),
  z.object({ type: z.literal('resolution-review'), suggestionId: id, accept: z.boolean() }),
  z.object({ type: z.literal('comparison-retry'), comparisonId: id }),
  z.object({ type: z.literal('activate') }),
]);
export type ActivityCommand = z.input<typeof activityCommandSchema>;
export const activityRequestSchema = z.object({
  roomId: z.string().regex(/^[a-f0-9]{24,64}$/),
  actor: id,
  requestId: z.string().regex(/^[\w:.-]{1,100}$/),
  activityId: id,
  command: activityCommandSchema,
});
export const activityLaunchSchema = activityRequestSchema.omit({ activityId: true, command: true }).extend({
  kind: z.enum(activityKinds),
  topic: z.string().trim().min(1).max(180).optional(),
  pageId: pageIdSchema.optional(),
  position: z.object({ x: z.number().finite(), y: z.number().finite() }).default({ x: 0, y: 0 }),
});
