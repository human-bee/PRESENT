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

const canvasIdArg = arg('--canvas-id');
const roomArg = arg('--room');
const sessionIdArg = arg('--session-id');
const resultJsonArg = arg('--result-json');
const windowStartArg = arg('--window-start');
const windowEndArg = arg('--window-end');
const outDirArg = arg('--out-dir', 'reports');
const cwd = process.cwd();
const outDir = path.resolve(cwd, outDirArg || 'reports');

const hasCanvas = typeof canvasIdArg === 'string' && /^[0-9a-f-]{36}$/i.test(canvasIdArg);
const hasRoom = typeof roomArg === 'string' && roomArg.trim().length > 0;
const hasSessionId = typeof sessionIdArg === 'string' && sessionIdArg.trim().length > 0;
const hasResultJson = typeof resultJsonArg === 'string' && resultJsonArg.trim().length > 0;

if (!hasCanvas && !hasRoom && !hasSessionId && !hasResultJson) {
  console.error(
    'Usage: npx tsx scripts/observability/generate-session-chat-report.ts (--canvas-id <uuid> | --room <room> | --session-id <id> | --result-json <path>) [--window-start <iso>] [--window-end <iso>] [--out-dir reports]',
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
type RunArtifactContext = {
  runId?: string;
  canvasId?: string;
  room?: string;
  startedAt?: string;
  endedAt?: string;
  video?: string;
  sourcePath?: string;
  turns?: any[];
  sessionCorrelation?: unknown;
};
type OptionalReplayTable = 'agent_model_io' | 'agent_tool_io' | 'agent_io_blobs';
type OptionalReplayTableAvailability = Record<OptionalReplayTable, boolean>;
type TokenUsage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  reasoningTokens?: number;
  promptTokens?: number;
  completionTokens?: number;
  transcriptTokens?: number;
  maxTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  searchTokens?: number;
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

const parseIsoMs = (value: unknown): number | null => {
  if (typeof value !== 'string' || value.trim().length === 0) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
};

const normalizeUuid = (value: unknown): string | null => {
  const normalized = normalizeId(value);
  if (!normalized) return null;
  return /^[0-9a-f-]{36}$/i.test(normalized) ? normalized : null;
};

const sanitizeFileStem = (value: string): string =>
  value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '');

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

const toFiniteNumber = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const parseMaybeJson = (value: unknown): unknown => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return value;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
};

const extractTokenUsage = (...sources: unknown[]): TokenUsage | null => {
  const usage: TokenUsage = {};
  const seen = new Set<unknown>();
  const queue: unknown[] = [...sources.map(parseMaybeJson)];
  let scanned = 0;
  const maxScans = 5000;

  const set = (key: keyof TokenUsage, value: unknown) => {
    const n = toFiniteNumber(value);
    if (n == null) return;
    if (usage[key] == null) usage[key] = n;
  };

  while (queue.length > 0 && scanned < maxScans) {
    const current = queue.shift();
    scanned += 1;
    if (current == null) continue;
    if (typeof current !== 'object') continue;
    if (seen.has(current)) continue;
    seen.add(current);

    if (Array.isArray(current)) {
      for (const item of current) queue.push(item);
      continue;
    }

    const obj = current as Record<string, unknown>;
    set('inputTokens', obj.input_tokens ?? obj.inputTokens);
    set('outputTokens', obj.output_tokens ?? obj.outputTokens);
    set('totalTokens', obj.total_tokens ?? obj.totalTokens);
    set('reasoningTokens', obj.reasoning_tokens ?? obj.reasoningTokens ?? obj.thinking_tokens);
    set('promptTokens', obj.prompt_tokens ?? obj.promptTokens);
    set('completionTokens', obj.completion_tokens ?? obj.completionTokens);
    set('cacheReadTokens', obj.cache_read_input_tokens ?? obj.cacheReadTokens);
    set('cacheWriteTokens', obj.cache_creation_input_tokens ?? obj.cacheWriteTokens);
    set('transcriptTokens', obj.transcript_tokens ?? obj.transcriptTokenEstimate);
    set('maxTokens', obj.max_tokens ?? obj.maxOutputTokens ?? obj.token_budget_max ?? obj.tokenBudgetMax);
    set('searchTokens', obj.search_tokens ?? obj.searchTokens);

    for (const value of Object.values(obj)) {
      if (value && typeof value === 'object') queue.push(value);
      else if (typeof value === 'string') queue.push(parseMaybeJson(value));
    }
  }

  return Object.keys(usage).length > 0 ? usage : null;
};

const formatTokenUsage = (usage: TokenUsage | null): string => {
  if (!usage) return 'n/a';
  const bits: string[] = [];
  if (usage.inputTokens != null) bits.push(`in=${usage.inputTokens}`);
  if (usage.promptTokens != null) bits.push(`prompt=${usage.promptTokens}`);
  if (usage.outputTokens != null) bits.push(`out=${usage.outputTokens}`);
  if (usage.completionTokens != null) bits.push(`completion=${usage.completionTokens}`);
  if (usage.reasoningTokens != null) bits.push(`think=${usage.reasoningTokens}`);
  if (usage.totalTokens != null) bits.push(`total=${usage.totalTokens}`);
  if (usage.transcriptTokens != null) bits.push(`transcript=${usage.transcriptTokens}`);
  if (usage.cacheReadTokens != null) bits.push(`cache_read=${usage.cacheReadTokens}`);
  if (usage.cacheWriteTokens != null) bits.push(`cache_write=${usage.cacheWriteTokens}`);
  if (usage.searchTokens != null) bits.push(`search=${usage.searchTokens}`);
  if (usage.maxTokens != null) bits.push(`max=${usage.maxTokens}`);
  return bits.length > 0 ? bits.join(' ') : 'n/a';
};

const hasMeasuredTokenUsage = (usage: TokenUsage | null): boolean => {
  if (!usage) return false;
  return (
    usage.inputTokens != null ||
    usage.promptTokens != null ||
    usage.outputTokens != null ||
    usage.completionTokens != null ||
    usage.reasoningTokens != null ||
    usage.totalTokens != null ||
    usage.transcriptTokens != null ||
    usage.cacheReadTokens != null ||
    usage.cacheWriteTokens != null ||
    usage.searchTokens != null
  );
};

