import { NextRequest, NextResponse } from 'next/server';
import { requireAgentAdminSignedInUserId } from '@/lib/agents/admin/auth';
import { getAdminSupabaseClient } from '@/lib/agents/admin/supabase-admin';
import {
  isMissingColumnError,
  isMissingRelationError,
} from '@/lib/agents/admin/supabase-errors';
import {
  buildTaskBackedTraceRows,
  extractTaskTraceId,
  type AgentTaskTraceSourceRow,
} from '@/lib/agents/admin/trace-fallback';
import {
  deriveTraceFailureSummary,
  type TraceFailureSummary,
} from '@/lib/agents/admin/trace-diagnostics';
import { recordOpsAudit } from '@/lib/agents/shared/trace-events';

export const runtime = 'nodejs';

type TraceDirection = 'latest' | 'older' | 'newer';

type TraceRow = {
  id: string;
  trace_id: string | null;
  request_id: string | null;
  intent_id: string | null;
  room: string | null;
  task_id: string | null;
  task: string | null;
  stage: string;
  status: string | null;
  latency_ms: number | null;
  created_at: string | null;
  payload: Record<string, unknown> | null;
};

type TaskSnapshot = {
  id: string;
  room: string | null;
  task: string | null;
  status: string | null;
  attempt: number;
  error: string | null;
  request_id: string | null;
  trace_id: string | null;
  created_at: string | null;
  updated_at: string | null;
};

type TranscriptEntry = {
  eventId: string;
  participantId: string;
  participantName: string | null;
  text: string;
  timestamp: number;
  manual: boolean;
};

const TRACE_SELECT_COLUMNS = [
  'id',
  'trace_id',
  'request_id',
  'intent_id',
  'room',
  'task_id',
  'task',
  'stage',
  'status',
  'latency_ms',
  'created_at',
  'payload',
].join(',');

const TASK_SELECT_WITH_TRACE =
  'id,room,task,status,attempt,error,request_id,trace_id,created_at,updated_at,params';
const TASK_SELECT_COMPAT =
  'id,room,task,status,attempt,error,request_id,created_at,updated_at,params';

const parseLimit = (searchParams: URLSearchParams): number => {
  const raw = searchParams.get('limit');
  if (!raw) return 200;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return 200;
  return Math.max(1, Math.min(250, Math.floor(parsed)));
};

const parseDirection = (searchParams: URLSearchParams): TraceDirection => {
  const raw = searchParams.get('direction');
  if (raw === 'older' || raw === 'newer') return raw;
  return 'latest';
};

const parseTs = (searchParams: URLSearchParams, key: 'beforeTs' | 'afterTs'): number | null => {
  const raw = searchParams.get(key);
  if (!raw) return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.floor(parsed);
};

const normalizeTraceId = (value: string): string => value.trim();

const normalizeTaskSnapshot = (value: Record<string, unknown>): TaskSnapshot => ({
  id: String(value.id),
  room: typeof value.room === 'string' ? value.room : null,
  task: typeof value.task === 'string' ? value.task : null,
  status: typeof value.status === 'string' ? value.status : null,
  attempt:
    typeof value.attempt === 'number' && Number.isFinite(value.attempt)
      ? Math.max(0, Math.floor(value.attempt))
      : 0,
  error: typeof value.error === 'string' ? value.error : null,
  request_id: typeof value.request_id === 'string' ? value.request_id : null,
  trace_id: typeof value.trace_id === 'string' ? value.trace_id : null,
  created_at: typeof value.created_at === 'string' ? value.created_at : null,
  updated_at: typeof value.updated_at === 'string' ? value.updated_at : null,
});

const normalizeTraceRows = (rows: TraceRow[]): TraceRow[] =>
  rows.map((row) => ({
    ...row,
    room: typeof row.room === 'string' ? row.room : null,
    request_id: typeof row.request_id === 'string' ? row.request_id : null,
    intent_id: typeof row.intent_id === 'string' ? row.intent_id : null,
    trace_id: typeof row.trace_id === 'string' ? row.trace_id : null,
    task_id: typeof row.task_id === 'string' ? row.task_id : null,
    task: typeof row.task === 'string' ? row.task : null,
    status: typeof row.status === 'string' ? row.status : null,
    created_at: typeof row.created_at === 'string' ? row.created_at : null,
    payload:
      row.payload && typeof row.payload === 'object' && !Array.isArray(row.payload)
        ? row.payload
        : null,
  }));

const findLatestTaskId = (events: TraceRow[]): string | null => {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const taskId = events[index]?.task_id;
    if (typeof taskId === 'string' && taskId.trim().length > 0) {
      return taskId;
    }
  }
  return null;
};

