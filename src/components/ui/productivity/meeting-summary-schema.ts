import { z } from 'zod';
import {
  normalizeFairyContextProfile,
  type FairyContextProfile,
} from '@/lib/fairy-context/profiles';

export const actionItemSchema = z.object({
  task: z.string().describe('Action item description'),
  owner: z.string().optional().describe('Owner or assignee'),
  due: z.string().optional().describe('Due date'),
});

export const meetingSummaryWidgetSchema = z.object({
  title: z.string().optional().default('Meeting Summary'),
  summary: z.string().optional().default(''),
  highlights: z.array(z.string()).optional().default([]),
  decisions: z.array(z.string()).optional().default([]),
  actionItems: z.array(actionItemSchema).optional().default([]),
  tags: z.array(z.string()).optional().default([]),
  sourceDocumentId: z.string().optional(),
  crmToolName: z.string().optional().describe('MCP tool name to send summary payload'),
  memoryCollection: z.string().optional().describe('Vector memory collection name'),
  memoryIndex: z.string().optional().describe('Vector memory index name'),
  memoryNamespace: z.string().optional().describe('Vector memory namespace'),
  autoSend: z.boolean().optional().default(false),
  lastUpdated: z.number().optional(),
  contextProfile: z
    .string()
    .transform((value, ctx): FairyContextProfile => {
      const normalized = normalizeFairyContextProfile(value);
      if (normalized) return normalized;
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Invalid fairy context profile',
      });
      return z.NEVER;
    })
    .optional(),
  className: z.string().optional(),
});

export type ActionItem = z.infer<typeof actionItemSchema>;

export type MeetingSummaryWidgetProps = z.infer<typeof meetingSummaryWidgetSchema> & {
  __custom_message_id?: string;
  messageId?: string;
  contextKey?: string;
};

export type MeetingSummaryState = {
  title: string;
  summary: string;
  highlights: string[];
  decisions: string[];
  actionItems: ActionItem[];
  tags: string[];
  sourceDocumentId?: string;
  crmToolName?: string;
  memoryCollection?: string;
  memoryIndex?: string;
  memoryNamespace?: string;
  autoSend?: boolean;
  lastUpdated?: number;
  contextProfile?: FairyContextProfile;
};
