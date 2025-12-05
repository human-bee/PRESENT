import { getCerebrasClient, getModelForSteward } from '../fast-steward-config';

const CEREBRAS_MODEL = getModelForSteward('LINEAR_STEWARD_FAST_MODEL');
const client = getCerebrasClient();

const LINEAR_STEWARD_INSTRUCTIONS = `
You are a fast, precise assistant for the Linear issue tracking system.
Your goal is to map a user's natural language instruction to a Linear MCP tool call.

Context provided:
- Current issues (id, identifier, title, status, assignee, labels)

Rules:
1. Analyze the instruction and the current issues.
2. If the user refers to an issue by title or identifier (fuzzy match), find its ID.
3. Call the commit_action function with the appropriate action.
4. For any action not in the list, use kind: "noOp".

Available Linear MCP Tools:
- update_issue: Update issue. Args: { issueId, stateId?, priority?, assigneeId? }
- create_issue: Create new issue. Args: { title, description?, teamId? }
- create_comment: Add comment. Args: { issueId, body }
- add_issue_label: Add label. Args: { issueId, labelId }

Special client-side actions:
- syncPending: User wants to sync/send/push pending local changes to Linear (no MCP tool needed)

Kind values: moveIssue, updateIssue, createIssue, addComment, addLabel, syncPending, noOp
`;

const tools = [
  {
    type: 'function' as const,
    function: {
      name: 'commit_action',
      description: 'Commit the determined Linear action',
      parameters: {
        type: 'object',
        properties: {
          kind: {
            type: 'string',
            enum: ['moveIssue', 'updateIssue', 'createIssue', 'addComment', 'addLabel', 'syncPending', 'noOp'],
          },
          issueId: { type: 'string', description: 'The issue ID to act on' },
          toStatus: { type: 'string', description: 'Target status for move' },
          reason: { type: 'string', description: 'Reason if noOp' },
          mcpToolName: { type: 'string', description: 'MCP tool to call' },
          mcpToolArgs: { type: 'string', description: 'MCP tool args as JSON string' },
        },
        required: ['kind'],
      },
    },
  },
];

type LinearAction = {
  kind: string;
  issueId?: string;
  toStatus?: string;
  reason?: string;
  mcpTool: { name: string; args: Record<string, unknown> } | null;
};

export async function runLinearStewardFast(params: { instruction: string; context: any }): Promise<LinearAction> {
  const { instruction, context } = params;

  const issuesList = (context.issues || [])
    .map((i: any) => `- [${i.id}] ${i.identifier || 'N/A'}: ${i.title} (Status: ${i.status || 'unknown'})`)
    .join('\n');

  const messages = [
    { role: 'system' as const, content: LINEAR_STEWARD_INSTRUCTIONS },
    {
      role: 'user' as const,
      content: `Context Issues:\n${issuesList || '(no issues)'}\n\nInstruction: "${instruction}"\n\nDetermine the best action and call commit_action.`,
    },
  ];

  try {
    const response = await client.chat.completions.create({
      model: CEREBRAS_MODEL,
      messages,
      tools,
      tool_choice: 'auto',
    });

    const choice = response.choices[0]?.message;

    if (choice?.tool_calls?.[0]) {
      const toolCall = choice.tool_calls[0];
      if (toolCall.function.name === 'commit_action') {
        const args = JSON.parse(toolCall.function.arguments);
        let mcpTool: { name: string; args: Record<string, unknown> } | null = null;

        if (args.mcpToolName) {
          try {
            mcpTool = {
              name: args.mcpToolName,
              args: args.mcpToolArgs ? JSON.parse(args.mcpToolArgs) : {},
            };
          } catch {
            mcpTool = { name: args.mcpToolName, args: {} };
          }
        }

        return {
          kind: args.kind,
          issueId: args.issueId,
          toStatus: args.toStatus,
          reason: args.reason,
          mcpTool,
        };
      }
    }

    return { kind: 'noOp', reason: 'No action determined', mcpTool: null };
  } catch (error) {
    console.error('[LinearStewardFast] Error:', error);
    return { kind: 'noOp', reason: 'Error processing instruction', mcpTool: null };
  }
}
