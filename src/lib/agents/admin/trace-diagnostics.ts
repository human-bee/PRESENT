import {
  buildProviderLinkUrl,
  deriveProviderParity,
  type AgentProvider,
  type AgentProviderPath,
  type AgentProviderSource,
} from './provider-parity';

type JsonRecord = Record<string, unknown>;

export type AgentTraceSubsystem = 'api' | 'queue' | 'worker' | 'router' | 'client-ack' | 'unknown';

type EventLike = {
  stage?: string | null;
  status?: string | null;
  created_at?: string | null;
  payload?: unknown;
  params?: unknown;
  provider?: unknown;
  model?: unknown;
  provider_source?: unknown;
  provider_path?: unknown;
  provider_request_id?: unknown;
  request_id?: string | null;
  intent_id?: string | null;
  trace_id?: string | null;
  task_id?: string | null;
  task?: string | null;
  room?: string | null;
};

type FallbackTaskState = {
  status?: string | null;
  error?: string | null;
  created_at?: string | null;
  trace_id?: string | null;
  request_id?: string | null;
  task_id?: string | null;
  task?: string | null;
  room?: string | null;
  params?: unknown;
  provider?: unknown;
  model?: unknown;
  provider_source?: unknown;
  provider_path?: unknown;
  provider_request_id?: unknown;
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
  provider: AgentProvider;
  model: string | null;
  provider_source: AgentProviderSource;
  provider_path: AgentProviderPath;
  provider_request_id: string | null;
  provider_context_url: string | null;
};

export type TraceWorkerIdentity = {
  workerId: string | null;
  workerHost: string | null;
  workerPid: string | null;
};

export type TraceProviderIdentity = {
  provider: AgentProvider;
  model: string | null;
  providerSource: AgentProviderSource;
  providerPath: AgentProviderPath;
  providerRequestId: string | null;
  providerContextUrl: string | null;
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

const hasSuccessSignal = (event: EventLike): boolean => {
  const stage = normalizeString(event.stage)?.toLowerCase();
  const status = normalizeString(event.status)?.toLowerCase();
  if (stage === 'completed') return true;
  if (status === 'completed' || status === 'succeeded' || status === 'ok') return true;
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

export const extractProviderIdentity = (event: EventLike): TraceProviderIdentity => {
  const parity = deriveProviderParity({
    provider: event.provider,
    model: event.model,
    providerSource: event.provider_source,
    providerPath: event.provider_path,
    providerRequestId: event.provider_request_id,
    stage: event.stage,
    status: event.status,
    task: event.task,
    params: event.params,
    payload: event.payload,
  });
  const providerContextUrl = buildProviderLinkUrl(parity.provider, {
    traceId: normalizeString(event.trace_id),
    requestId: normalizeString(event.request_id),
    providerRequestId: parity.providerRequestId,
    model: parity.model,
    room: normalizeString(event.room),
    taskId: normalizeString(event.task_id),
  });
  return {
    provider: parity.provider,
    model: parity.model,
    providerSource: parity.providerSource,
    providerPath: parity.providerPath,
    providerRequestId: parity.providerRequestId,
    providerContextUrl,
  };
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
  const latestSuccessEvent = sorted.find((event) => hasSuccessSignal(event));
  const latestSuccessMillis = latestSuccessEvent ? toMillis(latestSuccessEvent.created_at) : Number.NEGATIVE_INFINITY;
  const failingEvent = sorted.find((event) => {
    if (!hasFailureSignal(event)) return false;
    if (!latestSuccessEvent) return true;
    return toMillis(event.created_at) > latestSuccessMillis;
  });

  if (failingEvent) {
    const stage = normalizeString(failingEvent.stage);
    const status = normalizeString(failingEvent.status) ?? 'failed';
    const worker = extractWorkerIdentity(failingEvent.payload);
    const provider = extractProviderIdentity(failingEvent);
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
      provider: provider.provider,
      model: provider.model,
      provider_source: provider.providerSource,
      provider_path: provider.providerPath,
      provider_request_id: provider.providerRequestId,
      provider_context_url: provider.providerContextUrl,
    };
  }

  const fallbackStatus = normalizeString(fallbackTaskState?.status)?.toLowerCase();
  const fallbackError = normalizeString(fallbackTaskState?.error);
  const isFallbackFailureStatus =
    fallbackStatus === 'failed' ||
    fallbackStatus === 'error' ||
    fallbackStatus === 'fallback_error' ||
    fallbackStatus === 'queue_error' ||
    fallbackStatus === 'canceled';
  const hasNoTerminalFallbackStatus = !fallbackStatus;
  if (isFallbackFailureStatus || (hasNoTerminalFallbackStatus && fallbackError)) {
    const provider = extractProviderIdentity({
      stage: 'task_status_fallback',
      status: fallbackStatus,
      payload: { error: fallbackError },
      params: fallbackTaskState?.params,
      provider: fallbackTaskState?.provider,
      model: fallbackTaskState?.model,
      provider_source: fallbackTaskState?.provider_source,
      provider_path: fallbackTaskState?.provider_path,
      provider_request_id: fallbackTaskState?.provider_request_id,
      request_id: fallbackTaskState?.request_id,
      trace_id: fallbackTaskState?.trace_id,
      task_id: fallbackTaskState?.task_id,
      task: fallbackTaskState?.task,
      room: fallbackTaskState?.room,
    });
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
      provider: provider.provider,
      model: provider.model,
      provider_source: provider.providerSource,
      provider_path: provider.providerPath,
      provider_request_id: provider.providerRequestId,
      provider_context_url: provider.providerContextUrl,
    };
  }

  return null;
};