async function loadTraceEvents(
  db: ReturnType<typeof getAdminSupabaseClient>,
  traceId: string,
): Promise<TraceRow[]> {
  const { data, error } = await db
    .from('agent_trace_events')
    .select(TRACE_SELECT_COLUMNS)
    .eq('trace_id', traceId)
    .order('created_at', { ascending: true })
    .limit(2_000);
  if (error && isMissingRelationError(error, 'agent_trace_events')) {
    const { data: fallbackRows, error: fallbackError } = await db
      .from('agent_tasks')
      .select('id,room,task,status,attempt,error,request_id,params,created_at,updated_at')
      .order('updated_at', { ascending: true })
      .limit(2_000);
    if (fallbackError) throw fallbackError;
    const fallbackEvents = buildTaskBackedTraceRows((fallbackRows ?? []) as AgentTaskTraceSourceRow[], {
      order: 'asc',
    }).filter((row) => row.trace_id === traceId);
    return fallbackEvents.map((row) => ({
      id: row.id,
      trace_id: row.trace_id,
      request_id: row.request_id,
      intent_id: row.intent_id,
      room: row.room,
      task_id: row.task_id,
      task: row.task,
      stage: row.stage,
      status: row.status,
      latency_ms: row.latency_ms,
      created_at: row.created_at,
      payload: row.payload,
    }));
  }
  if (error) throw error;
  return normalizeTraceRows((data ?? []) as TraceRow[]);
}

async function loadTaskSnapshot(
  db: ReturnType<typeof getAdminSupabaseClient>,
  traceId: string,
  taskId: string | null,
): Promise<TaskSnapshot | null> {
  if (taskId) {
    const withTrace = await db
      .from('agent_tasks')
      .select(TASK_SELECT_WITH_TRACE)
      .eq('id', taskId)
      .maybeSingle();
    if (withTrace.error && isMissingColumnError(withTrace.error, 'trace_id')) {
      const compat = await db
        .from('agent_tasks')
        .select(TASK_SELECT_COMPAT)
        .eq('id', taskId)
        .maybeSingle();
      if (compat.error) throw compat.error;
      if (!compat.data) return null;
      return normalizeTaskSnapshot({
        ...(compat.data as Record<string, unknown>),
        trace_id: null,
      });
    }
    if (withTrace.error) throw withTrace.error;
    if (!withTrace.data) return null;
    return normalizeTaskSnapshot(withTrace.data as Record<string, unknown>);
  }

  const byTrace = await db
    .from('agent_tasks')
    .select(TASK_SELECT_WITH_TRACE)
    .eq('trace_id', traceId)
    .order('updated_at', { ascending: false })
    .limit(1);

  if (byTrace.error && isMissingColumnError(byTrace.error, 'trace_id')) {
    const compat = await db
      .from('agent_tasks')
      .select(TASK_SELECT_COMPAT)
      .order('updated_at', { ascending: false })
      .limit(2_000);
    if (compat.error) throw compat.error;
    const matched = Array.isArray(compat.data)
      ? compat.data.find((row) => extractTaskTraceId((row as Record<string, unknown>).params) === traceId)
      : null;
    if (!matched) return null;
    return normalizeTaskSnapshot({
      ...(matched as Record<string, unknown>),
      trace_id: null,
    });
  }

  if (byTrace.error) throw byTrace.error;
  const row = Array.isArray(byTrace.data) ? byTrace.data[0] : null;
  if (!row) return null;
  return normalizeTaskSnapshot(row as Record<string, unknown>);
}

async function resolveSessionId(
  db: ReturnType<typeof getAdminSupabaseClient>,
  room: string | null,
): Promise<string | null> {
  if (!room) return null;
  const { data, error } = await db
    .from('canvas_sessions')
    .select('id,updated_at')
    .eq('room_name', room)
    .order('updated_at', { ascending: false })
    .limit(1);
  if (error && isMissingRelationError(error, 'canvas_sessions')) {
    return null;
  }
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : null;
  return row && typeof row.id === 'string' ? row.id : null;
}

async function hasTranscriptRows(
  db: ReturnType<typeof getAdminSupabaseClient>,
  sessionId: string,
  comparator: 'lt' | 'gt',
  ts: number,
): Promise<boolean> {
  let query = db
    .from('canvas_session_transcripts')
    .select('event_id', { count: 'exact', head: true })
    .eq('session_id', sessionId);
  if (comparator === 'lt') {
    query = query.lt('ts', ts);
  } else {
    query = query.gt('ts', ts);
  }
  const { count, error } = await query;
  if (error && isMissingRelationError(error, 'canvas_session_transcripts')) {
    return false;
  }
  if (error) throw error;
  return (count ?? 0) > 0;
}

