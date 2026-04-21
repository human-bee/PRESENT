import { z } from 'zod';

export const widgetCodexWorkspaceSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  path: z.string().min(1),
});

export const widgetCodexAuthStrategySchema = z.enum(['none', 'external_url', 'iframe']);
export const widgetCodexAuthStateSchema = z.enum(['unknown', 'login_required', 'pending', 'authenticated', 'expired']);
export const widgetCodexConnectionStatusSchema = z.enum(['disconnected', 'connecting', 'ready', 'error']);

export const widgetCodexServerInputSchema = z.object({
  label: z.string().min(1),
  description: z.string().optional().nullable(),
  authStrategy: widgetCodexAuthStrategySchema.default('none'),
  authUrl: z.string().url().optional().nullable(),
  directTargetUrl: z.string().url(),
  workspaces: z.array(widgetCodexWorkspaceSchema).default([]),
});

export const widgetCodexServerPatchSchema = z.object({
  label: z.string().min(1).optional(),
  description: z.string().optional().nullable(),
  authStrategy: widgetCodexAuthStrategySchema.optional(),
  authUrl: z.string().url().optional().nullable(),
  directTargetUrl: z.string().url().optional(),
  workspaces: z.array(widgetCodexWorkspaceSchema).optional(),
});

export const widgetCodexCreateConnectionInputSchema = z.object({
  widgetSessionId: z.string().min(1).optional(),
  title: z.string().min(1).optional(),
  serverId: z.string().min(1),
  remoteWorkspaceId: z.string().min(1).optional(),
  remoteWorkspacePath: z.string().min(1).optional(),
});

export const widgetCodexCompleteAuthInputSchema = z.object({
  widgetSessionId: z.string().min(1).optional(),
  remoteWorkspaceId: z.string().min(1).optional(),
  remoteWorkspacePath: z.string().min(1).optional(),
});

export type WidgetCodexWorkspace = z.infer<typeof widgetCodexWorkspaceSchema>;
