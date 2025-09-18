import { z } from 'zod';

export const CreateComponent = z.object({
  type: z.string(),
  spec: z.string(),
});

export const UpdateComponent = z.object({
  componentId: z.string(),
  patch: z.union([z.string(), z.record(z.any())]),
});

export const FlowchartCommit = z.object({
  room: z.string(),
  docId: z.string(),
  prevVersion: z.number().optional(),
  format: z.enum(['streamdown', 'markdown', 'mermaid']),
  doc: z.string(),
});


