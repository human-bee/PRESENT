import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createHash, randomUUID } from 'crypto';
import { createLogger } from '@/lib/logging';
import { getNumberFlag } from '@/lib/feature-flags';

type JsonObject = Record<string, unknown>;

type ReplayPriority = 'high' | 'normal';

const REPLAY_TABLE_CONFIG = {
  agent_io_blobs: {
    onConflict: 'event_id,kind',
    ignoreDuplicates: true,
  },
  agent_model_io: {
    onConflict: 'event_id',
    ignoreDuplicates: true,
  },
  agent_tool_io: {
    onConflict: 'event_id',
    ignoreDuplicates: true,
  },
} as const;

type ReplayTable = keyof typeof REPLAY_TABLE_CONFIG;

type ReplayQueueEntry = {
  table: ReplayTable;
  row: Record<string, unknown>;
  priority: ReplayPriority;
};

type ReplayCorrelation = {
  sessionId?: string;
  room?: string;
  traceId?: string;
  requestId?: string;
  intentId?: string;
  taskId?: string;
  sequence?: number;
};

type ReplayProvider = {
  provider?: string;
  model?: string;
  providerSource?: string;
  providerPath?: string;
  providerRequestId?: string;
};

type ReplayEventInputBase = ReplayCorrelation &
  ReplayProvider & {
    eventId?: string;
    source: string;
    eventType: string;
    status?: string;
    input?: unknown;
    output?: unknown;
    error?: string;
    metadata?: JsonObject;
    latencyMs?: number;
    priority?: ReplayPriority;
  };

export type ModelIoEventInput = ReplayEventInputBase & {
  systemPrompt?: string;
  contextPriming?: unknown;
};

export type ToolIoEventInput = ReplayEventInputBase & {
  toolName: string;
  toolCallId?: string;
};

type ReplayEventContext = {
  createdAt: string;
  expiresAt: string;
  priority: ReplayPriority;
  eventId: string;
  correlation: ReplayCorrelation;
  blobIds: { inputBlobId: string | null; outputBlobId: string | null };
};

const logger = createLogger('agents:replay-telemetry');

const replayTelemetryRetentionDays = Math.max(
  1,
  Math.floor(getNumberFlag(process.env.AGENT_REPLAY_RETENTION_DAYS, 90)),
);
const replayTelemetryQueueMax = Math.max(
  100,
  Math.floor(getNumberFlag(process.env.AGENT_REPLAY_QUEUE_MAX, 2_000)),
);
const replayTelemetryBatchSize = Math.max(
  10,
  Math.min(500, Math.floor(getNumberFlag(process.env.AGENT_REPLAY_BATCH_SIZE, 100))),
);
const replayTelemetryFlushMs = Math.max(
  10,
  Math.floor(getNumberFlag(process.env.AGENT_REPLAY_FLUSH_MS, 50)),
);
const replayTelemetryInlineMaxBytes = Math.max(
  1024,
  Math.floor(getNumberFlag(process.env.AGENT_REPLAY_INLINE_MAX_BYTES, 32_768)),
);
const replayTelemetryBlobMaxBytes = Math.max(
  replayTelemetryInlineMaxBytes,
  Math.floor(getNumberFlag(process.env.AGENT_REPLAY_BLOB_MAX_BYTES, 262_144)),
);
const replayTelemetryPreviewChars = Math.max(
  200,
  Math.floor(getNumberFlag(process.env.AGENT_REPLAY_PREVIEW_CHARS, 4_000)),
);

let replayDb: SupabaseClient | null = null;
let replayDbConfigMissing = false;
let replayDbConfigWarned = false;
const replayQueue: ReplayQueueEntry[] = [];
let replayFlushHandle: ReturnType<typeof setTimeout> | null = null;
let replayFlushing = false;
let droppedLowPriority = 0;
let droppedHighPriority = 0;

const normalizeText = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const normalizeInteger = (value: unknown): number | null => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.max(0, Math.floor(value));
};

const safeStringify = (value: unknown): string => {
  try {
    const serialized = JSON.stringify(value);
    if (typeof serialized === 'string') return serialized;
    return JSON.stringify({ encode_error: true, reason: 'non_json_value', type: typeof value });
  } catch {
    return JSON.stringify({ encode_error: true, type: typeof value });
  }
};

const buildInlinePayload = (value: unknown): JsonObject | null => {
  if (typeof value === 'undefined') return null;
  const serialized = safeStringify(value);
  const sizeBytes = Buffer.byteLength(serialized, 'utf8');
  if (sizeBytes <= replayTelemetryInlineMaxBytes) {
    try {
      const parsed = JSON.parse(serialized);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as JsonObject;
      }
      return { value: parsed };
    } catch {
      return { value: serialized };
    }
  }
  return {
    truncated: true,
    size_bytes: sizeBytes,
    preview: serialized.slice(0, replayTelemetryPreviewChars),
  };
};

const nowIso = () => new Date().toISOString();

const expiresAtIso = (createdAtIso: string): string => {
  const created = Date.parse(createdAtIso);
  const base = Number.isFinite(created) ? created : Date.now();
  return new Date(base + replayTelemetryRetentionDays * 24 * 60 * 60 * 1000).toISOString();
};

