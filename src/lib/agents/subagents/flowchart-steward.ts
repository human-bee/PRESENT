import { Agent, tool, run } from '@openai/agents';
import { z } from 'zod';
import { getFlowchartDoc, commitFlowchartDoc, getTranscriptWindow } from '../shared/supabase-context';

const GetCurrentArgs = z.object({ room: z.string(), docId: z.string() });
// All fields must be required for Responses/Agents tools; use nullable for optional semantics
const GetContextArgs = z.object({
  room: z.string(),
  windowMs: z.number().min(1000).max(600000).nullable(),
});
const CommitArgs = z.object({
  room: z.string(),
  docId: z.string(),
  format: z.enum(['streamdown', 'markdown', 'mermaid']),
  doc: z.string().max(20000),
  rationale: z.string().nullable(),
  prevVersion: z.number().nullable(),
});

const get_current_flowchart = tool({
  name: 'get_current_flowchart',
  description: 'Fetch current flowchart doc for a room/docId from Supabase.',
  parameters: GetCurrentArgs,
  async execute({ room, docId }) {
    return await getFlowchartDoc(room, docId);
  },
});

const get_context = tool({
  name: 'get_context',
  description: 'Fetch recent transcript lines for a room.',
  parameters: GetContextArgs,
  async execute({ room, windowMs }) {
    const spanMs = typeof windowMs === 'number' ? windowMs : 60000;
    return await getTranscriptWindow(room, spanMs);
  },
});

const commit_flowchart = tool({
  name: 'commit_flowchart',
  description: 'Commit a new version of the flowchart with optimistic concurrency.',
  parameters: CommitArgs,
  async execute({ room, docId, format, doc, rationale, prevVersion }) {
    // Minimal safety: if format is markdown/streamdown, require at least one mermaid fence
    if (format !== 'mermaid') {
      const hasFence = /```mermaid[\s\S]*?```/i.test(doc);
      if (!hasFence) {
        throw new Error('INVALID_DOC: Missing mermaid code fence in markdown/streamdown');
      }
    }
    const res = await commitFlowchartDoc(room, docId, {
      format,
      doc,
      prevVersion: typeof prevVersion === 'number' ? prevVersion : undefined,
      rationale: typeof rationale === 'string' ? rationale : undefined,
    });
    try {
      const base = process.env.NEXT_PUBLIC_BASE_URL || process.env.BASE_URL || '';
      await fetch(`${base}/api/steward/commit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ room, componentId: docId, flowchartDoc: doc, format, version: res.version }),
      }).catch(() => {});
    } catch {}
    return res;
  },
});

export const flowchartSteward = new Agent({
  name: 'FlowchartSteward',
  model: 'gpt-5-mini',
  instructions:
    'You are the single writer for flowcharts. Fetch the current doc and transcript; reason holistically; output the entire doc each turn. Then commit via commit_flowchart. Keep a concise status sentence.',
  tools: [get_current_flowchart, get_context, commit_flowchart],
});

export async function runFlowchartSteward(params: { room: string; docId: string; windowMs?: number }) {
  const prompt = `Update the flowchart for room ${params.room} doc ${params.docId} with params: ${JSON.stringify(params)}`;
  const result = await run(flowchartSteward, prompt);
  return result.finalOutput;
}


