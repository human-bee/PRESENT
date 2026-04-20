import { z } from 'zod';

export const codexRemoteWidgetSchema = z.object({
  title: z.string().default('Remote Codex'),
  subtitle: z.string().optional(),
  frameUrl: z.string().optional(),
  widgetSessionId: z.string().optional(),
  serverId: z.string().optional(),
  connectionId: z.string().optional(),
  remoteWorkspaceId: z.string().optional(),
  remoteWorkspacePath: z.string().optional(),
  status: z.string().optional(),
  authState: z.string().optional(),
  activeThreadId: z.string().optional(),
  lastHeartbeatAt: z.string().optional(),
  lastError: z.string().optional(),
  className: z.string().optional(),
  contextKey: z.string().optional(),
});

export type CodexRemoteWidgetProps = z.infer<typeof codexRemoteWidgetSchema> & {
  __custom_message_id?: string;
  messageId?: string;
};
