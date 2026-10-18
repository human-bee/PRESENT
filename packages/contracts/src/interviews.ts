import { z } from 'zod';
import type { StudioSnapshot, LatestBriefUpdate, PipelineTrace } from './interview-studio';
import { speechGenerationSchema } from './interview-replay';

export const briefFields = [
  'name', 'title', 'company', 'location', 'experience', 'availability', 'story',
  'workTitle', 'work', 'aiWork', 'research', 'motivation', 'compensation', 'workplace', 'timing', 'roleContext', 'questions',
] as const;
export type BriefField = (typeof briefFields)[number];
export const briefFieldSchema = z.enum(briefFields);
export const interviewRoleSchema = z.enum(['recruiter', 'candidate']);
export type InterviewRole = z.infer<typeof interviewRoleSchema>;

export const briefProfileSchema = z.object({
  name: z.string().trim().min(1).max(120),
  title: z.string().trim().min(1).max(160),
  company: z.string().trim().max(120).default(''),
  roleContext: z.string().trim().max(6000).default(''),
  research: z.string().trim().max(10000).default(''),
  sourceUrl: z.string().max(2000).default('').refine(
    (value) => !value || /^https?:\/\//i.test(value), 'Use an https or http source URL.',
  ),
});
export type BriefProfile = z.infer<typeof briefProfileSchema>;

export const evidenceQuestionSchema = z.enum(['scale', 'agentWorkflow', 'ownership', 'compensation', 'start', 'team', 'location']);
export const evidenceAnswerSchema = z.enum(['partial', 'answered']);

export const briefSourceSchema = z.object({
  kind: z.enum(['research', 'conversation', 'shared']),
  label: z.string().max(160),
  url: z.string().max(2000).optional(),
  quote: z.string().max(4000).optional(),
  transcriptId: z.string().max(160).optional(),
  statement: z.string().max(20000).optional(),
  questionId: evidenceQuestionSchema.nullable().optional(),
  answerStatus: evidenceAnswerSchema.nullable().optional(),
});
export type BriefSource = z.infer<typeof briefSourceSchema>;

export const interviewTranscriptSchema = z.object({
  id: z.string().min(1).max(160),
  speaker: z.string().min(1).max(120),
  role: interviewRoleSchema.optional(),
  text: z.string().trim().min(1).max(4000),
  timestamp: z.number().finite().nonnegative(),
  example: z.boolean().default(false),
  origin: z.enum(['manual', 'live', 'scripted', 'audio-replay']).optional(),
  audioTiming: z.object({ speechEndedAt: z.number().nonnegative(), transcribedAt: z.number().nonnegative(), generation: speechGenerationSchema.optional() }).optional(),
});
export type InterviewTranscript = z.infer<typeof interviewTranscriptSchema>;

export const briefSuggestionSchema = z.object({
  id: z.string().min(1).max(160),
  field: z.enum(['location', 'experience', 'availability', 'story', 'work', 'aiWork', 'motivation', 'compensation', 'workplace', 'timing', 'questions']),
  text: z.string().trim().min(1).max(1600),
  quote: z.string().min(1).max(4000),
  transcriptId: z.string().min(1).max(160),
  status: z.enum(['pending', 'accepted', 'dismissed']),
  questionId: evidenceQuestionSchema.nullable().optional(),
  answerStatus: evidenceAnswerSchema.nullable().optional(),
});
export type BriefSuggestion = z.infer<typeof briefSuggestionSchema>;

export type BriefSnapshot = {
  studio: StudioSnapshot;
  fields: Record<BriefField, string>;
  sources: Partial<Record<BriefField, BriefSource[]>>;
  transcripts: InterviewTranscript[];
  suggestions: BriefSuggestion[];
  activity: Array<{ id: string; text: string; timestamp: number }>;
};

export type InterviewEnvelope = {
  latestUpdate?: LatestBriefUpdate;
  pipeline: PipelineTrace[];
  id: string;
  encodedState: string;
  role: InterviewRole;
  example: boolean;
  replay?: boolean;
  replayMode?: 'scripted' | 'audio';
  revision: string;
  approvals: Partial<Record<InterviewRole, string>>;
  collaborators: Array<{ identity: string; role: InterviewRole; seenAt: number }>;
  candidateToken?: string;
  agentAvailable: boolean;
  callAvailable: boolean;
  notesConsent: Record<InterviewRole, boolean>;
};
