import { z } from 'zod';

export const contextDocumentSourceSchema = z.enum(['file', 'paste', 'mcp']);

export const contextDocumentSchema = z.object({
  id: z.string(),
  title: z.string(),
  content: z.string(),
  type: z.enum(['markdown', 'text']),
  timestamp: z.number(),
  source: contextDocumentSourceSchema,
});

export const contextDocumentsSchema = z.array(contextDocumentSchema);

export type ContextDocument = z.infer<typeof contextDocumentSchema>;

export function parseContextDocuments(input: unknown): ContextDocument[] {
  if (!Array.isArray(input)) return [];
  return input.flatMap((value) => {
    const parsed = contextDocumentSchema.safeParse(value);
    return parsed.success ? [parsed.data] : [];
  });
}
