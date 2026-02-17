type JsonRecord = Record<string, unknown>;

export type AgentTraceSubsystem = 'api' | 'queue' | 'worker' | 'router' | 'client-ack' | 'unknown';

type EventLike = {
  stage?: string | null;
  status?: string | null;
  created_at?: string | null;
  payload?: unknown;
  request_id?: string | null;
  intent_id?: string | null;
  trace_id?: string | null;
  task_id?: string | null;
  task?: string | null;
};

type FallbackTaskState = {
  status?: string | null;
  error?: string | null;
  created_at?: string | null;
  trace_id?: string | null;
  request_id?: string | null;
  task_id?: string | null;
  task?: string | null;
};

export type TraceFailureSummary = {
  status: string;
  stage: string | null;
  subsystem: AgentTraceSubsystem;
  reason: string | null;
  created_at: string | null;
  trace_id: string | null;
  request_id: string | null;
  intent_id: string | null;
  task_id: string | null;
  task: string | null;
  worker_id: string | null;
};

export type TraceWorkerIdentity = {
  workerId: string | null;
  workerHost: string | null;
  workerPid: string | null;
};

const STAGE_TO_SUBSYSTEM: Record<string, AgentTraceSubsystem> = {
  api_received: 'api',
  queued: 'queue',
  deduped: 'queue',
  claimed: 'queue',
  executing: 'worker',
  completed: 'worker',
  failed: 'worker',
  canceled: 'worker',
  routed: 'router',
  actions_dispatched: 'router',
  ack_received: 'client-ack',
  fallback: 'router',
};

const asRecord = (value: unknown): JsonRecord | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as JsonRecord;
};

const normalizeString = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const hasFailureSignal = (event: EventLike): boolean => {
  const stage = normalizeString(event.stage)?.toLowerCase();
  const status = normalizeString(event.status)?.toLowerCase();
  if (stage === 'failed') return true;
  if (status === 'failed') return true;
  if (status === 'error' || status === 'fallback_error' || status === 'queue_error') return true;
  return false;
};

const toMillis = (value: string | null | undefined): number => {
  if (!value) return Number.NEGATIVE_INFINITY;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
};

export const classifyTraceSubsystem = (stage: string | null | undefined): AgentTraceSubsystem => {
  const normalized = normalizeString(stage)?.toLowerCase();
  if (!normalized) return 'unknown';
  return STAGE_TO_SUBSYSTEM[normalized] ?? 'unknown';
};

const extractNestedReason = (payload: JsonRecord | null, key: string): string | null => {
  if (!payload) return null;
  const candidate = payload[key];
  const asText = normalizeString(candidate);
  if (asText) return asText;
  const nested = asRecord(candidate);
  if (!nested) return null;
  return (
    normalizeString(nested.message) ??
    normalizeString(nested.reason) ??
    normalizeString(nested.error) ??
    null
  );
};

export const extractFailureReason = (
  payload: unknown,
  fallbackError?: string | null,
): string | null => {
  const record = asRecord(payload);
  return (
    extractNestedReason(record, 'error') ??
    extractNestedReason(record, 'reason') ??
    extractNestedReason(record, 'message') ??
    extractNestedReason(record, 'detail') ??
    normalizeString(fallbackError) ??
    null
  );
};

export const extractWorkerIdentity = (payload: unknown): TraceWorkerIdentity => {
  const record = asRecord(payload);
  const workerId =
    normalizeString(record?.worker_id) ??
    normalizeString(record?.workerId) ??
    null;
  const workerHost =
    normalizeString(record?.worker_host) ??
    normalizeString(record?.workerHost) ??
    normalizeString(record?.host) ??
    null;
  const workerPid =
    normalizeString(record?.worker_pid) ??
    normalizeString(record?.workerPid) ??
    normalizeString(record?.pid) ??
    null;
  return { workerId, workerHost, workerPid };
};

export const deriveTraceFailureSummary = (
  events: EventLike[],
  fallbackTaskState?: FallbackTaskState,
): TraceFailureSummary | null => {
  const sorted = [...events].sort((left, right) => {
    const delta = toMillis(right.created_at) - toMillis(left.created_at);
    if (delta !== 0) return delta;
    return 0;
  });
  const failingEvent = sorted.find((event) => hasFailureSignal(event));

  if (failingEvent) {
    const stage = normalizeString(failingEvent.stage);
    const status = normalizeString(failingEvent.status) ?? 'failed';
    const worker = extractWorkerIdentity(failingEvent.payload);
    return {
      status,
      stage,
      subsystem: classifyTraceSubsystem(stage),
      reason: extractFailureReason(failingEvent.payload),
      created_at: normalizeString(failingEvent.created_at),
      trace_id: normalizeString(failingEvent.trace_id),
      request_id: normalizeString(failingEvent.request_id),
      intent_id: normalizeString(failingEvent.intent_id),
      task_id: normalizeString(failingEvent.task_id),
      task: normalizeString(failingEvent.task),
      worker_id: worker.workerId,
    };
  }

  const fallbackStatus = normalizeString(fallbackTaskState?.status)?.toLowerCase();
  const fallbackError = normalizeString(fallbackTaskState?.error);
  if (fallbackStatus === 'failed' || fallbackError) {
    return {
      status: fallbackStatus ?? 'failed',
      stage: 'task_status_fallback',
      subsystem: 'worker',
      reason: fallbackError,
      created_at: normalizeString(fallbackTaskState?.created_at),
      trace_id: normalizeString(fallbackTaskState?.trace_id),
      request_id: normalizeString(fallbackTaskState?.request_id),
      intent_id: null,
      task_id: normalizeString(fallbackTaskState?.task_id),
      task: normalizeString(fallbackTaskState?.task),
      worker_id: null,
    };
  }

  return null;
};
