type JsonRecord = Record<string, unknown>;

export type AgentTaskTraceSourceRow = {
  id: string;
  room?: string | null;
  task?: string | null;
  status?: string | null;
  attempt?: number | null;
  error?: string | null;
  request_id?: string | null;
  params?: JsonRecord | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type AgentTraceFallbackRow = {
  id: string;
  trace_id: string | null;
  request_id: string | null;
  intent_id: string | null;
  room: string | null;
  task_id: string;
  task: string | null;
  stage: string;
  status: string | null;
  latency_ms: null;
  created_at: string | null;
  payload: JsonRecord;
};

const normalizeString = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const asRecord = (value: unknown): JsonRecord | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as JsonRecord;
};

const readString = (record: JsonRecord | null, key: string): string | null => {
  if (!record) return null;
  return normalizeString(record[key]);
};

const readNestedString = (record: JsonRecord | null, key: string): string | null => {
  const nested = asRecord(record?.metadata);
  return readString(nested, key);
};

const statusToStage = (status: string | null): string => {
  switch (status) {
    case 'queued':
      return 'queued';
    case 'running':
      return 'executing';
    case 'failed':
      return 'failed';
    case 'succeeded':
      return 'completed';
    case 'canceled':
      return 'canceled';
    default:
      return status ?? 'queued';
  }
};

const compareCreatedAtDesc = (left: AgentTraceFallbackRow, right: AgentTraceFallbackRow): number => {
  const leftTs = left.created_at ? Date.parse(left.created_at) : Number.NEGATIVE_INFINITY;
  const rightTs = right.created_at ? Date.parse(right.created_at) : Number.NEGATIVE_INFINITY;
  if (leftTs === rightTs) return right.id.localeCompare(left.id);
  return rightTs - leftTs;
};

const compareCreatedAtAsc = (left: AgentTraceFallbackRow, right: AgentTraceFallbackRow): number => {
  const leftTs = left.created_at ? Date.parse(left.created_at) : Number.POSITIVE_INFINITY;
  const rightTs = right.created_at ? Date.parse(right.created_at) : Number.POSITIVE_INFINITY;
  if (leftTs === rightTs) return left.id.localeCompare(right.id);
  return leftTs - rightTs;
};

export const extractTaskTraceId = (params: unknown): string | null => {
  const record = asRecord(params);
  return (
    readString(record, 'trace_id') ??
    readString(record, 'traceId') ??
    readNestedString(record, 'trace_id') ??
    readNestedString(record, 'traceId')
  );
};

const extractTaskIntentId = (params: unknown): string | null => {
  const record = asRecord(params);
  return (
    readString(record, 'intent_id') ??
    readString(record, 'intentId') ??
    readNestedString(record, 'intent_id') ??
    readNestedString(record, 'intentId')
  );
};

const extractTaskRequestId = (params: unknown): string | null => {
  const record = asRecord(params);
  return (
    readString(record, 'request_id') ??
    readString(record, 'requestId') ??
    readNestedString(record, 'request_id') ??
    readNestedString(record, 'requestId')
  );
};

export const buildTaskBackedTraceRows = (
  rows: AgentTaskTraceSourceRow[],
  options?: { order?: 'asc' | 'desc' },
): AgentTraceFallbackRow[] => {
  const traces = rows.map((row) => {
    const traceId = extractTaskTraceId(row.params);
    const intentId = extractTaskIntentId(row.params);
    const requestId = normalizeString(row.request_id) ?? extractTaskRequestId(row.params);
    const status = normalizeString(row.status);
    const stage = statusToStage(status);
    const createdAt = normalizeString(row.updated_at) ?? normalizeString(row.created_at);
    const attempt = typeof row.attempt === 'number' && Number.isFinite(row.attempt) ? Math.max(0, Math.floor(row.attempt)) : 0;

    return {
      id: `${row.id}:${createdAt ?? 'na'}:${stage}`,
      trace_id: traceId,
      request_id: requestId,
      intent_id: intentId,
      room: normalizeString(row.room),
      task_id: row.id,
      task: normalizeString(row.task),
      stage,
      status,
      latency_ms: null,
      created_at: createdAt,
      payload: {
        source: 'agent_tasks_fallback',
        attempt,
        error: normalizeString(row.error),
      },
    };
  });

  traces.sort(options?.order === 'asc' ? compareCreatedAtAsc : compareCreatedAtDesc);
  return traces;
};

