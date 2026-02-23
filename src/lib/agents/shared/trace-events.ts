import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import { flags } from '@/lib/feature-flags';
import { createLogger } from '@/lib/logging';
import { deriveRequestCorrelation } from './request-correlation';
import type { JsonObject } from '@/lib/utils/json-schema';
import { deriveProviderParity } from '@/lib/agents/admin/provider-parity';
import { isMissingColumnError } from '@/lib/agents/admin/supabase-errors';

export type AgentTraceStage =
  | 'api_received'
  | 'queued'
  | 'deduped'
  | 'claimed'
  | 'executing'
  | 'routed'
  | 'actions_dispatched'
  | 'ack_received'
  | 'completed'
  | 'failed'
  | 'canceled'
  | 'fallback';

type AgentTraceEventInput = {
  stage: AgentTraceStage;
  status?: string;
  traceId?: string;
  requestId?: string;
  intentId?: string;
  taskId?: string;
  attempt?: number;
  room?: string;
  task?: string;
  component?: string;
  latencyMs?: number;
  provider?: string;
  model?: string;
  providerSource?: string;
  providerPath?: string;
  providerRequestId?: string;
  params?: JsonObject;
  payload?: JsonObject;
  experimentId?: string;
  variantId?: string;
  assignmentNamespace?: string;
  assignmentUnit?: string;
  assignmentTs?: string;
  factorLevels?: Record<string, string>;
};

let supabase: SupabaseClient | null = null;
const logger = createLogger('agents:trace-events');
const TRACE_OPTIONAL_COLUMNS = [
  'sampled',
  'provider',
  'model',
  'provider_source',
  'provider_path',
  'provider_request_id',
] as const;
type TraceOptionalColumn = (typeof TRACE_OPTIONAL_COLUMNS)[number];
const missingTraceColumns = new Set<TraceOptionalColumn>();

const normalizeOptional = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

function getSupabaseClient(): SupabaseClient {
  if (supabase) return supabase;
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRole) {
    throw new Error('Missing Supabase service configuration for trace events');
  }
  supabase = createClient(url, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return supabase;
}

function shouldSample(sampleRate: number): boolean {
  const normalized = Number.isFinite(sampleRate) ? Math.max(0, Math.min(1, sampleRate)) : 1;
  if (normalized >= 1) return true;
  if (normalized <= 0) return false;
  return Math.random() <= normalized;
}

const toSafePayload = (value: unknown): JsonObject | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  try {
    return JSON.parse(JSON.stringify(value)) as JsonObject;
  } catch {
    return undefined;
  }
};

const includeTraceColumn = (column: TraceOptionalColumn): boolean => !missingTraceColumns.has(column);

const buildTraceInsertRow = (
  baseRow: Record<string, unknown>,
  parity: ReturnType<typeof deriveProviderParity>,
): Record<string, unknown> => {
  const row: Record<string, unknown> = { ...baseRow };
  if (includeTraceColumn('sampled')) {
    row.sampled = true;
  }
  if (includeTraceColumn('provider')) {
    row.provider = parity.provider;
  }
  if (includeTraceColumn('model')) {
    row.model = parity.model;
  }
  if (includeTraceColumn('provider_source')) {
    row.provider_source = parity.providerSource;
  }
  if (includeTraceColumn('provider_path')) {
    row.provider_path = parity.providerPath;
  }
  if (includeTraceColumn('provider_request_id')) {
    row.provider_request_id = parity.providerRequestId;
  }
  return row;
};

const learnMissingTraceColumn = (error: unknown): TraceOptionalColumn | null => {
  for (const column of TRACE_OPTIONAL_COLUMNS) {
    if (!isMissingColumnError(error, column)) continue;
    if (!missingTraceColumns.has(column)) {
      missingTraceColumns.add(column);
      logger.warn('trace optional column missing; enabling compatibility mode', { column });
    }
    return column;
  }
  return null;
};

