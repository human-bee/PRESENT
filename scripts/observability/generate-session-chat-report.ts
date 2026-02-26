#!/usr/bin/env -S npx tsx
// @ts-nocheck

import fs from 'node:fs/promises';
import path from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

const arg = (name: string, fallback?: string) => {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  return process.argv[index + 1] ?? fallback;
};

const canvasId = arg('--canvas-id');
const outDirArg = arg('--out-dir', 'reports');
const cwd = process.cwd();
const outDir = path.resolve(cwd, outDirArg || 'reports');

if (!canvasId || !/^[0-9a-f-]{36}$/i.test(canvasId)) {
  console.error(
    'Usage: npx tsx scripts/observability/generate-session-chat-report.ts --canvas-id <uuid> [--out-dir reports]',
  );
  process.exit(1);
}

loadDotenv({ path: path.resolve(cwd, '.env.local') });

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_SERVICE_KEY;
if (!supabaseUrl || !supabaseKey) {
  console.error(
    'Missing Supabase connection env vars (SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY/NEXT_PUBLIC_SUPABASE_SERVICE_KEY).',
  );
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

type JsonRecord = Record<string, unknown>;
type CorrelationSummary = {
  traceKeys: number;
  requestKeys: number;
  intentKeys: number;
  taskKeys: number;
  modelMatched: number;
  toolMatched: number;
  modelMissingCorrelation: number;
  toolMissingCorrelation: number;
};

const esc = (value: unknown): string =>
  String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

const toIso = (value: unknown): string => {
  if (typeof value === 'string' && value.trim()) return value;
  if (typeof value === 'number' && Number.isFinite(value)) return new Date(value).toISOString();
  return '';
};

const prettyJson = (value: unknown): string => esc(JSON.stringify(value, null, 2));

const asRecord = (value: unknown): JsonRecord | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonRecord) : null;

const normalizeId = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const toMs = (value: unknown): number | null => {
  const iso = toIso(value);
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
};

const toSequence = (value: unknown): number => {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.floor(value);
  return Number.MAX_SAFE_INTEGER;
};

const compareReplayRows = (a: any, b: any): number => {
  const aMs = toMs(a.created_at) ?? 0;
  const bMs = toMs(b.created_at) ?? 0;
  if (aMs !== bMs) return aMs - bMs;
  const aSeq = toSequence(a.sequence);
  const bSeq = toSequence(b.sequence);
  if (aSeq !== bSeq) return aSeq - bSeq;
  const aId = String(a.event_id ?? a.id ?? '');
  const bId = String(b.event_id ?? b.id ?? '');
  return aId.localeCompare(bId);
};

const collectCorrelationKeys = (tasks: any[], traces: any[]) => {
  const traceIds = new Set<string>();
  const requestIds = new Set<string>();
  const intentIds = new Set<string>();
  const taskIds = new Set<string>();

  const add = (set: Set<string>, value: unknown) => {
    const normalized = normalizeId(value);
    if (normalized) set.add(normalized);
  };

  for (const task of tasks) {
    add(traceIds, task.trace_id);
    add(requestIds, task.request_id);
    add(taskIds, task.id);
  }
  for (const trace of traces) {
    add(traceIds, trace.trace_id);
    add(requestIds, trace.request_id);
    add(intentIds, trace.intent_id);
    add(taskIds, trace.task_id);
  }

  return { traceIds, requestIds, intentIds, taskIds };
};

const rowHasCorrelation = (row: any): boolean =>
  Boolean(normalizeId(row.trace_id) || normalizeId(row.request_id) || normalizeId(row.intent_id) || normalizeId(row.task_id));

const rowMatchesCorrelation = (
  row: any,
  keys: {
    traceIds: Set<string>;
    requestIds: Set<string>;
    intentIds: Set<string>;
    taskIds: Set<string>;
  },
): boolean => {
  const traceId = normalizeId(row.trace_id);
  if (traceId && keys.traceIds.has(traceId)) return true;
  const requestId = normalizeId(row.request_id);
  if (requestId && keys.requestIds.has(requestId)) return true;
  const intentId = normalizeId(row.intent_id);
  if (intentId && keys.intentIds.has(intentId)) return true;
  const taskId = normalizeId(row.task_id);
  if (taskId && keys.taskIds.has(taskId)) return true;
  return false;
};

