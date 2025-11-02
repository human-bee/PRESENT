import { z } from 'zod';
import { ActionNameSchema, AgentActionEnvelopeSchema } from './types';

// Define parameter schemas per action. Keep permissive initial version; tighten later.
const boundsSchema = z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() });
const pointSchema = z.object({ x: z.number(), y: z.number() });

export const actionParamSchemas: Record<string, z.ZodTypeAny> = {
  create_shape: z.object({
    type: z.string(),
    id: z.string().optional(),
    x: z.number().finite().optional(),
    y: z.number().finite().optional(),
    props: z.record(z.unknown()).optional(),
  }),
  update_shape: z.object({ id: z.string(), props: z.record(z.unknown()) }),
  delete_shape: z.object({ ids: z.array(z.string()).min(1) }),
  draw_pen: z.object({ points: z.array(pointSchema).min(2), id: z.string().optional() }),
  move: z.object({ ids: z.array(z.string()).min(1), dx: z.number(), dy: z.number() }),
  resize: z.object({ id: z.string(), w: z.number().positive(), h: z.number().positive(), anchor: z.string().optional() }),
  rotate: z.object({ ids: z.array(z.string()).min(1), angle: z.number() }),
  group: z.object({ ids: z.array(z.string()).min(2), groupId: z.string().optional() }),
  ungroup: z.object({ id: z.string() }),
  align: z.object({
    ids: z.array(z.string()).min(2),
    axis: z.enum(['x', 'y']),
    mode: z.enum(['start', 'center', 'end']).default('start'),
  }),
  distribute: z.object({
    ids: z.array(z.string()).min(3),
    axis: z.enum(['x', 'y']),
  }),
  stack: z.object({
    ids: z.array(z.string()).min(2),
    direction: z.enum(['row', 'column']),
    gap: z.number().nonnegative().optional(),
  }),
  reorder: z.object({
    ids: z.array(z.string()).min(1),
    where: z.enum(['front', 'back', 'forward', 'backward']),
  }),
  think: z.object({ text: z.string() }),
  todo: z.object({ text: z.string() }),
  add_detail: z.object({
    targetIds: z.array(z.string()).optional(),
    hint: z.string().optional(),
    depth: z.number().int().nonnegative().optional(),
  }),
  set_viewport: z.object({ bounds: boundsSchema, smooth: z.boolean().optional() }),
};

export function parseAction(action: { id: string; name: string; params: unknown }) {
  const name = ActionNameSchema.parse(action.name);
  const schema = actionParamSchemas[name];
  const params = schema.parse(action.params ?? {});
  return { id: String(action.id), name, params } as const;
}

export function parseEnvelope(input: unknown) {
  return AgentActionEnvelopeSchema.parse(input);
}