async function loadTranscriptPage(
  db: ReturnType<typeof getAdminSupabaseClient>,
  options: {
    room: string | null;
    sessionId: string | null;
    limit: number;
    direction: TraceDirection;
    beforeTs: number | null;
    afterTs: number | null;
  },
) {
  const empty = {
    room: options.room,
    sessionId: options.sessionId,
    direction: options.direction,
    entries: [] as TranscriptEntry[],
    hasOlder: false,
    hasNewer: false,
    beforeTs: null as number | null,
    afterTs: null as number | null,
    nextBeforeTs: null as number | null,
    nextAfterTs: null as number | null,
  };
  if (!options.sessionId) return empty;

  const queryLimit = options.limit + 1;
  const isNewerMode = options.direction === 'newer' || options.afterTs !== null;

  let query = db
    .from('canvas_session_transcripts')
    .select('event_id,participant_id,participant_name,text,ts,manual')
    .eq('session_id', options.sessionId);

  if (isNewerMode && options.afterTs !== null) {
    query = query.gt('ts', options.afterTs);
  } else if (options.beforeTs !== null) {
    query = query.lt('ts', options.beforeTs);
  }

  query = query.order('ts', { ascending: isNewerMode }).limit(queryLimit);
  const { data, error } = await query;
  if (error && isMissingRelationError(error, 'canvas_session_transcripts')) {
    return empty;
  }
  if (error) throw error;

  const rows = Array.isArray(data) ? data : [];
  const limitedRows = rows.slice(0, options.limit);
  const hasDirectionalMore = rows.length > options.limit;
  const ascendingRows = isNewerMode ? limitedRows : [...limitedRows].reverse();
  const entries = ascendingRows
    .filter((row) => typeof row.event_id === 'string' && typeof row.ts === 'number')
    .map((row) => ({
      eventId: row.event_id as string,
      participantId: typeof row.participant_id === 'string' ? row.participant_id : 'unknown',
      participantName: typeof row.participant_name === 'string' ? row.participant_name : null,
      text: typeof row.text === 'string' ? row.text : '',
      timestamp: Number(row.ts),
      manual: Boolean(row.manual),
    }));

  if (entries.length === 0) {
    return empty;
  }

  const oldestTs = entries[0]?.timestamp ?? null;
  const newestTs = entries[entries.length - 1]?.timestamp ?? null;
  const hasOlder =
    oldestTs === null
      ? false
      : isNewerMode
        ? await hasTranscriptRows(db, options.sessionId, 'lt', oldestTs)
        : hasDirectionalMore || (await hasTranscriptRows(db, options.sessionId, 'lt', oldestTs));
  const hasNewer =
    newestTs === null
      ? false
      : isNewerMode
        ? hasDirectionalMore || (await hasTranscriptRows(db, options.sessionId, 'gt', newestTs))
        : await hasTranscriptRows(db, options.sessionId, 'gt', newestTs);

  return {
    room: options.room,
    sessionId: options.sessionId,
    direction: options.direction,
    entries,
    hasOlder,
    hasNewer,
    beforeTs: oldestTs,
    afterTs: newestTs,
    nextBeforeTs: hasOlder ? oldestTs : null,
    nextAfterTs: hasNewer ? newestTs : null,
  };
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ traceId: string }> },
) {
  const admin = await requireAgentAdminSignedInUserId(req);
  if (!admin.ok) {
    return NextResponse.json({ error: admin.error }, { status: admin.status });
  }

  const { traceId } = await params;
  const normalizedTraceId = normalizeTraceId(traceId);
  if (!normalizedTraceId) {
    return NextResponse.json({ error: 'traceId required' }, { status: 400 });
  }

  const limit = parseLimit(req.nextUrl.searchParams);
  const direction = parseDirection(req.nextUrl.searchParams);
  const beforeTs = parseTs(req.nextUrl.searchParams, 'beforeTs');
  const afterTs = parseTs(req.nextUrl.searchParams, 'afterTs');

  try {
    const db = getAdminSupabaseClient();
    const events = await loadTraceEvents(db, normalizedTraceId);
    const latestTaskId = findLatestTaskId(events);
    const taskSnapshot = await loadTaskSnapshot(db, normalizedTraceId, latestTaskId);

    const failure: TraceFailureSummary | null = deriveTraceFailureSummary(events, {
      status: taskSnapshot?.status ?? null,
      error: taskSnapshot?.error ?? null,
      created_at: taskSnapshot?.updated_at ?? taskSnapshot?.created_at ?? null,
      trace_id: taskSnapshot?.trace_id ?? normalizedTraceId,
      request_id: taskSnapshot?.request_id ?? null,
      task_id: taskSnapshot?.id ?? latestTaskId,
      task: taskSnapshot?.task ?? null,
    });

    const room =
      taskSnapshot?.room ??
      [...events]
        .reverse()
        .find((event) => typeof event.room === 'string' && event.room.trim().length > 0)
        ?.room ??
      null;
    const sessionId = await resolveSessionId(db, room);
    const transcriptPage = await loadTranscriptPage(db, {
      room,
      sessionId,
      limit,
      direction,
      beforeTs,
      afterTs,
    });

    void recordOpsAudit({
      actorUserId: admin.userId,
      action: 'read_trace_context',
      targetTaskId: taskSnapshot?.id ?? undefined,
      targetTraceId: normalizedTraceId,
      reason: 'view trace context',
      beforeStatus: taskSnapshot?.status ?? undefined,
      afterStatus: taskSnapshot?.status ?? undefined,
      result: {
        direction,
        beforeTs: beforeTs ?? null,
        afterTs: afterTs ?? null,
      },
    });

    return NextResponse.json({
      ok: true,
      actorUserId: admin.userId,
      traceId: normalizedTraceId,
      failure,
      taskSnapshot,
      transcriptPage,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'failed to load trace context' },
      { status: 500 },
    );
  }
}