const buildSyntheticTranscriptFromRunArtifact = (artifact: RunArtifactContext | null): any[] => {
  const turns = Array.isArray(artifact?.turns) ? artifact!.turns : [];
  if (turns.length === 0) return [];
  const baseMs = parseIsoMs(artifact?.startedAt) ?? Date.now();
  const rows: any[] = [];
  turns.forEach((turn: any, index: number) => {
    const prompt = normalizeId(turn?.prompt) ?? '';
    const userMs = baseMs + index * 2000;
    rows.push({
      ts: userMs,
      created_at: new Date(userMs).toISOString(),
      participant_name: 'Showcase User',
      participant_id: 'canvas-user.synthetic',
      manual: true,
      text: prompt,
      event_id: `showcase-turn-${index + 1}-user`,
    });
    const ackMs = userMs + 1000;
    rows.push({
      ts: ackMs,
      created_at: new Date(ackMs).toISOString(),
      participant_name: 'Voice Agent',
      participant_id: 'voice-agent.synthetic',
      manual: false,
      text: `delivery: ack=${Boolean(turn?.acked)} delivered=${Boolean(turn?.delivered)} connected=${Boolean(turn?.connected)} attempts=${toFiniteNumber(turn?.attemptsUsed) ?? 'n/a'}`,
      event_id: `showcase-turn-${index + 1}-delivery`,
    });
  });
  return rows;
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

const probeOptionalReplayTables = async (
  warnings: string[],
): Promise<OptionalReplayTableAvailability> => {
  const tables: OptionalReplayTable[] = [
    'agent_model_io',
    'agent_tool_io',
    'agent_io_blobs',
  ];
  const results = await Promise.all(
    tables.map(async (table) => {
      const { error } = await supabase.from(table).select('id').limit(1);
      if (!error) return [table, true] as const;
      if (isMissingRelationError(error)) {
        warnings.push(`Optional table unavailable in this environment: ${table}`);
        return [table, false] as const;
      }
      throw error;
    }),
  );
  return Object.fromEntries(results) as OptionalReplayTableAvailability;
};

const splitProviderIdentity = (provider: unknown, model: unknown) => {
  const providerText = typeof provider === 'string' && provider.trim() ? provider.trim() : 'unknown';
  const modelText = typeof model === 'string' && model.trim() ? model.trim() : 'unknown';
  return `${providerText}/${modelText}`;
};

const taskNameOf = (value: any): string => String(value?.task || '').toLowerCase();

const isFairyTaskName = (taskName: string): boolean => taskName === 'fairy.intent';

const isStewardTaskName = (taskName: string): boolean =>
  taskName.startsWith('canvas.') ||
  taskName.startsWith('scorecard.') ||
  taskName.startsWith('flowchart.') ||
  taskName.startsWith('youtube.');

const isFastRow = (row: any) => {
  const source = String(row?.source || '').toLowerCase();
  const providerPath = String(row?.provider_path || '').toLowerCase();
  if (source.startsWith('fast_')) return true;
  if (providerPath === 'fast') return true;
  const provider = String(row?.provider || '').toLowerCase();
  return provider === 'cerebras';
};

const isFastTraceRow = (row: any) => {
  const providerPath = String(
    row?.provider_path ?? row?.providerPath ?? row?.payload?.provider_path ?? row?.payload?.providerPath ?? '',
  ).toLowerCase();
  if (providerPath === 'fast') return true;
  const provider = String(row?.provider ?? row?.payload?.provider ?? '').toLowerCase();
  if (provider === 'cerebras') return true;
  const task = String(row?.task || '').toLowerCase();
  return task.startsWith('fast_');
};

const isVoiceTranscriptRow = (row: any): boolean => {
  const participantId = String(row?.participant_id || row?.participantId || '').toLowerCase();
  const participantName = String(row?.participant_name || row?.participantName || '').toLowerCase();
  return participantId.includes('voice-agent') || participantName.includes('voice agent');
};

const isTranscriptionTranscriptRow = (row: any): boolean => {
  const participantId = String(row?.participant_id || row?.participantId || '').toLowerCase();
  const participantName = String(row?.participant_name || row?.participantName || '').toLowerCase();
  return (
    participantId.includes('transcription') ||
    participantId.includes('transcriber') ||
    participantId.includes('stt') ||
    participantName.includes('transcription') ||
    participantName.includes('transcriber')
  );
};

const compareCreatedAtRows = (a: any, b: any): number => {
  const aMs = toMs(a.created_at ?? a.ts) ?? 0;
  const bMs = toMs(b.created_at ?? b.ts) ?? 0;
  if (aMs !== bMs) return aMs - bMs;
  const aSeq = toSequence(a.sequence ?? a.attempt ?? a.seq);
  const bSeq = toSequence(b.sequence ?? b.attempt ?? b.seq);
  if (aSeq !== bSeq) return aSeq - bSeq;
  return String(a.id ?? a.event_id ?? '').localeCompare(String(b.id ?? b.event_id ?? ''));
};

const rowIdentityKey = (row: any): string => {
  const id = normalizeId(row?.id ?? row?.event_id ?? row?.eventId);
  if (id) return `id:${id}`;
  const trace = normalizeId(row?.trace_id ?? row?.traceId) || '';
  const request = normalizeId(row?.request_id ?? row?.requestId) || '';
  const task = normalizeId(row?.task_id ?? row?.taskId ?? row?.task) || '';
  const stage = normalizeId(row?.stage) || '';
  const ts = toIso(row?.created_at ?? row?.ts);
  return `fallback:${trace}|${request}|${task}|${stage}|${ts}`;
};

const mergeRowsByIdentity = (primary: any[], secondary: any[]): any[] => {
  const map = new Map<string, any>();
  for (const row of primary) {
    map.set(rowIdentityKey(row), row);
  }
  for (const row of secondary) {
    const key = rowIdentityKey(row);
    if (!map.has(key)) {
      map.set(key, row);
      continue;
    }
    const existing = map.get(key) ?? {};
    const merged = { ...row, ...existing } as Record<string, unknown>;
    for (const [field, value] of Object.entries(row)) {
      const existingValue = (existing as Record<string, unknown>)[field];
      if (
        (existingValue == null || (typeof existingValue === 'string' && existingValue.trim().length === 0)) &&
        !(value == null || (typeof value === 'string' && value.trim().length === 0))
      ) {
        merged[field] = value;
      }
    }
    map.set(key, merged);
  }
  return Array.from(map.values()).sort(compareCreatedAtRows);
};

const toKeyToken = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');

const findFirstNestedField = (sources: unknown[], keys: string[], maxScans = 5000): unknown => {
  const normalizedKeys = new Set(keys.map(toKeyToken));
  const queue = [...sources.map(parseMaybeJson)];
  const seen = new Set<unknown>();
  let scanned = 0;
  while (queue.length > 0 && scanned < maxScans) {
    const current = queue.shift();
    scanned += 1;
    if (current == null) continue;
    if (typeof current !== 'object') continue;
    if (seen.has(current)) continue;
    seen.add(current);

    if (Array.isArray(current)) {
      for (const item of current) queue.push(item);
      continue;
    }

    const obj = current as Record<string, unknown>;
    for (const [key, value] of Object.entries(obj)) {
      const token = toKeyToken(key);
      if (
        normalizedKeys.has(token) &&
        value != null &&
        !(
          typeof value === 'string' &&
          value.trim().length === 0
        )
      ) {
        return value;
      }
      if (typeof value === 'object') queue.push(value);
      if (typeof value === 'string') queue.push(parseMaybeJson(value));
    }
  }
  return null;
};

const extractPromptArtifacts = (...sources: unknown[]) => {
  const parsedSources = sources.map(parseMaybeJson);
  return {
    systemPrompt: findFirstNestedField(parsedSources, [
      'system_prompt',
      'systemPrompt',
      'developer_prompt',
      'developerPrompt',
      'system_instruction',
      'systemInstruction',
    ]),
    contextPriming: findFirstNestedField(parsedSources, [
      'context_priming',
      'contextPriming',
      'runtime_context',
      'runtimeContext',
      'conversation_context',
      'conversationContext',
      'priming',
    ]),
    instructions: findFirstNestedField(parsedSources, [
      'instructions',
      'instruction',
      'prompt_instructions',
      'promptInstructions',
    ]),
    toolDescriptions: findFirstNestedField(parsedSources, [
      'tool_descriptions',
      'toolDescriptions',
      'tool_catalog',
      'toolCatalog',
      'tool_definitions',
      'toolDefinitions',
      'tools',
    ]),
  };
};

const renderJsonDetails = (title: string, value: unknown, open = false) => {
  return `<details ${open ? 'open' : ''}><summary>${esc(title)}</summary><pre>${prettyJson(value)}</pre></details>`;
};

const renderTokenUsageBlock = (usage: TokenUsage | null) => {
  if (!usage) return '';
  return renderJsonDetails('Token Usage', usage);
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
      const promptArtifacts = extractPromptArtifacts(
        row.system_prompt,
        row.context_priming,
        row.metadata,
        row.input_payload,
        row.output_payload,
        inputBlob?.payload,
        outputBlob?.payload,
      );
      const usage = extractTokenUsage(
        row,
        row.metadata,
        row.input_payload,
        row.output_payload,
        inputBlob?.payload,
        outputBlob?.payload,
      );
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
  <div><strong>tokens</strong><br>${esc(formatTokenUsage(usage))}</div>
</div>
${row.error ? `<p class="error"><strong>Error:</strong> ${esc(row.error)}</p>` : ''}
${renderTokenUsageBlock(usage)}
${renderJsonDetails('System Prompt', row.system_prompt ?? promptArtifacts.systemPrompt ?? null)}
${renderJsonDetails('Context Priming', row.context_priming ?? promptArtifacts.contextPriming ?? null)}
${renderJsonDetails('Instructions', promptArtifacts.instructions ?? null)}
${renderJsonDetails('Tool Descriptions', promptArtifacts.toolDescriptions ?? null)}
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
      const usage = extractTokenUsage(
        row,
        row.metadata,
        row.input_payload,
        row.output_payload,
        inputBlob?.payload,
        outputBlob?.payload,
      );
      return `<details>
<summary>${esc(toIso(row.created_at))} · ${esc(row.source)} · ${esc(row.tool_name)} · ${esc(row.event_type)} · ${esc(row.status || '')}</summary>
<div class="kv-grid">
  <div><strong>sequence</strong><br>${esc(row.sequence)}</div>
  <div><strong>tool_call_id</strong><br>${esc(row.tool_call_id || '')}</div>
  <div><strong>request_id</strong><br>${esc(row.request_id || '')}</div>
  <div><strong>trace_id</strong><br>${esc(row.trace_id || '')}</div>
  <div><strong>intent_id</strong><br>${esc(row.intent_id || '')}</div>
  <div><strong>provider/model</strong><br>${esc(splitProviderIdentity(row.provider, row.model))}</div>
  <div><strong>tokens</strong><br>${esc(formatTokenUsage(usage))}</div>
</div>
${row.error ? `<p class="error"><strong>Error:</strong> ${esc(row.error)}</p>` : ''}
${renderTokenUsageBlock(usage)}
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
      const usage = extractTokenUsage(trace, trace.payload);
      const promptArtifacts = extractPromptArtifacts(trace.payload);
      return `<details>
<summary>${esc(toIso(trace.created_at))} · ${esc(trace.stage)} · ${esc(trace.status || '')} · task=${esc(trace.task || '')}</summary>
<div class="kv-grid">
  <div><strong>request_id</strong><br>${esc(trace.request_id || '')}</div>
  <div><strong>trace_id</strong><br>${esc(trace.trace_id || '')}</div>
  <div><strong>intent_id</strong><br>${esc(trace.intent_id || '')}</div>
  <div><strong>task_id</strong><br>${esc(trace.task_id || '')}</div>
  <div><strong>provider/model</strong><br>${esc(splitProviderIdentity(trace.provider, trace.model))}</div>
  <div><strong>provider_path</strong><br>${esc(trace.provider_path || '')}</div>
  <div><strong>tokens</strong><br>${esc(formatTokenUsage(usage))}</div>
</div>
${renderTokenUsageBlock(usage)}
${promptArtifacts.systemPrompt ? renderJsonDetails('System Prompt (trace payload)', promptArtifacts.systemPrompt) : ''}
${promptArtifacts.contextPriming ? renderJsonDetails('Context Priming (trace payload)', promptArtifacts.contextPriming) : ''}
${promptArtifacts.instructions ? renderJsonDetails('Instructions (trace payload)', promptArtifacts.instructions) : ''}
${promptArtifacts.toolDescriptions ? renderJsonDetails('Tool Descriptions (trace payload)', promptArtifacts.toolDescriptions) : ''}
${renderJsonDetails('Trace Payload', trace.payload ?? null)}
</details>`;
    })
    .join('\n');
};

const renderPriming = (rows: any[], source: string) => {
  const sourceRows = rows.filter((row) => row.source === source);
  let systemPrompt: unknown = null;
  let contextPriming: unknown = null;
  let instructions: unknown = null;
  let toolDescriptions: unknown = null;
  for (const row of sourceRows) {
    const artifacts = extractPromptArtifacts(
      row.system_prompt,
      row.context_priming,
      row.metadata,
      row.input_payload,
      row.output_payload,
    );
    if (systemPrompt == null) systemPrompt = row.system_prompt ?? artifacts.systemPrompt;
    if (contextPriming == null) contextPriming = row.context_priming ?? artifacts.contextPriming;
    if (instructions == null) instructions = artifacts.instructions;
    if (toolDescriptions == null) toolDescriptions = artifacts.toolDescriptions;
    if (systemPrompt && contextPriming && instructions && toolDescriptions) break;
  }

  if (!systemPrompt && !contextPriming && !instructions && !toolDescriptions) {
    return '<p class="muted">No persisted priming rows for this source in the selected window.</p>';
  }
  return [
    systemPrompt ? renderJsonDetails(`${source} initial system prompt`, systemPrompt) : '',
    contextPriming ? renderJsonDetails(`${source} initial context priming`, contextPriming) : '',
    instructions ? renderJsonDetails(`${source} initial instructions`, instructions) : '',
    toolDescriptions ? renderJsonDetails(`${source} initial tool descriptions`, toolDescriptions) : '',
  ].join('\n');
};

const branchKeyFor = (value: any): string => {
  const requestId = normalizeId(value?.request_id ?? value?.requestId);
  if (requestId) return `corr:${requestId}`;
  const traceId = normalizeId(value?.trace_id ?? value?.traceId);
  if (traceId) return `corr:${traceId}`;
  const intentId = normalizeId(value?.intent_id ?? value?.intentId);
  if (intentId) return `corr:${intentId}`;
  const taskId = normalizeId(value?.task_id ?? value?.taskId);
  if (taskId) return `corr:${taskId}`;
  return 'unscoped';
};

const findActionArrays = (value: unknown, limit = 20): unknown[][] => {
  const results: unknown[][] = [];
  const queue: unknown[] = [parseMaybeJson(value)];
  const seen = new Set<unknown>();
  const pushParsed = (input: unknown) => {
    if (typeof input === 'string') {
      const parsed = parseMaybeJson(input);
      if (parsed !== input) queue.push(parsed);
      return;
    }
    queue.push(input);
  };
  const isLikelyActionObject = (item: unknown): boolean => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
    const obj = item as Record<string, unknown>;
    if (typeof obj.type !== 'string') return false;
    return (
      'id' in obj ||
      'shapeId' in obj ||
      'shape' in obj ||
      'props' in obj ||
      'patch' in obj ||
      'changes' in obj ||
      'op' in obj ||
      'parentId' in obj ||
      'index' in obj
    );
  };
  while (queue.length > 0 && results.length < limit) {
    const current = queue.shift();
    if (typeof current === 'string') continue;
    if (!current || typeof current !== 'object') continue;
    if (seen.has(current)) continue;
    seen.add(current);
    if (Array.isArray(current)) {
      const hasActionObjects = current.some((item) => isLikelyActionObject(item));
      if (hasActionObjects) results.push(current);
      for (const item of current) pushParsed(item);
      continue;
    }
    const obj = current as Record<string, unknown>;
    for (const [key, item] of Object.entries(obj)) {
      if (key === 'actions' && Array.isArray(item)) {
        results.push(item);
      }
      pushParsed(item);
    }
  }
  return results;
};

const renderFairyActionLedger = (tasks: any[], traces: any[], runArtifact: RunArtifactContext | null) => {
  const fairyTasks = tasks.filter((task) => String(task.task || '') === 'fairy.intent');
  const runArtifactTasks = Array.isArray((runArtifact as any)?.sessionCorrelation?.body?.tasks)
    ? ((runArtifact as any).sessionCorrelation.body.tasks as any[])
        .filter((task) => String(task?.task || '') === 'fairy.intent')
        .map((task) => ({
          ...task,
          created_at: task.created_at ?? runArtifact?.startedAt ?? null,
          _artifact: true,
        }))
    : [];
  const combined = mergeRowsByIdentity(fairyTasks, runArtifactTasks);
  if (combined.length === 0) return '<p class="muted">No fairy action ledgers captured.</p>';

  return combined
    .map((task) => {
      const matches = traces.filter((trace) => {
        if (String(trace.task || '') !== 'fairy.intent') return false;
        const sameTask = normalizeId(trace.task_id) && normalizeId(task.id) && normalizeId(trace.task_id) === normalizeId(task.id);
        const sameReq = normalizeId(trace.request_id) && normalizeId(task.request_id) && normalizeId(trace.request_id) === normalizeId(task.request_id);
        const sameTrace = normalizeId(trace.trace_id) && normalizeId(task.trace_id) && normalizeId(trace.trace_id) === normalizeId(task.trace_id);
        return Boolean(sameTask || sameReq || sameTrace);
      });
      const actionArrays = [
        ...findActionArrays(task?.params),
        ...findActionArrays(task?.result),
        ...matches.flatMap((trace) => findActionArrays(trace?.payload)),
      ];
      const actionCount =
        toFiniteNumber(task?.result?.actionCount) ??
        toFiniteNumber(task?.result?.action_count) ??
        actionArrays.reduce((max, arr) => Math.max(max, arr.length), 0);

      return `<details>
<summary>${esc(toIso(task.created_at))} · fairy.intent · ${esc(task.status || '')} · actionCount=${esc(actionCount ?? 'n/a')}</summary>
<div class="kv-grid">
  <div><strong>request_id</strong><br>${esc(task.request_id || '')}</div>
  <div><strong>trace_id</strong><br>${esc(task.trace_id || '')}</div>
  <div><strong>task_id</strong><br>${esc(task.id || '')}</div>
  <div><strong>shapeIds</strong><br>${esc((task?.result?.shapeIds || task?.result?.shape_ids || []).join?.(', ') || '')}</div>
</div>
${renderJsonDetails('Fairy Task Input (raw)', task.params ?? null)}
${renderJsonDetails('Fairy Task Output (raw)', task.result ?? null)}
${actionArrays.length > 0 ? renderJsonDetails('Fairy Actions (raw arrays)', actionArrays) : '<p class="muted">No raw action arrays found; showing task/trace payloads only.</p>'}
${matches.length > 0 ? renderJsonDetails('Matched Fairy Trace Payloads', matches.map((trace) => trace.payload)) : ''}
</details>`;
    })
    .join('\n');
};

const buildTimelineEvents = (
  transcript: any[],
  modelIo: any[],
  toolIo: any[],
  tasks: any[],
  traces: any[],
  blobMap: Map<string, any>,
) => {
  const events: any[] = [];

  for (const row of transcript) {
    const ts = typeof row.ts === 'number' && Number.isFinite(row.ts) ? row.ts : toMs(row.created_at) ?? 0;
    events.push({
      ts,
      iso: toIso(row.created_at ?? row.ts),
      kind: 'transcript',
      branch: branchKeyFor(row),
      source: row.participant_id || row.participant_name || 'transcript',
      label: String(row.text || '').slice(0, 180),
      sequence: toSequence(row.sequence),
      requestId: normalizeId(row.request_id),
      traceId: normalizeId(row.trace_id),
      intentId: normalizeId(row.intent_id),
      taskId: normalizeId(row.task_id),
      usage: extractTokenUsage(row),
      payload: row,
    });
  }

  for (const row of modelIo) {
    const inputBlob = row.input_blob_id ? blobMap.get(row.input_blob_id) : null;
    const outputBlob = row.output_blob_id ? blobMap.get(row.output_blob_id) : null;
    events.push({
      ts: toMs(row.created_at) ?? 0,
      iso: toIso(row.created_at),
      kind: 'model_io',
      branch: branchKeyFor(row),
      source: row.source || 'model',
      label: `${row.event_type || 'model_event'} ${row.status || ''}`.trim(),
      sequence: toSequence(row.sequence),
      requestId: normalizeId(row.request_id),
      traceId: normalizeId(row.trace_id),
      intentId: normalizeId(row.intent_id),
      taskId: normalizeId(row.task_id),
      usage: extractTokenUsage(row, row.metadata, row.input_payload, row.output_payload, inputBlob?.payload, outputBlob?.payload),
      payload: { row, inputBlob: inputBlob?.payload ?? null, outputBlob: outputBlob?.payload ?? null },
    });
  }

  for (const row of toolIo) {
    const inputBlob = row.input_blob_id ? blobMap.get(row.input_blob_id) : null;
    const outputBlob = row.output_blob_id ? blobMap.get(row.output_blob_id) : null;
    events.push({
      ts: toMs(row.created_at) ?? 0,
      iso: toIso(row.created_at),
      kind: 'tool_io',
      branch: branchKeyFor(row),
      source: row.source || 'tool',
      label: `${row.tool_name || 'tool'} ${row.event_type || ''} ${row.status || ''}`.trim(),
      sequence: toSequence(row.sequence),
      requestId: normalizeId(row.request_id),
      traceId: normalizeId(row.trace_id),
      intentId: normalizeId(row.intent_id),
      taskId: normalizeId(row.task_id),
      usage: extractTokenUsage(row, row.metadata, row.input_payload, row.output_payload, inputBlob?.payload, outputBlob?.payload),
      payload: { row, inputBlob: inputBlob?.payload ?? null, outputBlob: outputBlob?.payload ?? null },
    });
  }

  for (const row of tasks) {
    events.push({
      ts: toMs(row.created_at) ?? 0,
      iso: toIso(row.created_at),
      kind: 'task',
      branch: branchKeyFor(row),
      source: row.task || 'agent_task',
      label: `${row.task || 'task'} ${row.status || ''}`.trim(),
      sequence: toSequence(row.attempt),
      requestId: normalizeId(row.request_id),
      traceId: normalizeId(row.trace_id),
      intentId: normalizeId(row.intent_id),
      taskId: normalizeId(row.id),
      usage: extractTokenUsage(row, row.params, row.result),
      payload: row,
    });
  }

  for (const row of traces) {
    events.push({
      ts: toMs(row.created_at) ?? 0,
      iso: toIso(row.created_at),
      kind: 'trace',
      branch: branchKeyFor(row),
      source: row.task || 'trace_event',
      label: `${row.stage || ''} ${row.status || ''}`.trim(),
      sequence: toSequence(row.seq),
      requestId: normalizeId(row.request_id),
      traceId: normalizeId(row.trace_id),
      intentId: normalizeId(row.intent_id),
      taskId: normalizeId(row.task_id),
      usage: extractTokenUsage(row, row.payload),
      payload: row,
    });
  }

  events.sort((a, b) => {
    if (a.ts !== b.ts) return a.ts - b.ts;
    if (a.sequence !== b.sequence) return a.sequence - b.sequence;
    return String(a.kind).localeCompare(String(b.kind));
  });
  return events;
};

const renderTimelineBranches = (events: any[]) => {
  if (events.length === 0) return '<p class="muted">No chronological timeline events captured.</p>';
  const grouped = new Map<string, any[]>();
  for (const event of events) {
    if (!grouped.has(event.branch)) grouped.set(event.branch, []);
    grouped.get(event.branch)!.push(event);
  }

  return Array.from(grouped.entries())
    .map(([branch, branchEvents]) => {
      const eventHtml = branchEvents
        .map((event) => {
          return `<details>
<summary>${esc(event.iso)} · ${esc(event.kind)} · ${esc(event.source)} · ${esc(event.label)}</summary>
<div class="kv-grid">
  <div><strong>branch</strong><br>${esc(branch)}</div>
  <div><strong>request_id</strong><br>${esc(event.requestId || '')}</div>
  <div><strong>trace_id</strong><br>${esc(event.traceId || '')}</div>
  <div><strong>intent_id</strong><br>${esc(event.intentId || '')}</div>
  <div><strong>task_id</strong><br>${esc(event.taskId || '')}</div>
  <div><strong>tokens</strong><br>${esc(formatTokenUsage(event.usage))}</div>
</div>
${renderTokenUsageBlock(event.usage)}
${renderJsonDetails('Raw Event Payload', event.payload ?? null)}
</details>`;
        })
        .join('\n');
      return `<details>
<summary>Branch ${esc(branch)} · events=${branchEvents.length}</summary>
${eventHtml}
</details>`;
    })
    .join('\n');
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
  runArtifact: RunArtifactContext | null;
  reportScope: string;
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
    runArtifact,
    reportScope,
  } = input;

  const voiceTranscriptRows = transcript.filter((row) => isVoiceTranscriptRow(row));
  const transcriptionTranscriptRows = transcript.filter((row) => isTranscriptionTranscriptRow(row));

  const fastTraceRows = traces.filter((row) => isFastTraceRow(row));
  const fairyTraceRows = traces.filter((row) => {
    if (isFastTraceRow(row)) return false;
    return isFairyTaskName(taskNameOf(row));
  });
  const stewardTraceRows = traces.filter((row) => {
    if (isFastTraceRow(row)) return false;
    const taskName = taskNameOf(row);
    if (isFairyTaskName(taskName)) return false;
    return isStewardTaskName(taskName);
  });
  const orchestrationTraceRows = traces.filter((row) => {
    const taskName = taskNameOf(row);
    if (isFastTraceRow(row)) return false;
    if (isFairyTaskName(taskName)) return false;
    if (isStewardTaskName(taskName)) return false;
    return true;
  });

  const fairyTaskRows = tasks.filter((task) => isFairyTaskName(taskNameOf(task)));
  const stewardTaskRows = tasks.filter((task) => {
    const taskName = taskNameOf(task);
    if (isFairyTaskName(taskName)) return false;
    return isStewardTaskName(taskName);
  });
  type ReplaySection = {
    title: string;
    description: string;
    transcriptRows?: any[];
    primingSources?: string[];
    modelRows: any[];
    toolRows: any[];
    taskRows?: any[];
    traceRows?: any[];
  };

  const sections: ReplaySection[] = [
    {
      title: 'Voice Agent Transcript',
      description: 'Transcript rows + persisted voice model/tool replay.',
      transcriptRows: voiceTranscriptRows,
      primingSources: ['voice_agent'],
      modelRows: modelIo.filter((row) => row.source === 'voice_agent'),
      toolRows: toolIo.filter((row) => row.source === 'voice_agent'),
    },
    {
      title: 'Transcription Agent Transcript',
      description: 'Transcript rows + persisted transcription model replay.',
      transcriptRows: transcriptionTranscriptRows,
      primingSources: ['transcription_agent'],
      modelRows: modelIo.filter((row) => row.source === 'transcription_agent'),
      toolRows: toolIo.filter((row) => row.source === 'transcription_agent'),
    },
    {
      title: 'Orchestration Agent Transcript',
      description: 'Orchestration model/tool replay plus lifecycle traces.',
      primingSources: ['orchestration_agent'],
      modelRows: modelIo.filter((row) => row.source === 'orchestration_agent'),
      toolRows: toolIo.filter((row) => row.source === 'orchestration_agent'),
      traceRows: orchestrationTraceRows,
    },
    {
      title: 'Steward Agent(s) Transcript',
      description: 'Canvas steward/canvas runner replay + queue task evidence.',
      primingSources: ['canvas_runner'],
      modelRows: modelIo.filter((row) => ['canvas_runner', 'canvas_steward'].includes(String(row.source))),
      toolRows: toolIo.filter((row) => ['canvas_runner', 'conductor_worker'].includes(String(row.source))),
      taskRows: stewardTaskRows,
      traceRows: stewardTraceRows,
    },
    {
      title: 'Fairy Agent(s) Transcript',
      description: 'Fairy router replay and fairy queue tasks.',
      primingSources: ['fairy_router'],
      modelRows: modelIo.filter((row) => row.source === 'fairy_router'),
      toolRows: toolIo.filter(
        (row) => row.source === 'fairy_router' || String(row.tool_name || '') === 'fairy.intent',
      ),
      taskRows: fairyTaskRows,
      traceRows: fairyTraceRows,
    },
    {
      title: 'Fast Agent(s) Transcript',
      description: 'Rows tagged as fast-path (<code>provider_path=fast</code> or fast steward source).',
      modelRows: modelIo.filter((row) => isFastRow(row)),
      toolRows: toolIo.filter((row) => isFastRow(row)),
      traceRows: fastTraceRows,
    },
  ];

  const renderSection = (section: ReplaySection) => {
    const primingBlocks = (section.primingSources || [])
      .map((source) => renderPriming(modelIo, source))
      .join('\n');

    return `<section class="section">
      <h2>${section.title}</h2>
      <p class="muted">${section.description}</p>
      ${section.transcriptRows ? renderTranscriptTable(section.transcriptRows) : ''}
      ${primingBlocks}
      ${renderModelCards(section.modelRows, blobMap)}
      ${renderToolCards(section.toolRows, blobMap)}
      ${section.traceRows ? renderTraceCards(section.traceRows) : ''}
      ${section.taskRows ? renderTaskCards(section.taskRows) : ''}
    </section>`;
  };

  const sectionsHtml = sections.map((section) => renderSection(section)).join('\n');
  const hasReplayRows = modelIo.length > 0 || toolIo.length > 0;
  const timelineEvents = buildTimelineEvents(transcript, modelIo, toolIo, tasks, traces, blobMap);
  const timelineHtml = renderTimelineBranches(timelineEvents);
  const timelineWithTokens = timelineEvents.filter((event) => hasMeasuredTokenUsage(event.usage)).length;
  const fairyActionLedgerHtml = renderFairyActionLedger(tasks, traces, runArtifact);

  const timelineStartIso = toIso(
    transcript[0]?.created_at ||
      transcript[0]?.ts ||
      traces[0]?.created_at ||
      tasks[0]?.created_at ||
      modelIo[0]?.created_at ||
      toolIo[0]?.created_at,
  );
  const timelineEndIso = toIso(
    transcript[transcript.length - 1]?.created_at ||
      transcript[transcript.length - 1]?.ts ||
      traces[traces.length - 1]?.created_at ||
      tasks[tasks.length - 1]?.updated_at ||
      modelIo[modelIo.length - 1]?.created_at ||
      toolIo[toolIo.length - 1]?.created_at,
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
      <p class="muted">Scope: <code>${esc(reportScope)}</code></p>
      ${runArtifact?.runId ? `<p class="muted">Run ID: <code>${esc(runArtifact.runId)}</code></p>` : ''}
      ${runArtifact?.video ? `<p class="muted">Video: <code>${esc(runArtifact.video)}</code></p>` : ''}
      ${runArtifact?.sourcePath ? `<p class="muted">Result JSON: <code>${esc(runArtifact.sourcePath)}</code></p>` : ''}
      <p class="muted">Session timeline: ${esc(timelineStartIso)} → ${esc(timelineEndIso)}</p>
      <p class="muted">Replay query window: ${esc(windowStartIso)} → ${esc(windowEndIso)}</p>
      <span class="pill">transcript rows: ${transcript.length}</span>
      <span class="pill">queue tasks: ${tasks.length}</span>
      <span class="pill">trace events: ${traces.length}</span>
      <span class="pill">model replay rows: ${modelIo.length}</span>
      <span class="pill">tool replay rows: ${toolIo.length}</span>
      <span class="pill">timeline events: ${timelineEvents.length}</span>
      <span class="pill">timeline events w/ token usage: ${timelineWithTokens}</span>
      <span class="pill">raw blobs: ${blobMap.size}</span>
      <span class="pill">trace/request/intent/task keys: ${correlationSummary.traceKeys}/${correlationSummary.requestKeys}/${correlationSummary.intentKeys}/${correlationSummary.taskKeys}</span>
      <span class="pill">model rows matched to correlation keys: ${correlationSummary.modelMatched}/${modelIo.length}</span>
      <span class="pill">tool rows matched to correlation keys: ${correlationSummary.toolMatched}/${toolIo.length}</span>
      <span class="pill">model/tool rows missing correlation ids: ${correlationSummary.modelMissingCorrelation}/${correlationSummary.toolMissingCorrelation}</span>
      ${!hasReplayRows ? '<p class="error"><strong>Future sessions only:</strong> this session does not contain durable replay rows in <code>agent_model_io</code>/<code>agent_tool_io</code>.</p>' : ''}
      ${timelineWithTokens === 0 ? '<p class="error"><strong>Token telemetry missing:</strong> no events in this report include persisted token usage counters.</p>' : ''}
      ${warnings.length > 0 ? `<p class="error"><strong>Warnings:</strong> ${esc(warnings.join(' | '))}</p>` : ''}
    </section>

    <section class="section">
      <h2>Transcript</h2>
      ${renderTranscriptTable(transcript)}
    </section>
    <section class="section">
      <h2>Chronological Replay Timeline</h2>
      <p class="muted">Global chronology grouped into correlation branches; each event includes token usage and raw payload.</p>
      ${timelineHtml}
    </section>
    <section class="section">
      <h2>Fairy Raw Actions Ledger</h2>
      <p class="muted">Raw fairy action arrays correlated from <code>agent_tasks</code>/<code>agent_trace_events</code> and smoke result artifacts.</p>
      ${fairyActionLedgerHtml}
    </section>
    ${sectionsHtml}
  </div>
</body>
</html>`;
};

const run = async () => {
  const warnings: string[] = [];
  let runArtifact: RunArtifactContext | null = null;

  if (hasResultJson && resultJsonArg) {
    const resolvedPath = path.resolve(cwd, resultJsonArg);
    const raw = await fs.readFile(resolvedPath, 'utf8');
    const parsed = JSON.parse(raw);
    runArtifact = {
      runId: normalizeId(parsed?.runId) ?? undefined,
      canvasId: normalizeUuid(parsed?.canvasId) ?? undefined,
      room: normalizeId(parsed?.room) ?? undefined,
      startedAt: toIso(parsed?.startedAt) || undefined,
      endedAt: toIso(parsed?.endedAt) || undefined,
      video: normalizeId(parsed?.video) ?? undefined,
      sourcePath: resolvedPath,
      turns: Array.isArray(parsed?.turns) ? parsed.turns : undefined,
      sessionCorrelation: parsed?.sessionCorrelation,
    };
  }

  if (canvasIdArg && !normalizeUuid(canvasIdArg)) {
    throw new Error(`Invalid --canvas-id: ${canvasIdArg}`);
  }

  const requestedCanvasId = normalizeUuid(canvasIdArg) ?? runArtifact?.canvasId ?? null;
  const requestedRoom = normalizeId(roomArg) ?? runArtifact?.room ?? null;
  const requestedSessionId = normalizeUuid(sessionIdArg);
  if (sessionIdArg && !requestedSessionId) {
    throw new Error(`Invalid --session-id: ${sessionIdArg}`);
  }
  let reportScope = 'synthetic';
  let session: any = null;

  if (requestedSessionId) {
    const bySession = await supabase
      .from('canvas_sessions')
      .select('id,canvas_id,room_name,created_at,updated_at')
      .eq('id', requestedSessionId)
      .maybeSingle();
    if (bySession.error) throw bySession.error;
    if (bySession.data) {
      session = bySession.data;
      reportScope = 'session_id';
    }
  }

  if (!session && requestedCanvasId) {
    let query = supabase
      .from('canvas_sessions')
      .select('id,canvas_id,room_name,created_at,updated_at')
      .eq('canvas_id', requestedCanvasId);
    if (requestedRoom) {
      query = query.eq('room_name', requestedRoom);
    }
    const byCanvas = await query.order('updated_at', { ascending: false }).limit(1).maybeSingle();
    if (byCanvas.error) throw byCanvas.error;
    if (byCanvas.data) {
      session = byCanvas.data;
      reportScope = 'canvas_id';
    }
  }

  if (!session && requestedRoom) {
    const byRoom = await supabase
      .from('canvas_sessions')
      .select('id,canvas_id,room_name,created_at,updated_at')
      .eq('room_name', requestedRoom)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (byRoom.error) throw byRoom.error;
    if (byRoom.data) {
      session = byRoom.data;
      reportScope = requestedCanvasId ? 'room_fallback_for_canvas' : 'room_name';
    }
  }

  if (!session) {
    if (!requestedRoom) {
      throw new Error(
        `No canvas_sessions row found for ${requestedCanvasId ? `canvas_id=${requestedCanvasId}` : 'provided selectors'}, and no room was available for synthetic fallback.`,
      );
    }
    warnings.push('No canvas_sessions row found; using synthetic session context based on room and time window.');
    session = {
      id: requestedSessionId ?? runArtifact?.runId ?? `synthetic:${requestedRoom}`,
      canvas_id: requestedCanvasId,
      room_name: requestedRoom,
      created_at: runArtifact?.startedAt ?? new Date().toISOString(),
      updated_at: runArtifact?.endedAt ?? runArtifact?.startedAt ?? new Date().toISOString(),
    };
    reportScope = requestedCanvasId ? 'synthetic_canvas+room' : 'synthetic_room';
  }

  const room = normalizeId(session.room_name) ?? requestedRoom;
  if (!room) {
    throw new Error('Unable to resolve room for report scope.');
  }

  const createdAtMs = Date.parse(String(session.created_at || ''));
  const updatedAtMs = Date.parse(String(session.updated_at || ''));
  const runStartMs = parseIsoMs(runArtifact?.startedAt);
  const runEndMs = parseIsoMs(runArtifact?.endedAt);
  const baseStartMs =
    runStartMs ?? (Number.isFinite(createdAtMs) ? createdAtMs : Date.now() - 2 * 60 * 60 * 1000);
  const baseEndMs =
    runEndMs ?? (Number.isFinite(updatedAtMs) ? updatedAtMs : Date.now());
  const roomTranscriptStartMs = Math.min(baseStartMs, baseEndMs) - 20 * 60 * 1000;
  const roomTranscriptEndMs = Math.max(baseStartMs, baseEndMs) + 20 * 60 * 1000;

  const optionalReplayTables = await probeOptionalReplayTables(warnings);

  let transcript: any[] = [];
  let transcriptRelationAvailable = true;
  const sessionIdForTranscript = normalizeUuid(session.id);
  if (!sessionIdForTranscript) {
    warnings.push('Skipping canvas_session_transcripts lookup: synthetic session id is not a UUID.');
  } else {
    try {
      transcript = await fetchAll(
        'canvas_session_transcripts',
        (q) => q.select('*').eq('session_id', sessionIdForTranscript).order('ts', { ascending: true }),
        1000,
      );
    } catch (error) {
      if (isMissingRelationError(error)) {
        transcriptRelationAvailable = false;
        warnings.push('Optional table unavailable in this environment: canvas_session_transcripts');
      } else {
        throw error;
      }
    }
  }

  if (transcriptRelationAvailable && transcript.length === 0) {
    const byRoom = await fetchAll(
      'canvas_session_transcripts',
      (q) =>
        q
          .select('*')
          .eq('room_name', room)
          .gte('ts', roomTranscriptStartMs)
          .lte('ts', roomTranscriptEndMs)
          .order('ts', { ascending: true }),
      1000,
    );
    transcript = byRoom;
    if (byRoom.length > 0) {
      reportScope = `${reportScope}+room_transcript`;
    }
  }

  if (transcript.length === 0) {
    const syntheticTranscript = buildSyntheticTranscriptFromRunArtifact(runArtifact);
    if (syntheticTranscript.length > 0) {
      transcript = syntheticTranscript.sort(compareCreatedAtRows);
      reportScope = `${reportScope}+artifact_turns_transcript`;
      warnings.push(
        'No persisted transcript rows found; transcript section synthesized from smoke result.json turns.',
      );
    }
  }

  const transcriptTimes = transcript
    .map((row) => {
      const ts = row.ts;
      return typeof ts === 'number' && Number.isFinite(ts) ? ts : NaN;
    })
    .filter((ts) => Number.isFinite(ts));

  const transcriptMin = transcriptTimes.length > 0 ? Math.min(...transcriptTimes) : Number.NaN;
  const transcriptMax = transcriptTimes.length > 0 ? Math.max(...transcriptTimes) : Number.NaN;
  const cliStartMs = parseIsoMs(windowStartArg);
  const cliEndMs = parseIsoMs(windowEndArg);

  const inferredStartMs = Number.isFinite(transcriptMin)
    ? transcriptMin
    : runStartMs ?? (Number.isFinite(createdAtMs) ? createdAtMs : Date.now() - 2 * 60 * 60 * 1000);
  const inferredEndMs = Number.isFinite(transcriptMax)
    ? transcriptMax
    : runEndMs ?? (Number.isFinite(updatedAtMs) ? updatedAtMs : Date.now());

  const windowStartIso = new Date(
    cliStartMs ?? inferredStartMs - 5 * 60 * 1000,
  ).toISOString();
  const windowEndIso = new Date(
    cliEndMs ?? inferredEndMs + 30 * 60 * 1000,
  ).toISOString();

  let [tasks, traces] = await Promise.all([
    fetchAll(
      'agent_tasks',
      (q) =>
        q
          .select('*')
          .eq('room', room)
          .gte('created_at', windowStartIso)
          .lte('created_at', windowEndIso)
          .order('created_at', { ascending: true })
          .order('id', { ascending: true }),
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
          .order('created_at', { ascending: true })
          .order('id', { ascending: true }),
      1000,
    ),
  ]);

  const artifactTasks = Array.isArray((runArtifact as any)?.sessionCorrelation?.body?.tasks)
    ? ((runArtifact as any).sessionCorrelation.body.tasks as any[])
    : [];
  const artifactTraces = Array.isArray((runArtifact as any)?.sessionCorrelation?.body?.traces)
    ? ((runArtifact as any).sessionCorrelation.body.traces as any[])
    : [];

  if (artifactTasks.length > 0) {
    const mergedTasks = mergeRowsByIdentity(tasks, artifactTasks);
    if (mergedTasks.length > tasks.length) {
      reportScope = `${reportScope}+artifact_tasks`;
      warnings.push(
        `Merged ${mergedTasks.length - tasks.length} task row(s) from smoke sessionCorrelation artifact.`,
      );
      tasks = mergedTasks;
    }
  }

  if (artifactTraces.length > 0) {
    const mergedTraces = mergeRowsByIdentity(traces, artifactTraces);
    if (mergedTraces.length > traces.length) {
      reportScope = `${reportScope}+artifact_traces`;
      warnings.push(
        `Merged ${mergedTraces.length - traces.length} trace row(s) from smoke sessionCorrelation artifact.`,
      );
      traces = mergedTraces;
    }
  }

  const [modelIoRaw, toolIoRaw] = await Promise.all(
    [
      optionalReplayTables.agent_model_io
        ? fetchAll(
            'agent_model_io',
            (q) =>
              q
                .select('*')
                .eq('room', room)
                .gte('created_at', windowStartIso)
                .lte('created_at', windowEndIso)
                .order('created_at', { ascending: true })
                .order('id', { ascending: true }),
            1000,
          )
        : Promise.resolve([]),
      optionalReplayTables.agent_tool_io
        ? fetchAll(
            'agent_tool_io',
            (q) =>
              q
                .select('*')
                .eq('room', room)
                .gte('created_at', windowStartIso)
                .lte('created_at', windowEndIso)
                .order('created_at', { ascending: true })
                .order('id', { ascending: true }),
            1000,
          )
        : Promise.resolve([]),
    ] as const,
  );

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
  if (optionalReplayTables.agent_io_blobs) {
    blobMap = await fetchBlobMap(blobIds);
  }

  const displayCanvasId =
    normalizeUuid(session.canvas_id) ??
    requestedCanvasId ??
    runArtifact?.canvasId ??
    `room:${room}`;

  const html = buildHtml({
    canvasId: displayCanvasId,
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
    runArtifact,
    reportScope,
  });

  await fs.mkdir(outDir, { recursive: true });
  const stemToken =
    normalizeUuid(displayCanvasId) ??
    (runArtifact?.runId ? `run-${sanitizeFileStem(runArtifact.runId)}` : `room-${sanitizeFileStem(room)}`);
  const stem = `agent-chat-report-${stemToken}`;
  const htmlPath = path.join(outDir, `${stem}.html`);
  const jsonPath = path.join(outDir, `${stem}.json`);

  const rawBundle = {
    generatedAt: new Date().toISOString(),
    canvasId: displayCanvasId,
    reportScope,
    runArtifact,
    room,
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
    warnings,
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

  console.log(JSON.stringify({ htmlPath, jsonPath, reportScope, room }, null, 2));
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