const describeTraceWriteError = (error: unknown): {
  message: string;
  details?: string;
  hint?: string;
  code?: string;
  stack?: string;
  raw?: string;
} => {
  if (error instanceof Error) {
    const typed = error as Error & {
      details?: unknown;
      hint?: unknown;
      code?: unknown;
      cause?: unknown;
    };
    return {
      message: typed.message,
      ...(typeof typed.details === 'string' ? { details: typed.details } : {}),
      ...(typeof typed.hint === 'string' ? { hint: typed.hint } : {}),
      ...(typeof typed.code === 'string' ? { code: typed.code } : {}),
      ...(typeof typed.stack === 'string' ? { stack: typed.stack } : {}),
    };
  }
  const candidate = error as {
    message?: unknown;
    details?: unknown;
    hint?: unknown;
    code?: unknown;
  } | null;
  let raw: string | undefined;
  try {
    raw = JSON.stringify(error);
  } catch {
    raw = String(error);
  }
  return {
    message:
      candidate && typeof candidate.message === 'string'
        ? candidate.message
        : raw ?? 'unknown error',
    ...(candidate && typeof candidate.details === 'string' ? { details: candidate.details } : {}),
    ...(candidate && typeof candidate.hint === 'string' ? { hint: candidate.hint } : {}),
    ...(candidate && typeof candidate.code === 'string' ? { code: candidate.code } : {}),
    ...(raw ? { raw } : {}),
  };
};

export async function recordAgentTraceEvent(input: AgentTraceEventInput): Promise<void> {
  if (!flags.agentTraceLedgerEnabled) return;
  const sampleRate = flags.agentTraceSampleRate;
  const sampled = shouldSample(sampleRate);
  if (!sampled) return;

  try {
    const db = getSupabaseClient();
    const payload = toSafePayload(input.payload);
    const payloadWithExperiment = (() => {
      const hasExperimentFields =
        normalizeOptional(input.experimentId) ||
        normalizeOptional(input.variantId) ||
        normalizeOptional(input.assignmentNamespace) ||
        normalizeOptional(input.assignmentUnit) ||
        normalizeOptional(input.assignmentTs) ||
        (input.factorLevels && Object.keys(input.factorLevels).length > 0);
      if (!hasExperimentFields) return payload;
      const experiment: JsonObject = {
        ...(normalizeOptional(input.experimentId) ? { experimentId: normalizeOptional(input.experimentId)! } : {}),
        ...(normalizeOptional(input.variantId) ? { variantId: normalizeOptional(input.variantId)! } : {}),
        ...(normalizeOptional(input.assignmentNamespace)
          ? { assignmentNamespace: normalizeOptional(input.assignmentNamespace)! }
          : {}),
        ...(normalizeOptional(input.assignmentUnit)
          ? { assignmentUnit: normalizeOptional(input.assignmentUnit)! }
          : {}),
        ...(normalizeOptional(input.assignmentTs) ? { assignmentTs: normalizeOptional(input.assignmentTs)! } : {}),
        ...(input.factorLevels && Object.keys(input.factorLevels).length > 0
          ? { factorLevels: input.factorLevels }
          : {}),
      };
      return {
        ...(payload ?? {}),
        experiment,
      } as JsonObject;
    })();
    const parity = deriveProviderParity({
      provider: input.provider,
      model: input.model,
      providerSource: input.providerSource,
      providerPath: input.providerPath,
      providerRequestId: input.providerRequestId,
      stage: input.stage,
      status: input.status,
      task: input.task,
      params: input.params,
      payload: payloadWithExperiment,
    });
    const baseRow: Record<string, unknown> = {
      id: randomUUID(),
      created_at: new Date().toISOString(),
      trace_id: normalizeOptional(input.traceId) ?? null,
      request_id: normalizeOptional(input.requestId) ?? null,
      intent_id: normalizeOptional(input.intentId) ?? null,
      room: normalizeOptional(input.room) ?? null,
      task_id: normalizeOptional(input.taskId) ?? null,
      attempt: typeof input.attempt === 'number' && Number.isFinite(input.attempt) ? Math.max(0, Math.floor(input.attempt)) : 0,
      task: normalizeOptional(input.task) ?? null,
      component: normalizeOptional(input.component) ?? null,
      stage: input.stage,
      status: normalizeOptional(input.status) ?? null,
      latency_ms: typeof input.latencyMs === 'number' && Number.isFinite(input.latencyMs) ? Math.max(0, Math.floor(input.latencyMs)) : null,
      payload: payloadWithExperiment ?? null,
    };
    let row = buildTraceInsertRow(baseRow, parity);
    let lastInsertError: unknown = null;
    for (let attempt = 0; attempt <= TRACE_OPTIONAL_COLUMNS.length; attempt += 1) {
      const { error } = await db.from('agent_trace_events').insert(row);
      if (!error) {
        return;
      }
      lastInsertError = error;
      const missingColumn = learnMissingTraceColumn(error);
      if (!missingColumn) {
        throw error;
      }
      row = buildTraceInsertRow(baseRow, parity);
    }
    throw lastInsertError ?? new Error('agent_trace_events insert exhausted compatibility retries');
  } catch (error) {
    const described = describeTraceWriteError(error);
    logger.warn('trace write failed', {
      error: described.message,
      ...(described.details ? { details: described.details } : {}),
      ...(described.hint ? { hint: described.hint } : {}),
      ...(described.code ? { code: described.code } : {}),
      ...(described.stack ? { stack: described.stack } : {}),
      ...(described.raw ? { raw: described.raw } : {}),
      stage: input.stage,
    });
  }
}