const fetchAll = async (table: string, queryBuilder: (query: any) => any, pageSize = 1000) => {
  let from = 0;
  const rows: any[] = [];
  while (true) {
    const query = queryBuilder(supabase.from(table)).range(from, from + pageSize - 1);
    const { data, error } = await query;
    if (error) throw error;
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return rows;
};

const isMissingRelationError = (error: unknown): boolean => {
  const record = asRecord(error);
  const code = normalizeId(record?.code);
  if (code === '42P01') return true;
  const message = String(record?.message || '');
  return /does not exist/i.test(message) || /relation .* does not exist/i.test(message);
};

const fetchAllOptional = async (
  table: string,
  queryBuilder: (query: any) => any,
  warnings: string[],
  pageSize = 1000,
) => {
  try {
    return await fetchAll(table, queryBuilder, pageSize);
  } catch (error) {
    if (isMissingRelationError(error)) {
      warnings.push(`Optional table unavailable in this environment: ${table}`);
      return [];
    }
    throw error;
  }
};

const splitProviderIdentity = (provider: unknown, model: unknown) => {
  const providerText = typeof provider === 'string' && provider.trim() ? provider.trim() : 'unknown';
  const modelText = typeof model === 'string' && model.trim() ? model.trim() : 'unknown';
  return `${providerText}/${modelText}`;
};

const isFastRow = (row: any) => {
  const source = String(row?.source || '').toLowerCase();
  const providerPath = String(row?.provider_path || '').toLowerCase();
  if (source.startsWith('fast_')) return true;
  if (providerPath === 'fast') return true;
  const provider = String(row?.provider || '').toLowerCase();
  return provider === 'cerebras';
};

const renderJsonDetails = (title: string, value: unknown, open = false) => {
  return `<details ${open ? 'open' : ''}><summary>${esc(title)}</summary><pre>${prettyJson(value)}</pre></details>`;
};

const renderTranscriptTable = (rows: any[]) => {
  if (rows.length === 0) return '<p class="muted">No transcript rows captured.</p>';
  const body = rows
    .map((row) => {
      const iso = toIso(row.ts ?? row.timestamp ?? row.created_at);
      return `<tr>
  <td>${esc(iso)}</td>
  <td>${esc(row.participant_name || row.participantName || '')}</td>
  <td>${esc(row.participant_id || row.participantId || '')}</td>
  <td>${esc(Boolean(row.manual))}</td>
  <td>${esc(row.text || '')}</td>
  <td>${esc(row.event_id || row.eventId || '')}</td>
</tr>`;
    })
    .join('\n');
  return `<div class="table-wrap"><table>
<thead><tr><th>Timestamp (ISO)</th><th>Name</th><th>Participant ID</th><th>manual</th><th>Text</th><th>Event ID</th></tr></thead>
<tbody>${body}</tbody>
</table></div>`;
};

const renderTaskCards = (tasks: any[]) => {
  if (tasks.length === 0) return '<p class="muted">No queue task rows captured.</p>';
  return tasks
    .map((task) => {
      return `<details>
<summary>${esc(task.task)} · ${esc(task.status)} · ${esc(task.id)} · ${esc(toIso(task.created_at))}</summary>
<div class="kv-grid">
  <div><strong>request_id</strong><br>${esc(task.request_id || '')}</div>
  <div><strong>trace_id</strong><br>${esc(task.trace_id || '')}</div>
  <div><strong>attempt</strong><br>${esc(task.attempt)}</div>
  <div><strong>updated_at</strong><br>${esc(toIso(task.updated_at))}</div>
</div>
${task.error ? `<p class="error"><strong>Error:</strong> ${esc(task.error)}</p>` : ''}
${renderJsonDetails('Task Input (agent_tasks.params)', task.params)}
${renderJsonDetails('Task Output (agent_tasks.result)', task.result)}
</details>`;
    })
    .join('\n');
};

const fetchBlobMap = async (blobIds: string[]): Promise<Map<string, any>> => {
  const map = new Map<string, any>();
  if (blobIds.length === 0) return map;

  const chunkSize = 200;
  for (let i = 0; i < blobIds.length; i += chunkSize) {
    const chunk = blobIds.slice(i, i + chunkSize);
    const { data, error } = await supabase.from('agent_io_blobs').select('*').in('id', chunk);
    if (error) throw error;
    for (const row of data || []) {
      map.set(row.id, row);
    }
  }
  return map;
};

const renderModelCards = (rows: any[], blobMap: Map<string, any>) => {
  if (rows.length === 0) return '<p class="muted">No model replay rows captured.</p>';
  return rows
    .map((row) => {
      const inputBlob = row.input_blob_id ? blobMap.get(row.input_blob_id) : null;
      const outputBlob = row.output_blob_id ? blobMap.get(row.output_blob_id) : null;
      return `<details>
<summary>${esc(toIso(row.created_at))} · ${esc(row.source)} · ${esc(row.event_type)} · ${esc(row.status || '')} · ${esc(
        splitProviderIdentity(row.provider, row.model),
      )}</summary>
<div class="kv-grid">
  <div><strong>sequence</strong><br>${esc(row.sequence)}</div>
  <div><strong>request_id</strong><br>${esc(row.request_id || '')}</div>
  <div><strong>trace_id</strong><br>${esc(row.trace_id || '')}</div>
  <div><strong>intent_id</strong><br>${esc(row.intent_id || '')}</div>
  <div><strong>provider_path</strong><br>${esc(row.provider_path || '')}</div>
  <div><strong>provider_source</strong><br>${esc(row.provider_source || '')}</div>
</div>
${row.error ? `<p class="error"><strong>Error:</strong> ${esc(row.error)}</p>` : ''}
${renderJsonDetails('System Prompt', row.system_prompt ?? null)}
${renderJsonDetails('Context Priming', row.context_priming ?? null)}
${renderJsonDetails('Model Input (inline)', row.input_payload ?? null)}
${renderJsonDetails('Model Output (inline)', row.output_payload ?? null)}
${inputBlob ? renderJsonDetails('Model Input (raw blob)', inputBlob.payload) : ''}
${outputBlob ? renderJsonDetails('Model Output (raw blob)', outputBlob.payload) : ''}
${renderJsonDetails('Metadata', row.metadata ?? null)}
</details>`;
    })
    .join('\n');
};

const renderToolCards = (rows: any[], blobMap: Map<string, any>) => {
  if (rows.length === 0) return '<p class="muted">No tool replay rows captured.</p>';
  return rows
    .map((row) => {
      const inputBlob = row.input_blob_id ? blobMap.get(row.input_blob_id) : null;
      const outputBlob = row.output_blob_id ? blobMap.get(row.output_blob_id) : null;
      return `<details>
<summary>${esc(toIso(row.created_at))} · ${esc(row.source)} · ${esc(row.tool_name)} · ${esc(row.event_type)} · ${esc(row.status || '')}</summary>
<div class="kv-grid">
  <div><strong>sequence</strong><br>${esc(row.sequence)}</div>
  <div><strong>tool_call_id</strong><br>${esc(row.tool_call_id || '')}</div>
  <div><strong>request_id</strong><br>${esc(row.request_id || '')}</div>
  <div><strong>trace_id</strong><br>${esc(row.trace_id || '')}</div>
  <div><strong>intent_id</strong><br>${esc(row.intent_id || '')}</div>
  <div><strong>provider/model</strong><br>${esc(splitProviderIdentity(row.provider, row.model))}</div>
</div>
${row.error ? `<p class="error"><strong>Error:</strong> ${esc(row.error)}</p>` : ''}
${renderJsonDetails('Tool Input (inline)', row.input_payload ?? null)}
${renderJsonDetails('Tool Output (inline)', row.output_payload ?? null)}
${inputBlob ? renderJsonDetails('Tool Input (raw blob)', inputBlob.payload) : ''}
${outputBlob ? renderJsonDetails('Tool Output (raw blob)', outputBlob.payload) : ''}
${renderJsonDetails('Metadata', row.metadata ?? null)}
</details>`;
    })
    .join('\n');
};

const renderTraceCards = (events: any[]) => {
  if (events.length === 0) return '<p class="muted">No lifecycle trace rows captured.</p>';
  return events
    .map((trace) => {
      return `<details>
<summary>${esc(toIso(trace.created_at))} · ${esc(trace.stage)} · ${esc(trace.status || '')} · task=${esc(trace.task || '')}</summary>
<div class="kv-grid">
  <div><strong>request_id</strong><br>${esc(trace.request_id || '')}</div>
  <div><strong>trace_id</strong><br>${esc(trace.trace_id || '')}</div>
  <div><strong>intent_id</strong><br>${esc(trace.intent_id || '')}</div>
  <div><strong>task_id</strong><br>${esc(trace.task_id || '')}</div>
  <div><strong>provider/model</strong><br>${esc(splitProviderIdentity(trace.provider, trace.model))}</div>
  <div><strong>provider_path</strong><br>${esc(trace.provider_path || '')}</div>
</div>
${renderJsonDetails('Trace Payload', trace.payload ?? null)}
</details>`;
    })
    .join('\n');
};

const renderPriming = (rows: any[], source: string) => {
  const firstWithPrompt = rows.find((row) => row.source === source && row.system_prompt);
  const firstWithContext = rows.find((row) => row.source === source && row.context_priming);
  if (!firstWithPrompt && !firstWithContext) {
    return '<p class="muted">No persisted priming rows for this source in the selected window.</p>';
  }
  return [
    firstWithPrompt ? renderJsonDetails(`${source} initial system prompt`, firstWithPrompt.system_prompt) : '',
    firstWithContext ? renderJsonDetails(`${source} initial context priming`, firstWithContext.context_priming) : '',
  ].join('\n');
};

const buildHtml = (input: {
  canvasId: string;
  session: any;
  transcript: any[];
  tasks: any[];
  traces: any[];
  modelIo: any[];
  toolIo: any[];
  blobMap: Map<string, any>;
  windowStartIso: string;
  windowEndIso: string;
  correlationSummary: CorrelationSummary;
  warnings: string[];
}) => {
  const {
    canvasId: canvas,
    session,
    transcript,
    tasks,
    traces,
    modelIo,
    toolIo,
    blobMap,
    windowStartIso,
    windowEndIso,
    correlationSummary,
    warnings,
  } = input;

  const voiceTranscript = transcript.filter((row) =>
    String(row.participant_id || '').toLowerCase().includes('voice-agent'),
  );
  const transcriptionTranscript = transcript.filter(
    (row) => !String(row.participant_id || '').toLowerCase().includes('voice-agent'),
  );

  const voiceModelRows = modelIo.filter((row) => row.source === 'voice_agent');
  const voiceToolRows = toolIo.filter((row) => row.source === 'voice_agent');

  const transcriptionModelRows = modelIo.filter((row) => row.source === 'transcription_agent');
  const transcriptionToolRows = toolIo.filter((row) => row.source === 'transcription_agent');

  const orchestrationModelRows = modelIo.filter((row) => row.source === 'orchestration_agent');
  const orchestrationToolRows = toolIo.filter((row) => row.source === 'orchestration_agent');

  const stewardModelRows = modelIo.filter((row) => ['canvas_runner', 'canvas_steward'].includes(String(row.source)));
  const stewardToolRows = toolIo.filter((row) => ['canvas_runner', 'conductor_worker'].includes(String(row.source)));

  const fairyModelRows = modelIo.filter((row) => row.source === 'fairy_router');
  const fairyToolRows = toolIo.filter(
    (row) => row.source === 'fairy_router' || String(row.tool_name || '') === 'fairy.intent',
  );

  const fastModelRows = modelIo.filter((row) => isFastRow(row));
  const fastToolRows = toolIo.filter((row) => isFastRow(row));

  const stewardTasks = tasks.filter((task) => String(task.task || '').startsWith('canvas.'));
  const fairyTasks = tasks.filter((task) => String(task.task || '') === 'fairy.intent');

  const hasReplayRows = modelIo.length > 0 || toolIo.length > 0;

  const timelineStartIso = toIso(
    transcript[0]?.created_at || transcript[0]?.ts || traces[0]?.created_at || tasks[0]?.created_at,
  );
  const timelineEndIso = toIso(
    transcript[transcript.length - 1]?.created_at ||
      transcript[transcript.length - 1]?.ts ||
      traces[traces.length - 1]?.created_at ||
      tasks[tasks.length - 1]?.updated_at,
  );

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Agent Replay Report · ${esc(canvas)}</title>
  <style>
    :root {
      --bg: #f5f7f8;
      --panel: #ffffff;
      --ink: #1f2a30;
      --muted: #607178;
      --accent: #0f766e;
      --line: #d7e0e2;
      --error: #9f1239;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: "IBM Plex Sans", "Avenir Next", "Segoe UI", sans-serif;
      background:
        radial-gradient(1200px 400px at 100% -100px, #d9f0ee 0, transparent 60%),
        radial-gradient(900px 300px at -10% -120px, #fdecc8 0, transparent 65%),
        var(--bg);
      color: var(--ink);
      line-height: 1.4;
    }
    .wrap { max-width: 1280px; margin: 24px auto 72px; padding: 0 20px; }
    .hero, .section {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 16px;
      box-shadow: 0 10px 25px rgba(23, 42, 58, 0.06);
    }
    .hero { padding: 20px 24px; }
    .section { margin-top: 18px; padding: 16px 18px; box-shadow: 0 10px 25px rgba(23, 42, 58, 0.04); }
    h1, h2 { margin: 0; letter-spacing: 0.01em; }
    h1 { font-size: 26px; }
    h2 { margin-top: 4px; font-size: 20px; }
    .muted { color: var(--muted); }
    .error { color: var(--error); }
    .pill {
      display: inline-block;
      margin: 6px 8px 0 0;
      padding: 4px 10px;
      border-radius: 999px;
      border: 1px solid #b8d6d3;
      background: #eef9f8;
      color: #0f766e;
      font-size: 12px;
      font-weight: 600;
    }
    details { margin-top: 10px; border: 1px solid var(--line); border-radius: 10px; background: #fcfdfd; overflow: hidden; }
    details > summary { cursor: pointer; list-style: none; padding: 10px 12px; font-weight: 600; background: #f8fbfb; border-bottom: 1px solid transparent; }
    details[open] > summary { border-bottom-color: var(--line); }
    pre {
      margin: 0;
      padding: 12px;
      white-space: pre-wrap;
      word-break: break-word;
      background: #fff;
      color: #122026;
      font-family: "JetBrains Mono", "SF Mono", Menlo, Consolas, monospace;
      font-size: 12px;
      border-top: 1px solid var(--line);
    }
    .table-wrap { margin-top: 10px; overflow: auto; border: 1px solid var(--line); border-radius: 10px; background: #fff; }
    table { width: 100%; border-collapse: collapse; min-width: 920px; }
    th, td { padding: 8px 10px; border-bottom: 1px solid #e7eeef; text-align: left; font-size: 12px; vertical-align: top; }
    th { position: sticky; top: 0; background: #f4f8f8; z-index: 1; font-size: 11px; letter-spacing: 0.04em; text-transform: uppercase; color: #3f5961; }
    .kv-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 10px 12px; padding: 10px 12px; border-bottom: 1px solid var(--line); background: #fff; font-size: 12px; }
    ul.compact { margin: 8px 0 0; padding-left: 18px; }
  </style>
</head>
<body>
  <div class="wrap">
    <section class="hero">
      <h1>Agent Orchestration Full Replay Report</h1>
      <p class="muted">Canvas: <code>${esc(canvas)}</code></p>
      <p class="muted">Room: <code>${esc(session.room_name)}</code></p>
      <p class="muted">Session ID: <code>${esc(session.id)}</code></p>
      <p class="muted">Session timeline: ${esc(timelineStartIso)} → ${esc(timelineEndIso)}</p>
      <p class="muted">Replay query window: ${esc(windowStartIso)} → ${esc(windowEndIso)}</p>
      <span class="pill">transcript rows: ${transcript.length}</span>
      <span class="pill">queue tasks: ${tasks.length}</span>
      <span class="pill">trace events: ${traces.length}</span>
      <span class="pill">model replay rows: ${modelIo.length}</span>
      <span class="pill">tool replay rows: ${toolIo.length}</span>
      <span class="pill">raw blobs: ${blobMap.size}</span>
      <span class="pill">trace/request/intent/task keys: ${correlationSummary.traceKeys}/${correlationSummary.requestKeys}/${correlationSummary.intentKeys}/${correlationSummary.taskKeys}</span>
      <span class="pill">model rows matched to correlation keys: ${correlationSummary.modelMatched}/${modelIo.length}</span>
      <span class="pill">tool rows matched to correlation keys: ${correlationSummary.toolMatched}/${toolIo.length}</span>
      <span class="pill">model/tool rows missing correlation ids: ${correlationSummary.modelMissingCorrelation}/${correlationSummary.toolMissingCorrelation}</span>
      ${!hasReplayRows ? '<p class="error"><strong>Future sessions only:</strong> this session does not contain durable replay rows in <code>agent_model_io</code>/<code>agent_tool_io</code>.</p>' : ''}
      ${warnings.length > 0 ? `<p class="error"><strong>Warnings:</strong> ${esc(warnings.join(' | '))}</p>` : ''}
    </section>

    <section class="section">
      <h2>Transcript</h2>
      ${renderTranscriptTable(transcript)}
    </section>

    <section class="section">
      <h2>Voice Agent Transcript</h2>
      <p class="muted">Transcript rows + persisted voice model/tool replay.</p>
      ${renderTranscriptTable(voiceTranscript)}
      ${renderPriming(modelIo, 'voice_agent')}
      ${renderModelCards(voiceModelRows, blobMap)}
      ${renderToolCards(voiceToolRows, blobMap)}
    </section>

    <section class="section">
      <h2>Transcription Agent Transcript</h2>
      <p class="muted">Transcript rows + persisted transcription model replay.</p>
      ${renderTranscriptTable(transcriptionTranscript)}
      ${renderPriming(modelIo, 'transcription_agent')}
      ${renderModelCards(transcriptionModelRows, blobMap)}
      ${renderToolCards(transcriptionToolRows, blobMap)}
    </section>

    <section class="section">
      <h2>Orchestration Agent Transcript</h2>
      <p class="muted">Orchestration model/tool replay plus lifecycle traces.</p>
      ${renderPriming(modelIo, 'orchestration_agent')}
      ${renderModelCards(orchestrationModelRows, blobMap)}
      ${renderToolCards(orchestrationToolRows, blobMap)}
      ${renderTraceCards(traces)}
    </section>

    <section class="section">
      <h2>Steward Agent(s) Transcript</h2>
      <p class="muted">Canvas steward/canvas runner replay + queue task evidence.</p>
      ${renderPriming(modelIo, 'canvas_runner')}
      ${renderModelCards(stewardModelRows, blobMap)}
      ${renderToolCards(stewardToolRows, blobMap)}
      ${renderTaskCards(stewardTasks)}
    </section>

    <section class="section">
      <h2>Fairy Agent(s) Transcript</h2>
      <p class="muted">Fairy router replay and fairy queue tasks.</p>
      ${renderPriming(modelIo, 'fairy_router')}
      ${renderModelCards(fairyModelRows, blobMap)}
      ${renderToolCards(fairyToolRows, blobMap)}
      ${renderTaskCards(fairyTasks)}
    </section>

    <section class="section">
      <h2>Fast Agent(s) Transcript</h2>
      <p class="muted">Rows tagged as fast-path (<code>provider_path=fast</code> or fast steward source).</p>
      ${renderModelCards(fastModelRows, blobMap)}
      ${renderToolCards(fastToolRows, blobMap)}
    </section>
  </div>
</body>
</html>`;
};

const run = async () => {
  const warnings: string[] = [];
  const sessionQuery = await supabase
    .from('canvas_sessions')
    .select('id,canvas_id,room_name,created_at,updated_at')
    .eq('canvas_id', canvasId)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (sessionQuery.error) throw sessionQuery.error;
  if (!sessionQuery.data) {
    throw new Error(`No canvas_sessions row found for canvas_id=${canvasId}`);
  }

  const session = sessionQuery.data;
  const room = session.room_name;

  const transcript = await fetchAll(
    'canvas_session_transcripts',
    (q) => q.select('*').eq('session_id', session.id).order('ts', { ascending: true }),
    1000,
  );

  const transcriptTimes = transcript
    .map((row) => {
      const ts = row.ts;
      return typeof ts === 'number' && Number.isFinite(ts) ? ts : NaN;
    })
    .filter((ts) => Number.isFinite(ts));

  const createdAtMs = Date.parse(String(session.created_at || ''));
  const updatedAtMs = Date.parse(String(session.updated_at || ''));
  const transcriptMin = transcriptTimes.length > 0 ? Math.min(...transcriptTimes) : Number.NaN;
  const transcriptMax = transcriptTimes.length > 0 ? Math.max(...transcriptTimes) : Number.NaN;
  const startMs = Number.isFinite(transcriptMin)
    ? transcriptMin
    : Number.isFinite(createdAtMs)
      ? createdAtMs
      : Date.now() - 2 * 60 * 60 * 1000;
  const endBaseMs = Number.isFinite(transcriptMax)
    ? transcriptMax
    : Number.isFinite(updatedAtMs)
      ? updatedAtMs
      : Date.now();

  const windowStartIso = new Date(startMs - 5 * 60 * 1000).toISOString();
  const windowEndIso = new Date(endBaseMs + 30 * 60 * 1000).toISOString();

  const [tasks, traces] = await Promise.all([
    fetchAll(
      'agent_tasks',
      (q) =>
        q
          .select('*')
          .eq('room', room)
          .gte('created_at', windowStartIso)
          .lte('created_at', windowEndIso)
          .order('created_at', { ascending: true }),
      1000,
    ),
    fetchAll(
      'agent_trace_events',
      (q) =>
        q
          .select('*')
          .eq('room', room)
          .gte('created_at', windowStartIso)
          .lte('created_at', windowEndIso)
          .order('created_at', { ascending: true }),
      1000,
    ),
  ]);

  const [modelIoRaw, toolIoRaw] = await Promise.all([
    fetchAllOptional(
      'agent_model_io',
      (q) =>
        q
          .select('*')
          .eq('room', room)
          .gte('created_at', windowStartIso)
          .lte('created_at', windowEndIso)
          .order('created_at', { ascending: true }),
      warnings,
      1000,
    ),
    fetchAllOptional(
      'agent_tool_io',
      (q) =>
        q
          .select('*')
          .eq('room', room)
          .gte('created_at', windowStartIso)
          .lte('created_at', windowEndIso)
          .order('created_at', { ascending: true }),
      warnings,
      1000,
    ),
  ]);

  const modelIo = [...modelIoRaw].sort(compareReplayRows);
  const toolIo = [...toolIoRaw].sort(compareReplayRows);
  const correlationKeys = collectCorrelationKeys(tasks, traces);
  const correlationSummary: CorrelationSummary = {
    traceKeys: correlationKeys.traceIds.size,
    requestKeys: correlationKeys.requestIds.size,
    intentKeys: correlationKeys.intentIds.size,
    taskKeys: correlationKeys.taskIds.size,
    modelMatched: modelIo.filter((row) => rowMatchesCorrelation(row, correlationKeys)).length,
    toolMatched: toolIo.filter((row) => rowMatchesCorrelation(row, correlationKeys)).length,
    modelMissingCorrelation: modelIo.filter((row) => !rowHasCorrelation(row)).length,
    toolMissingCorrelation: toolIo.filter((row) => !rowHasCorrelation(row)).length,
  };

  const blobIds = [
    ...new Set(
      [...modelIo, ...toolIo]
        .flatMap((row) => [row.input_blob_id, row.output_blob_id])
        .filter((id): id is string => typeof id === 'string' && id.length > 0),
    ),
  ];

  let blobMap = new Map<string, any>();
  try {
    blobMap = await fetchBlobMap(blobIds);
  } catch (error) {
    if (isMissingRelationError(error)) {
      warnings.push('Optional table unavailable in this environment: agent_io_blobs');
    } else {
      throw error;
    }
  }

  const html = buildHtml({
    canvasId,
    session,
    transcript,
    tasks,
    traces,
    modelIo,
    toolIo,
    blobMap,
    windowStartIso,
    windowEndIso,
    correlationSummary,
    warnings,
  });

  await fs.mkdir(outDir, { recursive: true });
  const stem = `agent-chat-report-${canvasId}`;
  const htmlPath = path.join(outDir, `${stem}.html`);
  const jsonPath = path.join(outDir, `${stem}.json`);

  const rawBundle = {
    generatedAt: new Date().toISOString(),
    canvasId,
    session,
    windowStartIso,
    windowEndIso,
    counts: {
      transcript: transcript.length,
      tasks: tasks.length,
      traces: traces.length,
      modelIo: modelIo.length,
      toolIo: toolIo.length,
      blobCount: blobMap.size,
      correlationSummary,
    },
    transcript,
    tasks,
    traces,
    modelIo,
    toolIo,
    blobs: Object.fromEntries(blobMap.entries()),
  };

  await Promise.all([
    fs.writeFile(htmlPath, html, 'utf8'),
    fs.writeFile(jsonPath, JSON.stringify(rawBundle, null, 2), 'utf8'),
  ]);

  console.log(JSON.stringify({ htmlPath, jsonPath }, null, 2));
};

run().catch((error) => {
  if (error instanceof Error) {
    console.error(error.message);
    const details = asRecord(error);
    if (details) {
      console.error(JSON.stringify(details, null, 2));
    }
  } else if (typeof error === 'object' && error !== null) {
    console.error(JSON.stringify(error, null, 2));
  } else {
    console.error(String(error));
  }
  process.exit(1);
});
