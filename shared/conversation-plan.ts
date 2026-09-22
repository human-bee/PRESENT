import { z } from 'zod';

const quote = z.string().min(1).max(1500);
const subject = z
  .object({ label: z.string().min(1).max(60), query: z.string().min(1).max(160), sideId: z.string().nullable() })
  .strict();
export const conversationPlanSchema = z
  .object({
    topic: z
      .object({ title: z.string().max(180), quote })
      .strict()
      .nullable(),
    comparisons: z
      .array(
        z
          .object({
            title: z.string().max(120),
            quote,
            subjects: z.array(subject).min(1).max(4),
            dataQuestion: z.string().max(600).nullable(),
          })
          .strict(),
      )
      .max(1),
    contributions: z
      .array(
        z
          .object({
            kind: z.enum(['claim', 'preference', 'question']),
            text: z
              .string()
              .max(1000)
              .describe(
                'Object-level idea or proposition, without speaker attribution or phrases such as X asserts/suggests; identity is supplied separately.',
              ),
            quote,
            subject: z.string().max(60).nullable(),
            replacesClaimId: z.string().nullable(),
          })
          .strict(),
      )
      .max(3),
    resolutions: z
      .array(
        z
          .object({
            blockerId: z.string(),
            quote,
            intent: z.enum(['completed', 'retracted', 'uncertain']),
            grounding: z.enum(['speaker', 'reported', 'hypothetical', 'quoted', 'ambiguous']),
          })
          .strict(),
      )
      .max(2),
    uncertainty: z.string().max(300).nullable(),
  })
  .strict();
export type ConversationPlan = z.infer<typeof conversationPlanSchema>;
export const emptyPlan = (): ConversationPlan => ({
  topic: null,
  contributions: [],
  comparisons: [],
  resolutions: [],
  uncertainty: null,
});
export const resolutionVerdictSchema = z
  .object({
    decision: z.enum(['confirm', 'retract', 'review']),
    blockerId: z.string(),
    quote,
    reason: z.string().max(300),
  })
  .strict();
export type ResolutionVerdict = z.infer<typeof resolutionVerdictSchema>;

export const sourceSpanSchema = z.object({
  utteranceId: z.string(),
  quote,
  actor: z.string().nullable(),
  epoch: z.number(),
  at: z.number(),
});
export const observationSchema = z.object({
  id: z.string(),
  kind: z.enum(['preference', 'question', 'uncertainty']),
  text: z.string().max(1000),
  sideId: z.string().nullable(),
  subject: z.string().nullable(),
  source: sourceSpanSchema,
});
export const comparisonSchema = z.object({
  id: z.string(),
  title: z.string().max(120),
  source: sourceSpanSchema,
  subjects: z.array(subject).max(4),
  dataQuestion: z.string().max(600).nullable(),
  status: z.enum(['visuals', 'pending', 'running', 'ready', 'uncertain', 'failed']),
  error: z.string().max(400).nullable(),
  chartId: z.string().nullable(),
  evidence: z.unknown().nullable(),
  dataset: z.unknown().nullable().default(null),
});
export const resolutionSuggestionSchema = z.object({
  id: z.string(),
  blockerId: z.string(),
  source: sourceSpanSchema,
  intent: z.enum(['completed', 'retracted', 'uncertain']),
  status: z.enum(['pending', 'checking', 'confirmed', 'review', 'dismissed', 'stale']),
  reason: z.string().max(300),
});

export const datasetSchema = z
  .object({
    comparable: z.boolean(),
    title: z.string().max(120),
    unit: z.string().max(40),
    scope: z.string().max(400),
    rows: z
      .array(
        z
          .object({
            label: z
              .string()
              .max(60)
              .describe('Short human-readable label, 2-5 words; put full cohort definition in cohort.'),
            valueText: z
              .string()
              .max(40)
              .regex(/^[+-]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/),
            sourceId: z.string(),
            unitText: z.string().min(1).max(40),
            unitQuote: z.string().min(1).max(160),
            quote: z.string().max(300),
            cohort: z.string().max(200),
          })
          .strict(),
      )
      .max(6),
    caveats: z.array(z.string().max(250)).max(4),
    reason: z.string().max(400),
  })
  .strict();
export type ExtractedDataset = z.infer<typeof datasetSchema>;
