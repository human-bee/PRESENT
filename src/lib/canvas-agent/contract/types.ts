import { z } from 'zod';

export const ACTION_VERSION = 'tldraw-actions/1' as const;

export const ActionNameSchema = z.enum([
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
  'message',
]);

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



