import { Agent, tool, run } from '@openai/agents';
import { z } from 'zod';
import { getFlowchartDoc, commitFlowchartDoc, getTranscriptWindow } from '../shared/supabase-context';

const logWithTs = <T extends Record<string, unknown>>(label: string, payload: T) => {
  try {
    console.log(label, { ts: new Date().toISOString(), ...payload });
  } catch {}
};

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
  rationale: z.string(),
  prevVersion: z.number().nullable(),
});

export const get_current_flowchart = tool({
  name: 'get_current_flowchart',
  description: 'Fetch current flowchart doc for a room/docId from Supabase.',
  parameters: GetCurrentArgs,
  async execute({ room, docId }) {
    const start = Date.now();
    const doc = await getFlowchartDoc(room, docId);
    try {
      logWithTs('📄 [Steward] get_current_flowchart', {
        room,
        docId,
        version: doc?.version ?? 0,
        durationMs: Date.now() - start,
      });
    } catch {}
    return doc;
  },
});

export const get_context = tool({
  name: 'get_context',
  description: 'Fetch recent transcript lines for a room.',
  parameters: GetContextArgs,
  async execute({ room, windowMs }) {
    const spanMs = typeof windowMs === 'number' ? windowMs : 60000;
    const start = Date.now();
    const window = await getTranscriptWindow(room, spanMs);
    try {
      const count = Array.isArray(window?.transcript) ? window.transcript.length : 0;
      logWithTs('📝 [Steward] get_context', {
        room,
        windowMs: spanMs,
        lines: count,
        durationMs: Date.now() - start,
      });
    } catch {}
    return window;
  },
});

export const commit_flowchart = tool({
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
      const derivedPort = process.env.PORT || process.env.NEXT_PUBLIC_PORT;
      const derivedLocal =
        derivedPort && Number.isFinite(Number(derivedPort))
          ? `http://127.0.0.1:${derivedPort}`
          : undefined;
      const candidates = [
        process.env.STEWARD_COMMIT_BASE_URL,
        process.env.NEXT_PUBLIC_BASE_URL,
        process.env.BASE_URL,
        process.env.NEXT_PUBLIC_SITE_URL,
        process.env.SITE_URL,
        process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined,
        derivedLocal,
        'http://127.0.0.1:3001',
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
    const normalizedRationale =
      typeof rationale === 'string' && rationale.trim() !== '' ? rationale : undefined;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const commitStart = Date.now();
        const res = await commitFlowchartDoc(room, docId, {
          format,
          doc,
          prevVersion: expectedPrev,
          rationale: normalizedRationale,
        });
        try {
          logWithTs('🧾 [Steward] commit_flowchart', {
            room,
            docId,
            prevVersion: expectedPrev ?? null,
            nextVersion: res.version,
            commitDurationMs: Date.now() - commitStart,
          });
        } catch {}

        const broadcastUrl = resolveBroadcastUrl();
        if (broadcastUrl) {
          const broadcastStart = Date.now();
          try {
            logWithTs('📡 [Steward] broadcast_scheduled', {
              room,
              docId,
              version: res.version,
              url: broadcastUrl,
            });
          } catch {}
          void (async () => {
            try {
              await fetch(broadcastUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  room,
                  componentId: docId,
                  patch: { flowchartDoc: doc, format, version: res.version },
                }),
              });
              try {
                logWithTs('📡 [Steward] broadcast_flowchart', {
                  room,
                  docId,
                  version: res.version,
                  url: broadcastUrl,
                  broadcastDurationMs: Date.now() - broadcastStart,
                });
              } catch {}
            } catch (err) {
              try {
                logWithTs('⚠️ [Steward] broadcast failed', {
                  room,
                  docId,
                  version: res.version,
                  url: broadcastUrl,
                  durationMs: Date.now() - broadcastStart,
                  error: err instanceof Error ? err.message : err,
                });
              } catch {}
            }
          })();
        } else {
          try {
            logWithTs('⚠️ [Steward] broadcast URL unavailable, skipping LiveKit patch', {
              room,
              docId,
            });
          } catch {}
        }
        return res;
      } catch (error) {
        if (attempt === 0 && error instanceof Error && error.message === 'CONFLICT') {
          const latest = await getFlowchartDoc(room, docId);
          try {
            logWithTs('⚠️ [Steward] commit conflict', {
              room,
              docId,
              attemptedPrev: expectedPrev,
              latestVersion: latest.version,
            });
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

export const FLOWCHART_STEWARD_INSTRUCTIONS =
  'You are the single writer for flowcharts. Fetch the current doc and transcript; reason holistically; output the entire doc each turn. Then commit via commit_flowchart. If you lack a rationale, send an empty string (never use null). Keep a concise status sentence.';

export const flowchartSteward = new Agent({
  name: 'FlowchartSteward',
  model: 'gpt-5-mini',
  instructions: FLOWCHART_STEWARD_INSTRUCTIONS,
  tools: [get_current_flowchart, get_context, commit_flowchart],
});

export async function runFlowchartSteward(params: { room: string; docId: string; windowMs?: number }) {
  const windowMs = params.windowMs ?? 60000;
  const overallStart = Date.now();
  try {
    logWithTs('🚀 [Steward] runFlowchartSteward.start', {
      room: params.room,
      docId: params.docId,
      windowMs,
    });
  } catch {}
  const prompt = `Update the flowchart for room ${params.room} doc ${params.docId} with params: ${JSON.stringify({ ...params, windowMs })}`;
  const result = await run(flowchartSteward, prompt);
  try {
    const preview = typeof result.finalOutput === 'string' ? result.finalOutput.slice(0, 200) : null;
    logWithTs('✅ [Steward] runFlowchartSteward.complete', {
      room: params.room,
      docId: params.docId,
      windowMs,
      preview,
      durationMs: Date.now() - overallStart,
    });
  } catch {}
  return result.finalOutput;
}
