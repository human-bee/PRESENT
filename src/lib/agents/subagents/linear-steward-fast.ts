import { getCerebrasClient, getModelForSteward, isFastStewardReady } from '../fast-steward-config';
import { getContextDocuments, formatContextDocuments, getTranscriptWindow } from '@/lib/agents/shared/supabase-context';
import { BYOK_REQUIRED } from '@/lib/agents/shared/byok-flags';
import { getDecryptedUserModelKey } from '@/lib/agents/shared/user-model-keys';

const CEREBRAS_MODEL = getModelForSteward('LINEAR_STEWARD_FAST_MODEL');

const LINEAR_STEWARD_INSTRUCTIONS = `
You are a fast, precise assistant for the Linear issue tracking system.
Your goal is to map a user's natural language instruction to a Linear MCP tool call.

Context provided:
- Current issues (id, identifier, title, status, assignee, labels)
- Context documents (uploaded text/markdown from ContextFeeder)

Rules:
1. Analyze the instruction, context documents, and current issues.
2. If the user refers to an issue by title or identifier (fuzzy match), find its ID.
3. Call the commit_action function with the appropriate action.
4. For any action not in the list, use kind: "noOp".
5. If context documents are provided and user asks to "create todos" or "turn into issues", parse the text and create multiple issues.

Available Linear MCP Tools:
- update_issue: Update issue. Args: { id, state?, priority?, assignee?, labels?, ... } (id required)
- create_issue: Create new issue. Args: { title, team, description?, priority?, state?, assignee?, labels?, ... } (title+team required; if team is unclear, omit it and the client will inject the current team)
- create_comment: Add comment. Args: { issueId, body }

Special client-side actions:
- syncPending: User wants to sync/send/push pending local changes to Linear (no MCP tool needed)
- createMultipleIssues: Create multiple issues from parsed content. Include issuesData array.

Kind values: moveIssue, updateIssue, createIssue, createMultipleIssues, addComment, addLabel, syncPending, noOp
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
            enum: ['moveIssue', 'updateIssue', 'createIssue', 'createMultipleIssues', 'addComment', 'addLabel', 'syncPending', 'noOp'],
          },
          issueId: { type: 'string', description: 'The issue ID to act on' },
          toStatus: { type: 'string', description: 'Target status for move' },
          reason: { type: 'string', description: 'Reason if noOp' },
          mcpToolName: { type: 'string', description: 'MCP tool to call' },
          mcpToolArgs: { type: 'object', description: 'MCP tool args object', additionalProperties: true },
          issuesData: {
            type: 'array',
            description: 'Issues to create for createMultipleIssues',
            items: {
              type: 'object',
              properties: {
                title: { type: 'string' },
                description: { type: 'string' },
              },
              required: ['title'],
              additionalProperties: false,
            },
          },
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
  issuesData?: Array<{ title: string; description?: string }>;
};

export async function runLinearStewardFast(params: {
  instruction: string;
  context: any;
  room?: string; // Room ID to fetch context documents
  billingUserId?: string;
}): Promise<LinearAction> {
  const { instruction, context, room, billingUserId } = params;

  const cerebrasKey = BYOK_REQUIRED && billingUserId
    ? await getDecryptedUserModelKey({ userId: billingUserId, provider: 'cerebras' })
    : null;

  if (BYOK_REQUIRED && !cerebrasKey) {
    throw new Error('BYOK_MISSING_KEY:cerebras');
  }

  if (!isFastStewardReady()) {
    return {
      kind: 'noOp',
      reason: 'FAST Linear steward unavailable (missing CEREBRAS_API_KEY)',
      mcpTool: null,
    };
  }

  // Fetch context documents if room is provided
  let contextSection = '';
  let transcriptSection = '';
  if (room) {
    const [contextDocs, transcript] = await Promise.all([
      getContextDocuments(room),
      getTranscriptWindow(room, context?.contextProfile === 'archive' ? 720_000 : 240_000),
    ]);
    contextSection = formatContextDocuments(contextDocs);
    const transcriptLines = Array.isArray(transcript?.transcript)
      ? transcript.transcript
          .filter((entry) => entry && typeof entry.text === 'string')
          .slice(-60)
          .map((entry) => `${entry.participantId || 'Speaker'}: ${entry.text}`)
          .join('\n')
      : '';
    if (transcriptLines) {
      transcriptSection = transcriptLines;
    }
  }

  const issuesList = (context.issues || [])
    .map((i: any) => `- [${i.id}] ${i.identifier || 'N/A'}: ${i.title} (Status: ${i.status || 'unknown'})`)
    .join('\n');
  const contextBundle = typeof context.contextBundle === 'string' ? context.contextBundle : '';

  const messages = [
    { role: 'system' as const, content: LINEAR_STEWARD_INSTRUCTIONS },
    {
      role: 'user' as const,
      content: `Context Issues:\n${issuesList || '(no issues)'}\n\n${contextBundle ? `Context Bundle:\n${contextBundle}\n\n` : ''}${contextSection ? `Context Documents:\n${contextSection}\n\n` : ''}${transcriptSection ? `Transcript:\n${transcriptSection}\n\n` : ''}Instruction: "${instruction}"\n\nDetermine the best action and call commit_action.`,
    },
  ];

  try {
    const client = getCerebrasClient(cerebrasKey ?? undefined);
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
          const rawArgs = args.mcpToolArgs;
          if (rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs)) {
            mcpTool = { name: args.mcpToolName, args: rawArgs as Record<string, unknown> };
          } else if (typeof rawArgs === 'string') {
            try {
              mcpTool = { name: args.mcpToolName, args: JSON.parse(rawArgs) };
            } catch {
              mcpTool = { name: args.mcpToolName, args: {} };
            }
          } else {
            mcpTool = { name: args.mcpToolName, args: {} };
          }
        }

        let issuesData: Array<{ title: string; description?: string }> | undefined;
        if (Array.isArray(args.issuesData)) {
          issuesData = args.issuesData;
        } else if (typeof args.issuesData === 'string') {
          try {
            issuesData = JSON.parse(args.issuesData);
          } catch {
            // Ignore parse errors
          }
        }

        return {
          kind: args.kind,
          issueId: args.issueId,
          toStatus: args.toStatus,
          reason: args.reason,
          mcpTool,
          issuesData,
        };
      }
    }

    return { kind: 'noOp', reason: 'No action determined', mcpTool: null };
  } catch (error) {
    console.error('[LinearStewardFast] Error:', error);
    return { kind: 'noOp', reason: 'Error processing instruction', mcpTool: null };
  }
}