type TaskTraceInput = {
  stage: AgentTraceStage;
  status?: string;
  traceId?: string;
  requestId?: string;
  intentId?: string;
  taskId?: string;
  attempt?: number;
  room?: string;
  task: string;
  params?: JsonObject;
  latencyMs?: number;
  provider?: string;
  model?: string;
  providerSource?: string;
  providerPath?: string;
  providerRequestId?: string;
  payload?: JsonObject;
  experimentAssignment?: {
    experimentId?: string;
    variantId?: string;
    assignmentNamespace?: string;
    assignmentUnit?: string;
    assignmentTs?: string;
    factorLevels?: Record<string, string>;
  };
};

export async function recordTaskTraceFromParams(input: TaskTraceInput): Promise<void> {
  const correlation = deriveRequestCorrelation({
    task: input.task,
    params: input.params ?? {},
    requestId: input.params?.requestId,
  });
  await recordAgentTraceEvent({
    stage: input.stage,
    status: input.status,
    traceId: normalizeOptional(input.traceId) ?? correlation.traceId,
    requestId: normalizeOptional(input.requestId) ?? correlation.requestId,
    intentId: normalizeOptional(input.intentId) ?? correlation.intentId,
    taskId: input.taskId,
    attempt: input.attempt,
    room: input.room,
    task: input.task,
    provider: input.provider,
    model: input.model,
    providerSource: input.providerSource,
    providerPath: input.providerPath,
    providerRequestId: input.providerRequestId,
    params: input.params,
    latencyMs: input.latencyMs,
    payload: input.payload,
    experimentId: input.experimentAssignment?.experimentId,
    variantId: input.experimentAssignment?.variantId,
    assignmentNamespace: input.experimentAssignment?.assignmentNamespace,
    assignmentUnit: input.experimentAssignment?.assignmentUnit,
    assignmentTs: input.experimentAssignment?.assignmentTs,
    factorLevels: input.experimentAssignment?.factorLevels,
  });
}

type WorkerHeartbeatInput = {
  workerId: string;
  activeTasks: number;
  queueLagMs?: number;
  version?: string;
};

export async function recordWorkerHeartbeat(input: WorkerHeartbeatInput): Promise<void> {
  try {
    const db = getSupabaseClient();
    await db.from('agent_worker_heartbeats').upsert(
      {
        worker_id: input.workerId,
        updated_at: new Date().toISOString(),
        host: os.hostname(),
        pid: String(process.pid),
        version: normalizeOptional(input.version) ?? process.env.npm_package_version ?? null,
        active_tasks: Math.max(0, Math.floor(input.activeTasks)),
        queue_lag_ms:
          typeof input.queueLagMs === 'number' && Number.isFinite(input.queueLagMs)
            ? Math.max(0, Math.floor(input.queueLagMs))
            : 0,
      },
      { onConflict: 'worker_id' },
    );
  } catch (error) {
    logger.warn('worker heartbeat write failed', {
      error: error instanceof Error ? error.message : String(error),
      workerId: input.workerId,
    });
  }
}

type OpsAuditInput = {
  actorUserId: string;
  action: string;
  targetTaskId?: string;
  targetTraceId?: string;
  reason: string;
  beforeStatus?: string;
  afterStatus?: string;
  result?: JsonObject;
};

export async function recordOpsAudit(input: OpsAuditInput): Promise<void> {
  try {
    const db = getSupabaseClient();
    await db.from('agent_ops_audit_log').insert({
      id: randomUUID(),
      created_at: new Date().toISOString(),
      actor_user_id: input.actorUserId,
      action: input.action,
      target_task_id: normalizeOptional(input.targetTaskId) ?? null,
      target_trace_id: normalizeOptional(input.targetTraceId) ?? null,
      reason: input.reason.trim().slice(0, 600),
      before_status: normalizeOptional(input.beforeStatus) ?? null,
      after_status: normalizeOptional(input.afterStatus) ?? null,
      result: toSafePayload(input.result) ?? null,
    });
  } catch (error) {
    logger.warn('ops audit write failed', {
      error: error instanceof Error ? error.message : String(error),
      action: input.action,
    });
  }
}
