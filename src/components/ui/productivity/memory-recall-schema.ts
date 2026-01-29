import { z } from 'zod';

export const memoryRecallWidgetSchema = z.object({
  title: z.string().optional().default('Memory Recall'),
  query: z.string().optional().default(''),
  results: z.array(z.any()).optional().default([]),
  toolName: z.string().optional().describe('MCP tool name to run memory recall queries'),
  memoryCollection: z.string().optional().describe('Vector memory collection name'),
  memoryIndex: z.string().optional().describe('Vector memory index name'),
  memoryNamespace: z.string().optional().describe('Vector memory namespace'),
  autoSearch: z.boolean().optional().default(false),
  lastUpdated: z.number().optional(),
  className: z.string().optional(),
});

export type MemoryRecallWidgetProps = z.infer<typeof memoryRecallWidgetSchema> & {
  __custom_message_id?: string;
  messageId?: string;
  contextKey?: string;
};

export type MemoryHit = {
  id?: string;
  text: string;
  metadata?: Record<string, unknown>;
  score?: number;
  raw?: unknown;
};

export type MemoryRecallState = {
  title: string;
  query: string;
  results: MemoryHit[];
  toolName?: string;
  memoryCollection?: string;
  memoryIndex?: string;
  memoryNamespace?: string;
  autoSearch?: boolean;
  lastUpdated?: number;
};