const getReplayDb = (): SupabaseClient | null => {
  if (replayDbConfigMissing) return null;
  if (replayDb) return replayDb;
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRole) {
    replayDbConfigMissing = true;
    if (!replayDbConfigWarned) {
      replayDbConfigWarned = true;
      logger.warn('replay telemetry unavailable: missing supabase service-role config');
    }
    return null;
  }
  replayDb = createClient(url, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return replayDb;
};

const enqueueReplayEntry = (entry: ReplayQueueEntry): boolean => {
  if (!getReplayDb()) return false;

  if (replayQueue.length >= replayTelemetryQueueMax) {
    if (entry.priority === 'high') {
      const lowPriorityIndex = replayQueue.findIndex((item) => item.priority === 'normal');
      if (lowPriorityIndex >= 0) {
        replayQueue.splice(lowPriorityIndex, 1);
        droppedLowPriority += 1;
      } else {
        droppedHighPriority += 1;
        if (droppedHighPriority % 25 === 0) {
          logger.warn('replay telemetry high-priority event dropped (queue saturated)', {
            droppedHighPriority,
            queueSize: replayQueue.length,
          });
        }
        return false;
      }
    } else {
      droppedLowPriority += 1;
      if (droppedLowPriority % 100 === 0) {
        logger.warn('replay telemetry low-priority events dropped', {
          droppedLowPriority,
            queueSize: replayQueue.length,
        });
      }
      return false;
    }
  }

  replayQueue.push(entry);

  if (replayQueue.length >= replayTelemetryBatchSize) {
    void flushReplayTelemetryNow();
    return true;
  }

  if (!replayFlushHandle) {
    replayFlushHandle = setTimeout(() => {
      replayFlushHandle = null;
      void flushReplayTelemetryNow();
    }, replayTelemetryFlushMs);
  }
  return true;
};

const buildBlobRow = (
  params: ReplayCorrelation & {
    eventId: string;
    kind: string;
    payload: unknown;
    metadata?: JsonObject;
  },
): { id: string; row: Record<string, unknown> } | null => {
  if (typeof params.payload === 'undefined') return null;

  const createdAt = nowIso();
  const expiresAt = expiresAtIso(createdAt);
  const serialized = safeStringify(params.payload);
  const sizeBytes = Buffer.byteLength(serialized, 'utf8');
  const truncated = sizeBytes > replayTelemetryBlobMaxBytes;
  const normalizedPayload = truncated
    ? serialized.slice(0, replayTelemetryBlobMaxBytes)
    : serialized;

  const id = randomUUID();
  return {
    id,
    row: {
      id,
      event_id: params.eventId,
      kind: params.kind,
      created_at: createdAt,
      expires_at: expiresAt,
      room: normalizeText(params.room),
      trace_id: normalizeText(params.traceId),
      request_id: normalizeText(params.requestId),
      intent_id: normalizeText(params.intentId),
      payload: normalizedPayload,
      encoding: 'utf8',
      mime_type: 'application/json',
      size_bytes: sizeBytes,
      sha256: createHash('sha256').update(normalizedPayload).digest('hex'),
      truncated,
      metadata: params.metadata ?? null,
    },
  };
};

const queueBlobRows = (
  correlation: ReplayCorrelation,
  eventId: string,
  inputPayload: unknown,
  outputPayload: unknown,
  priority: ReplayPriority,
  metadata?: JsonObject,
): { inputBlobId: string | null; outputBlobId: string | null } => {
  const inputBlob = buildBlobRow({
    ...correlation,
    eventId,
    kind: 'input',
    payload: inputPayload,
    metadata,
  });
  const outputBlob = buildBlobRow({
    ...correlation,
    eventId,
    kind: 'output',
    payload: outputPayload,
    metadata,
  });

  const inputQueued = inputBlob
    ? enqueueReplayEntry({
      table: 'agent_io_blobs',
      row: inputBlob.row,
      priority,
    })
    : false;
  const outputQueued = outputBlob
    ? enqueueReplayEntry({
      table: 'agent_io_blobs',
      row: outputBlob.row,
      priority,
    })
    : false;

  return {
    inputBlobId: inputQueued ? inputBlob?.id ?? null : null,
    outputBlobId: outputQueued ? outputBlob?.id ?? null : null,
  };
};

const buildReplayEventContext = (input: ReplayEventInputBase): ReplayEventContext => {
  const createdAt = nowIso();
  const expiresAt = expiresAtIso(createdAt);
  const priority = input.priority ?? (input.error ? 'high' : 'normal');
  const eventIdBase = normalizeText(input.eventId);
  const eventId = eventIdBase ? `${eventIdBase}:${randomUUID()}` : randomUUID();
  const correlation: ReplayCorrelation = {
    sessionId: input.sessionId,
    room: input.room,
    traceId: input.traceId,
    requestId: input.requestId,
    intentId: input.intentId,
    taskId: input.taskId,
    sequence: input.sequence,
  };

  const blobIds = queueBlobRows(
    correlation,
    eventId,
    input.input,
    input.output,
    priority,
    input.metadata,
  );

  return {
    createdAt,
    expiresAt,
    priority,
    eventId,
    correlation,
    blobIds,
  };
};

