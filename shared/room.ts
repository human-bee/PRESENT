import { z } from 'zod';

export const pageIdSchema = z.string().regex(/^page:[a-zA-Z0-9_-]{1,100}$/);

export const objectSchema = z.object({
  id: z.string().min(1).max(100),
  kind: z.enum(['note', 'timer', 'widget', 'ink', 'image']),
  x: z.number().finite(), y: z.number().finite(),
  w: z.number().min(80).max(4000), h: z.number().min(60).max(4000),
  title: z.string().max(200),
  data: z.record(z.string(), z.unknown()),
  pinned: z.boolean().default(false),
  createdBy: z.string().max(100),
  createdAt: z.number(),
  expiresAt: z.number().nullable().default(null),
});
export type RoomObject = z.infer<typeof objectSchema>;
export type ObjectPatch = Partial<Pick<RoomObject, 'x' | 'y' | 'w' | 'h' | 'title' | 'pinned' | 'expiresAt'>> & { data?: Record<string, unknown> };
export type Participant = { id: string; name: string; color: string; kind: 'human' | 'agent'; cursor?: { x: number; y: number } };
export type RoomEvent = { id: string; at: number; actor: string; text: string };
export type RoomState = { id: string; title: string; revision: number; objects: RoomObject[]; events: RoomEvent[] };

export const operationSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('put'), object: objectSchema, pageId: pageIdSchema.optional() }),
  z.object({ type: z.literal('patch'), id: z.string(), patch: objectSchema.pick({ x: true, y: true, w: true, h: true, title: true, data: true }).partial().extend({ pinned: z.boolean().optional(), expiresAt: z.number().nullable().optional() }) }),
  z.object({ type: z.literal('remove'), id: z.string() }),
  z.object({ type: z.literal('increment'), id: z.string(), key: z.string().min(1).max(200).refine(key => !['__proto__', 'prototype', 'constructor'].includes(key)), by: z.number().finite() }),
  z.object({ type: z.literal('rename'), title: z.string().min(1).max(100) }),
]);
export type Operation = z.infer<typeof operationSchema>;
export function makeObject(kind: RoomObject['kind'], actor: string, at: { x: number; y: number }, data: Record<string, unknown> = {}): RoomObject {
  return { id: crypto.randomUUID(), kind, ...at, w: kind === 'timer' ? 280 : 360, h: kind === 'timer' ? 230 : 300, title: kind === 'note' ? 'A thought' : kind === 'timer' ? 'A little focus' : 'Something new', data, pinned: false, createdBy: actor, createdAt: Date.now(), expiresAt: null };
}
