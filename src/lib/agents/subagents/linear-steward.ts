import { createOpenAI } from '@ai-sdk/openai';
import { generateObject } from 'ai';
import { z } from 'zod';
import {
  formatContextDocuments,
  getContextDocuments,
  getTranscriptWindow,
} from '@/lib/agents/shared/supabase-context';

const linearActionSchema = z.object({
  kind: z.enum([
    'moveIssue',
    'updateIssue',
    'createIssue',
    'createMultipleIssues',
    'addComment',
    'addLabel',
    'syncPending',
    'noOp',
  ]),
  issueId: z.string().optional(),
  toStatus: z.string().optional(),
  reason: z.string().optional(),
  mcpTool: z
    .object({
      name: z.string().min(1),
      args: z.record(z.unknown()).default({}),
    })
    .nullable(),
  issuesData: z
    .array(
      z.object({
        title: z.string().min(1),
        description: z.string().optional(),
      }),
    )
    .optional(),
});

export type LinearAction = z.infer<typeof linearActionSchema> & {
  // Keep runtime compatibility with existing UI (explicit null when no MCP tool is needed).
  mcpTool: { name: string; args: Record<string, unknown> } | null;
};

const LINEAR_STEWARD_SYSTEM = `
You are an assistant that maps a user's natural language instruction to a Linear MCP tool call.

Context provided:
- Current issues (id, identifier, title, status, assignee, labels)
- Optional context documents and transcript from the user's canvas room

Rules:
1. Analyze the instruction, context documents, transcript, and current issues.
2. If the user refers to an issue by title or identifier (fuzzy match), resolve the issueId.
3. Output STRICT JSON matching the schema (no markdown, no backticks).
4. If the request is "sync/push pending updates", output kind="syncPending" and mcpTool=null.
5. For unknown actions, output kind="noOp" with a short reason.

Available Linear MCP Tools:
- update_issue: Update issue. Args: { id, state?, priority?, assignee?, labels?, ... } (id required)
- create_issue: Create new issue. Args: { title, team, description?, priority?, state?, assignee?, labels?, ... } (title required; if team is unclear, omit it and the client will inject the current team)
- create_comment: Add comment. Args: { issueId, body }
`;

const unsafeGenerateObject = generateObject as unknown as (args: any) => Promise<{ object: any }>;

export async function runLinearSteward(params: {
  instruction: string;
  context: any;
  room?: string;
  openaiApiKey: string;
}): Promise<LinearAction> {
  const { instruction, context, room, openaiApiKey } = params;
  const trimmedInstruction = String(instruction || '').trim();
  if (!trimmedInstruction) {
    return { kind: 'noOp', reason: 'Missing instruction', mcpTool: null };
  }

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

  const issuesList = (context?.issues || [])
    .map((i: any) => `- [${i.id}] ${i.identifier || 'N/A'}: ${i.title} (Status: ${i.status || 'unknown'})`)
    .join('\n');
  const contextBundle = typeof context?.contextBundle === 'string' ? context.contextBundle : '';

  const prompt = [
    `Context Issues:\n${issuesList || '(no issues)'}`,
    contextBundle ? `Context Bundle:\n${contextBundle}` : '',
    contextSection ? `Context Documents:\n${contextSection}` : '',
    transcriptSection ? `Transcript:\n${transcriptSection}` : '',
    `Instruction: "${trimmedInstruction}"`,
    '',
    'Return STRICT JSON for the action.',
  ]
    .filter(Boolean)
    .join('\n\n');

  const openai = createOpenAI({ apiKey: openaiApiKey });
  const model = openai('gpt-5-mini');

  const { object } = await unsafeGenerateObject({
    model,
    system: LINEAR_STEWARD_SYSTEM,
    prompt,
    schema: linearActionSchema,
    temperature: 0,
    maxOutputTokens: 800,
  });

  const parsed = linearActionSchema.parse(object);
  return {
    ...parsed,
    // Normalize missing mcpTool to null (UI expects null for "noOp"/"syncPending").
    mcpTool: parsed.mcpTool ?? null,
  };
}