const buildReplayCommonRow = (
  input: ReplayEventInputBase,
  ctx: ReplayEventContext,
): Record<string, unknown> => {
  return {
    id: randomUUID(),
    event_id: ctx.eventId,
    sequence: normalizeInteger(input.sequence) ?? 0,
    created_at: ctx.createdAt,
    expires_at: ctx.expiresAt,
    session_id: normalizeText(input.sessionId),
    room: normalizeText(input.room),
    trace_id: normalizeText(input.traceId),
    request_id: normalizeText(input.requestId),
    intent_id: normalizeText(input.intentId),
    task_id: normalizeText(input.taskId),
    source: input.source,
    event_type: input.eventType,
    status: normalizeText(input.status),
    provider: normalizeText(input.provider),
    model: normalizeText(input.model),
    provider_source: normalizeText(input.providerSource),
    provider_path: normalizeText(input.providerPath),
    provider_request_id: normalizeText(input.providerRequestId),
    input_payload: buildInlinePayload(input.input),
    output_payload: buildInlinePayload(input.output),
    metadata: buildInlinePayload(input.metadata),
    error: normalizeText(input.error),
    latency_ms: normalizeInteger(input.latencyMs),
    input_blob_id: ctx.blobIds.inputBlobId,
    output_blob_id: ctx.blobIds.outputBlobId,
  };
};

const enqueueReplayEvent = <TInput extends ReplayEventInputBase>(params: {
  table: ReplayTable;
  input: TInput;
  buildRow: (input: TInput, ctx: ReplayEventContext) => Record<string, unknown>;
}): boolean => {
  const ctx = buildReplayEventContext(params.input);
  const row = params.buildRow(params.input, ctx);
  return enqueueReplayEntry({
    table: params.table,
    priority: ctx.priority,
    row,
  });
};

export const recordModelIoEvent = (input: ModelIoEventInput): boolean => {
  return enqueueReplayEvent({
    table: 'agent_model_io',
    input,
    buildRow: (modelInput, ctx) => ({
      ...buildReplayCommonRow(modelInput, ctx),
      system_prompt: normalizeText(modelInput.systemPrompt),
      context_priming: buildInlinePayload(modelInput.contextPriming),
    }),
  });
};

export const recordToolIoEvent = (input: ToolIoEventInput): boolean => {
  return enqueueReplayEvent({
    table: 'agent_tool_io',
    input,
    buildRow: (toolInput, ctx) => ({
      ...buildReplayCommonRow(toolInput, ctx),
      tool_name: toolInput.toolName,
      tool_call_id: normalizeText(toolInput.toolCallId),
    }),
  });
};

export const flushReplayTelemetryNow = async (): Promise<void> => {
  if (replayFlushing) return;

  const db = getReplayDb();
  if (!db) return;

  replayFlushing = true;
  try {
    const replayTables = Object.keys(REPLAY_TABLE_CONFIG) as ReplayTable[];
    while (replayQueue.length > 0) {
      const batch = replayQueue.splice(0, replayTelemetryBatchSize);
      const grouped = replayTables.reduce(
        (acc, table) => {
          acc[table] = [];
          return acc;
        },
        {} as Record<ReplayTable, Record<string, unknown>[]>,
      );
      for (const entry of batch) {
        grouped[entry.table].push(entry.row);
      }

      let failed = false;
      for (const table of replayTables) {
        const rows = grouped[table];
        if (rows.length === 0) continue;
        const config = REPLAY_TABLE_CONFIG[table];
        const { error } = await db.from(table).upsert(rows, {
          onConflict: config.onConflict,
          ignoreDuplicates: config.ignoreDuplicates,
        });
        if (error) {
          logger.warn('replay telemetry insert failed', {
            table,
            rows: rows.length,
            error: error.message,
          });
          failed = true;
          break;
        }
      }
      if (failed) {
        replayQueue.unshift(...batch);
        return;
      }
    }
  } finally {
    replayFlushing = false;
  }
};

export const recordExternalTelemetryEvent = (input: {
  event: string;
  payload?: unknown;
  metadata?: JsonObject;
  room?: string;
  traceId?: string;
  requestId?: string;
  intentId?: string;
  sessionId?: string;
  status?: string;
}): boolean => {
  return recordToolIoEvent({
    source: 'agent_telemetry_api',
    eventType: input.event,
    toolName: input.event,
    status: input.status,
    sessionId: input.sessionId,
    room: input.room,
    traceId: input.traceId,
    requestId: input.requestId,
    intentId: input.intentId,
    input: input.payload,
    metadata: input.metadata,
  });
};

const flushOnShutdown = async () => {
  if (replayQueue.length === 0) return;
  try {
    await flushReplayTelemetryNow();
  } catch {
    // Non-fatal best-effort flush path.
  }
};

if (typeof process !== 'undefined') {
  process.once('beforeExit', () => {
    void flushOnShutdown();
  });
}
