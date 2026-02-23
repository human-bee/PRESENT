import { z } from 'zod';

export const fairyCliTaskSchema = z.enum([
  'fairy.intent',
  'canvas.agent_prompt',
  'canvas.quick_text',
  'scorecard.run',
  'scorecard.seed',
  'scorecard.verify',
  'scorecard.fact_check',
  'scorecard.refute',
  'crowd_pulse.run',
  'summary.run',
  'search.web',
]);

export type FairyCliTask = z.infer<typeof fairyCliTaskSchema>;

export const fairyCliMutationStatusSchema = z.enum([
  'applied',
  'queued',
  'failed',
  'timeout',
  'unauthorized',
  'invalid',
]);

export type FairyCliMutationStatus = z.infer<typeof fairyCliMutationStatusSchema>;

export const fairyCliRunEnvelopeSchema = z.object({
  room: z.string().min(1),
  task: z.string().min(1),
  requestId: z.string().min(1).optional(),
  traceId: z.string().min(1).optional(),
  intentId: z.string().min(1).optional(),
  executionId: z.string().min(1).optional(),
  idempotencyKey: z.string().min(1).optional(),
  lockKey: z.string().min(1).optional(),
  attempt: z.number().int().min(1).optional(),
  params: z.record(z.string(), z.unknown()).optional(),
  summary: z.string().optional(),
  message: z.string().optional(),
  experiment_id: z.string().min(1).optional(),
  variant_id: z.string().min(1).optional(),
  assignment_namespace: z.string().min(1).optional(),
  assignment_unit: z.literal('room_session').optional(),
  assignment_ts: z.string().min(1).optional(),
  factor_levels: z.record(z.string(), z.string()).optional(),
});

export type FairyCliRunEnvelope = z.infer<typeof fairyCliRunEnvelopeSchema>;

export type FairyCliTaskSnapshot = {
  id: string;
  room: string;
  task: string;
  status: string;
  attempt: number;
  requestId?: string | null;
  traceId?: string | null;
  error?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

export type FairyCliMutationEvidence = {
  taskStatus?: FairyCliTaskSnapshot | null;
  traceMatch?: {
    requestedTraceId?: string | null;
    taskTraceId?: string | null;
    matched: boolean;
  };
  applyAck?: {
    status?: string | null;
    reason?: string | null;
  };
};

export type FairyCliMutationResult = {
  status: FairyCliMutationStatus;
  taskId: string | null;
  room: string;
  task: string;
  requestId: string | null;
  traceId: string | null;
  intentId: string | null;
  taskStatus?: FairyCliTaskSnapshot | null;
  evidence?: FairyCliMutationEvidence;
  reasonCode?: string;
  reason?: string;
  experiment?: {
    experimentId?: string | null;
    variantId?: string | null;
    assignmentNamespace?: string | null;
    assignmentUnit?: string | null;
    assignmentTs?: string | null;
    factorLevels?: Record<string, string> | null;
  } | null;
};

export const FAIRY_CLI_EXIT_CODES = {
  APPLIED: 0,
  QUEUED: 10,
  FAILED: 20,
  TIMEOUT: 30,
  AUTH_OR_CONFIG: 40,
} as const;

export const FAIRY_CLI_DEFAULT_BASE_URL = 'http://127.0.0.1:3000';
