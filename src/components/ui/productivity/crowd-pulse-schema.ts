import { z } from 'zod';

export const crowdQuestionSchema = z.object({
  id: z.string(),
  text: z.string(),
  votes: z.number().optional(),
  status: z.string().optional(),
  tags: z.array(z.string()).optional(),
  speaker: z.string().optional(),
});

export const crowdScoreSchema = z.object({
  label: z.string(),
  score: z.number(),
  delta: z.number().optional(),
});

export const crowdPulseWidgetSchema = z.object({
  title: z.string().optional(),
  prompt: z.string().optional(),
  status: z.enum(['idle', 'counting', 'locked']).optional(),
  handCount: z.number().optional(),
  peakCount: z.number().optional(),
  confidence: z.number().optional(),
  noiseLevel: z.number().optional(),
  activeQuestion: z.string().optional(),
  questions: z.array(crowdQuestionSchema).optional(),
  scoreboard: z.array(crowdScoreSchema).optional(),
  followUps: z.array(z.string()).optional(),
  lastUpdated: z.number().optional(),
  demoMode: z.boolean().optional(),
  className: z.string().optional(),
});

export type CrowdQuestion = z.infer<typeof crowdQuestionSchema>;
export type CrowdScore = z.infer<typeof crowdScoreSchema>;

export type CrowdPulseWidgetProps = z.infer<typeof crowdPulseWidgetSchema> & {
  __custom_message_id?: string;
  messageId?: string;
  contextKey?: string;
};

export type CrowdPulseState = {
  title: string;
  prompt?: string;
  status: 'idle' | 'counting' | 'locked';
  handCount: number;
  peakCount: number;
  confidence: number;
  noiseLevel: number;
  activeQuestion?: string;
  questions: CrowdQuestion[];
  scoreboard: CrowdScore[];
  followUps: string[];
  lastUpdated?: number;
  demoMode: boolean;
  className?: string;
};
