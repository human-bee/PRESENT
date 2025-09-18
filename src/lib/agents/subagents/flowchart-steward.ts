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
    const doc = await getFlowchartDoc(room, docId);
    try {
      console.log('[Steward][get_current_flowchart]', { room, docId, format: doc.format, version: doc.version });
    } catch {}
    return doc;
  },
});

const get_context = tool({
  name: 'get_context',
  description: 'Fetch recent transcript lines for a room.',
  parameters: GetContextArgs,
  async execute({ room, windowMs }) {
    const spanMs = typeof windowMs === 'number' ? windowMs : 60000;
    const ctx = await getTranscriptWindow(room, spanMs);
    try {
      console.log('[Steward][get_context]', { room, windowMs: spanMs, lines: ctx?.transcript?.length || 0 });
    } catch {}
    return ctx;
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
    let attempts = 0;
    let lastError: unknown;
    const cleanedRationale = typeof rationale === 'string' ? rationale : undefined;
    let expectedVersion = typeof prevVersion === 'number' ? prevVersion : undefined;

    while (attempts < 2) {
      attempts += 1;
      try {
        if (attempts > 1) {
          try {
            const latest = await getFlowchartDoc(room, docId);
            expectedVersion = latest.version;
            console.warn('[Steward][commit_flowchart] retrying after conflict', {
              room,
              docId,
              latestVersion: latest.version,
            });
          } catch (conflictFetchError) {
            console.error('[Steward][commit_flowchart] failed to refetch after conflict', conflictFetchError);
          }
        }
        console.log('[Steward][commit_flowchart] attempt', {
          room,
          docId,
          format,
          prevVersion: expectedVersion,
        });
        const res = await commitFlowchartDoc(room, docId, {
          format,
          doc,
          prevVersion: expectedVersion,
          rationale: cleanedRationale,
        });
        try {
          console.log('[Steward][commit_flowchart] committed', {
            room,
            docId,
            prevVersion: res.previousVersion,
            nextVersion: res.version,
          });
        } catch {}
        try {
          const base =
            process.env.STEWARD_COMMIT_BASE_URL ||
            process.env.NEXT_PUBLIC_BASE_URL ||
            process.env.BASE_URL ||
            'http://127.0.0.1:3000';
          await fetch(`${base}/api/steward/commit`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ room, componentId: docId, flowchartDoc: doc, format, version: res.version }),
          })
            .then(() => {
              try {
                console.log('[Steward][commit_flowchart] broadcasted', { room, docId, version: res.version });
              } catch {}
            })
            .catch((err) => {
              console.error('[Steward][commit_flowchart] broadcast failed', err);
            });
        } catch {}
        return res;
      } catch (error: any) {
        lastError = error;
        if (typeof error?.message === 'string' && error.message.includes('CONFLICT') && attempts < 2) {
          continue;
        }
        throw error;
      }
    }
    throw lastError instanceof Error ? lastError : new Error('UNKNOWN_COMMIT_ERROR');
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
  const windowMs = typeof params.windowMs === 'number' ? params.windowMs : 60000;
  try {
    console.log('[Steward][runFlowchartSteward] start', { room: params.room, docId: params.docId, windowMs });
  } catch {}
  const prompt = `Update the flowchart for room ${params.room} doc ${params.docId} with params: ${JSON.stringify({
    ...params,
    windowMs,
  })}`;
  const result = await run(flowchartSteward, prompt);
  try {
    console.log('[Steward][runFlowchartSteward] result', {
      room: params.room,
      docId: params.docId,
      windowMs,
      output: result.finalOutput,
    });
  } catch {}
  return result.finalOutput;
}


