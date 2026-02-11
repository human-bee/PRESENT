import { getCerebrasClient, getModelForSteward, isFastStewardReady } from '../fast-steward-config';
import { getContextDocuments, formatContextDocuments, getTranscriptWindow } from '@/lib/agents/shared/supabase-context';
import { extractFirstToolCall, parseToolArgumentsResult } from './fast-steward-response';

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
}): Promise<LinearAction> {
  const { instruction, context, room } = params;

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
    const client = getCerebrasClient();
    const response = await client.chat.completions.create({
      model: CEREBRAS_MODEL,
      messages,
      tools,
      tool_choice: 'auto',
    });

    const toolCall = extractFirstToolCall(response);
    if (toolCall?.name === 'commit_action') {
      const argsResult = parseToolArgumentsResult(toolCall.argumentsRaw);
      if (!argsResult.ok) {
        console.warn('[LinearStewardFast] Invalid tool arguments', { reason: argsResult.error });
        return { kind: 'noOp', reason: 'Invalid tool arguments', mcpTool: null };
      }

      const args = argsResult.args;
      let mcpTool: { name: string; args: Record<string, unknown> } | null = null;

      if (typeof args.mcpToolName === 'string' && args.mcpToolName.trim().length > 0) {
        const rawArgs = args.mcpToolArgs;
        if (rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs)) {
          mcpTool = { name: args.mcpToolName, args: rawArgs as Record<string, unknown> };
        } else if (typeof rawArgs === 'string') {
          try {
            const parsed = JSON.parse(rawArgs);
            mcpTool =
              parsed && typeof parsed === 'object' && !Array.isArray(parsed)
                ? { name: args.mcpToolName, args: parsed as Record<string, unknown> }
                : { name: args.mcpToolName, args: {} };
          } catch {
            mcpTool = { name: args.mcpToolName, args: {} };
          }
        } else {
          mcpTool = { name: args.mcpToolName, args: {} };
        }
      }

      let issuesData: Array<{ title: string; description?: string }> | undefined;
      if (Array.isArray(args.issuesData)) {
        issuesData = args.issuesData as Array<{ title: string; description?: string }>;
      } else if (typeof args.issuesData === 'string') {
        try {
          const parsed = JSON.parse(args.issuesData);
          if (Array.isArray(parsed)) {
            issuesData = parsed as Array<{ title: string; description?: string }>;
          }
        } catch {
          // Ignore parse errors
        }
      }

      return {
        kind: typeof args.kind === 'string' ? args.kind : 'noOp',
        issueId: typeof args.issueId === 'string' ? args.issueId : undefined,
        toStatus: typeof args.toStatus === 'string' ? args.toStatus : undefined,
        reason: typeof args.reason === 'string' ? args.reason : undefined,
        mcpTool,
        issuesData,
      };
    }

    return { kind: 'noOp', reason: 'No action determined', mcpTool: null };
  } catch (error) {
    console.error('[LinearStewardFast] Error:', error);
    return { kind: 'noOp', reason: 'Error processing instruction', mcpTool: null };
  }
}
