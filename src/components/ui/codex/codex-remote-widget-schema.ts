import { z } from 'zod';

export const codexRemoteWidgetSchema = z.object({
  title: z.string().default('Remote Codex'),
  subtitle: z.string().optional(),
  frameUrl: z.string().optional(),
  sessionId: z.string().optional(),
  workspaceSessionId: z.string().optional(),
  executorSessionId: z.string().optional(),
  proxyBaseUrl: z.string().optional(),
  remoteWorkingDirectory: z.string().optional(),
  status: z.string().optional(),
  lastHeartbeatAt: z.string().optional(),
  className: z.string().optional(),
  contextKey: z.string().optional(),
});

export type CodexRemoteWidgetProps = z.infer<typeof codexRemoteWidgetSchema> & {
  __custom_message_id?: string;
  messageId?: string;
};
