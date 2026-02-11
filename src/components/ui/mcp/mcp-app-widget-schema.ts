import { z } from 'zod';

export const mcpAppWidgetSchema = z.object({
  title: z.string().optional().describe('Optional display title'),
  toolName: z.string().optional().describe('MCP tool name to call for this app'),
  serverUrl: z.string().optional().describe('Explicit MCP server URL to use for tool/resource'),
  serverName: z.string().optional().describe('Named MCP server to resolve from config'),
  resourceUri: z.string().optional().describe('Override UI resource URI (ui://...)'),
  args: z.record(z.string(), z.any()).optional().describe('Tool arguments'),
  autoRun: z.boolean().optional().describe('Run tool automatically when mounted'),
  runId: z.string().optional().describe('Change to force a tool rerun'),
  displayMode: z.string().optional().describe('Requested display mode (inline, panel, modal)'),
  contextKey: z.string().optional(),
  messageId: z.string().optional(),
  className: z.string().optional(),
});

export type McpAppWidgetProps = z.infer<typeof mcpAppWidgetSchema> & {
  __custom_message_id?: string;
};
