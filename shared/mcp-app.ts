import { z } from 'zod';

export const mcpInputSchema = z.record(z.string(), z.unknown()).refine(value => JSON.stringify(value).length <= 12000, 'App input is too large.');
export const mcpAppSchema = z.object({
  capability: z.literal('mcp-app'), version: z.literal(1),
  serverProfile: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),
  toolName: z.string().regex(/^[a-zA-Z0-9_.-]{1,100}$/),
  resourceUri: z.string().startsWith('ui://').max(500), toolInput: mcpInputSchema,
}).strict();
export type McpAppReference = z.infer<typeof mcpAppSchema>;
export const mcpIdentitySchema = z.object({ roomId: z.string().regex(/^[a-f0-9]{24,64}$/), actor: z.string().min(1).max(100), objectId: z.string().min(1).max(100) });
export const mcpSessionSchema = mcpIdentitySchema.extend({ appSession: z.string().regex(/^[a-f0-9]{48}$/) }).strict();
export const mcpCreateSchema = mcpIdentitySchema.omit({ objectId: true }).extend({
  serverProfile: mcpAppSchema.shape.serverProfile, toolName: mcpAppSchema.shape.toolName, toolInput: mcpInputSchema.default({}),
  pageId: z.string().regex(/^page:[a-zA-Z0-9_-]{1,100}$/).optional(),
  position: z.object({ x: z.number().finite().min(-100000).max(100000), y: z.number().finite().min(-100000).max(100000) }).default({ x: 0, y: 0 }),
}).strict();
export type McpProfileSummary = { id: string; title: string; tools: string[] };
