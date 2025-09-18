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
      console.log('📄 [Steward] get_current_flowchart', { room, docId, version: doc?.version ?? 0 });
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
    const window = await getTranscriptWindow(room, spanMs);
    try {
      const count = Array.isArray(window?.transcript) ? window.transcript.length : 0;
      console.log('📝 [Steward] get_context', { room, windowMs: spanMs, lines: count });
    } catch {}
    return window;
  },
});

const commit_flowchart = tool({
  name: 'commit_flowchart',
  description: 'Commit a new version of the flowchart with optimistic concurrency.',
  parameters: CommitArgs,
  async execute({ room, docId, format, doc, rationale, prevVersion }) {
    if (format !== 'mermaid') {
      const hasFence = /```mermaid[\s\S]*?```/i.test(doc);
      if (!hasFence) {
        throw new Error('INVALID_DOC: Missing mermaid code fence in markdown/streamdown');
      }
    }

    const resolveBroadcastUrl = () => {
      const candidates = [
        process.env.STEWARD_COMMIT_BASE_URL,
        process.env.NEXT_PUBLIC_BASE_URL,
        process.env.BASE_URL,
        process.env.NEXT_PUBLIC_SITE_URL,
        process.env.SITE_URL,
        process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined,
        'http://127.0.0.1:3000',
      ];
      for (const candidate of candidates) {
        if (!candidate) continue;
        try {
          const normalized = candidate.startsWith('http') ? candidate : `https://${candidate}`;
          return new URL('/api/steward/commit', normalized).toString();
        } catch {
          continue;
        }
      }
      return null;
    };

    let expectedPrev = typeof prevVersion === 'number' ? prevVersion : undefined;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await commitFlowchartDoc(room, docId, {
          format,
          doc,
          prevVersion: expectedPrev,
          rationale: typeof rationale === 'string' ? rationale : undefined,
        });
        try {
          console.log('🧾 [Steward] commit_flowchart', { room, docId, prevVersion: expectedPrev ?? null, nextVersion: res.version });
        } catch {}

        const broadcastUrl = resolveBroadcastUrl();
        if (broadcastUrl) {
          try {
            await fetch(broadcastUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ room, componentId: docId, flowchartDoc: doc, format, version: res.version }),
            });
            try {
              console.log('📡 [Steward] broadcast_flowchart', { room, docId, version: res.version, url: broadcastUrl });
            } catch {}
          } catch (err) {
            try {
              console.error('⚠️ [Steward] broadcast failed', { room, docId, error: err instanceof Error ? err.message : err });
            } catch {}
          }
        } else {
          try {
            console.warn('⚠️ [Steward] broadcast URL unavailable, skipping LiveKit patch');
          } catch {}
        }
        return res;
      } catch (error) {
        if (attempt === 0 && error instanceof Error && error.message === 'CONFLICT') {
          const latest = await getFlowchartDoc(room, docId);
          try {
            console.warn('⚠️ [Steward] commit conflict', { room, docId, attemptedPrev: expectedPrev, latestVersion: latest.version });
          } catch {}
          expectedPrev = latest.version;
          continue;
        }
        throw error;
      }
    }
    throw new Error('FAILED_COMMIT');
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
  const windowMs = params.windowMs ?? 60000;
  try {
    console.log('🚀 [Steward] runFlowchartSteward.start', { room: params.room, docId: params.docId, windowMs });
  } catch {}
  const prompt = `Update the flowchart for room ${params.room} doc ${params.docId} with params: ${JSON.stringify({ ...params, windowMs })}`;
  const result = await run(flowchartSteward, prompt);
  try {
    const preview = typeof result.finalOutput === 'string' ? result.finalOutput.slice(0, 200) : null;
    console.log('✅ [Steward] runFlowchartSteward.complete', { room: params.room, docId: params.docId, windowMs, preview });
  } catch {}
  return result.finalOutput;
}


