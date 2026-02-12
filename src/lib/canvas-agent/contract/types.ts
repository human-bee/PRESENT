import { z } from 'zod';
import { TEACHER_ACTIONS, type TeacherActionName } from './teacher';

export const ACTION_VERSION = 'tldraw-actions/1' as const;

export const LEGACY_ACTION_NAMES = [
  'create_shape',
  'update_shape',
  'delete_shape',
  'move',
  'resize',
  'rotate',
  'group',
  'ungroup',
  'align',
  'distribute',
  'stack',
  'reorder',
  'think',
  'todo',
  'add_detail',
  'set_viewport',
  'apply_preset',
  'message',
] as const;

if (TEACHER_ACTIONS.length === 0) {
  throw new Error('Teacher contract must define at least one action. Did you run scripts/gen-agent-contract.ts?');
}

const teacherActionTuple = TEACHER_ACTIONS as unknown as readonly [TeacherActionName, ...TeacherActionName[]];

const LegacyActionNameSchema = z.enum(LEGACY_ACTION_NAMES);
const TeacherActionNameSchema = z.enum(teacherActionTuple);

export const ActionNameSchema = z.union([LegacyActionNameSchema, TeacherActionNameSchema]);

export type ActionName = z.infer<typeof ActionNameSchema>;

export const AgentActionSchema = z.object({
  id: z.string(),
  name: ActionNameSchema,
  params: z.unknown(),
});

export type AgentAction = z.infer<typeof AgentActionSchema>;

export const AgentActionEnvelopeSchema = z.object({
  v: z.literal(ACTION_VERSION),
  sessionId: z.string(),
  seq: z.number().int().nonnegative(),
  hash: z.string().optional(),
  traceId: z.string().optional(),
  intentId: z.string().optional(),
  requestId: z.string().optional(),
  partial: z.boolean().optional(),
  actions: z.array(AgentActionSchema).min(1),
  ts: z.number().int(),
});

export type AgentActionEnvelope = z.infer<typeof AgentActionEnvelopeSchema>;

export type AgentChatMessage = { role: 'assistant' | 'system'; text: string };

export type ScreenshotImage = {
  mime: 'image/png' | 'image/jpeg';
  dataUrl: string;
  bytes: number;
};

export type ScreenshotRequest = {
  type: 'agent:screenshot_request';
  sessionId: string;
  requestId: string;
  bounds?: { x: number; y: number; w: number; h: number };
  maxSize?: { w: number; h: number };
  token?: string;
  roomId?: string;
};

export type ScreenshotResponse = {
  type: 'agent:screenshot';
  sessionId: string;
  requestId: string;
  image: ScreenshotImage;
  bounds: { x: number; y: number; w: number; h: number };
  viewport: { x: number; y: number; w: number; h: number };
  selection: string[];
  docVersion: string;
};
