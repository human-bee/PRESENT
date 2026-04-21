import { z } from 'zod';

export const widgetCodexWorkspaceSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  path: z.string().min(1),
});

export const widgetCodexAuthStrategySchema = z.enum(['none', 'external_url', 'iframe']);
export const widgetCodexAuthStateSchema = z.enum(['unknown', 'login_required', 'pending', 'authenticated', 'expired']);
export const widgetCodexConnectionStatusSchema = z.enum(['disconnected', 'connecting', 'ready', 'error']);
export const widgetCodexTransportKindSchema = z.enum(['direct', 'ssh']);

export const widgetCodexSshInputSchema = z.object({
  host: z.string().min(1),
  port: z.coerce.number().int().positive().default(22),
  username: z.string().min(1),
  remoteHost: z.string().min(1).default('127.0.0.1'),
  remotePort: z.coerce.number().int().positive().default(4500),
  remoteProtocol: z.enum(['http', 'https']).default('http'),
  hostKeySha256: z.string().min(1),
  privateKey: z.string().min(1).optional().nullable(),
  privateKeyPath: z.string().min(1).optional().nullable(),
  passphrase: z.string().min(1).optional().nullable(),
});

export const widgetCodexServerInputSchema = z
  .object({
    label: z.string().min(1),
    description: z.string().optional().nullable(),
    authStrategy: widgetCodexAuthStrategySchema.default('none'),
    authUrl: z.string().url().optional().nullable(),
    transportKind: widgetCodexTransportKindSchema.default('direct'),
    directTargetUrl: z.string().url().optional().nullable(),
    ssh: widgetCodexSshInputSchema.optional().nullable(),
    workspaces: z.array(widgetCodexWorkspaceSchema).default([]),
  })
  .superRefine((value, context) => {
    if (value.transportKind === 'direct' && !value.directTargetUrl) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['directTargetUrl'],
        message: 'Direct target URL is required for direct transport.',
      });
    }
    if (value.transportKind === 'ssh' && !value.ssh) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ssh'],
        message: 'SSH settings are required for SSH transport.',
      });
    }
    if (value.transportKind === 'ssh' && value.ssh && !value.ssh.privateKey && !value.ssh.privateKeyPath) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ssh', 'privateKey'],
        message: 'SSH private key is required for widget-created SSH servers.',
      });
    }
  });

export const widgetCodexServerPatchSchema = z
  .object({
    label: z.string().min(1).optional(),
    description: z.string().optional().nullable(),
    authStrategy: widgetCodexAuthStrategySchema.optional(),
    authUrl: z.string().url().optional().nullable(),
    transportKind: widgetCodexTransportKindSchema.optional(),
    directTargetUrl: z.string().url().optional().nullable(),
    ssh: widgetCodexSshInputSchema.optional().nullable(),
    workspaces: z.array(widgetCodexWorkspaceSchema).optional(),
  })
  .superRefine((value, context) => {
    if (value.transportKind === 'direct' && !value.directTargetUrl) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['directTargetUrl'],
        message: 'Direct target URL is required when switching to direct transport.',
      });
    }
    if (value.transportKind === 'ssh' && value.ssh === null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ssh'],
        message: 'SSH settings cannot be cleared when switching to SSH transport.',
      });
    }
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
