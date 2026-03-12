import { NextRequest, NextResponse } from 'next/server';
import { requireAgentAdminSignedInUserId } from '@/lib/agents/admin/auth';
import { getAdminSupabaseClient } from '@/lib/agents/admin/supabase-admin';
import { isMissingRelationError } from '@/lib/agents/admin/supabase-errors';

export const runtime = 'nodejs';

const START_EVENT = 'session_started';
const CLOSE_EVENT = 'session_close';
const MAX_LIMIT = 100;

const readOptional = (searchParams: URLSearchParams, key: string): string | undefined => {
  const value = searchParams.get(key);
  if (!value) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const parseLimit = (searchParams: URLSearchParams): number => {
  const raw = searchParams.get('limit');
  if (!raw) return 25;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return 25;
  return Math.max(1, Math.min(MAX_LIMIT, Math.floor(parsed)));
};

const asRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
};

const readText = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const readInteger = (value: unknown): number | null => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.floor(value);
};

const readTimestamp = (value: unknown): number | null => {
  const text = readText(value);
  if (!text) return null;
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : null;
};

const firstText = (...values: unknown[]): string | null => {
  for (const value of values) {
    const text = readText(value);
    if (text) return text;
  }
  return null;
};

const firstInteger = (...values: unknown[]): number | null => {
  for (const value of values) {
    const num = readInteger(value);
    if (num !== null) return num;
  }
  return null;
};

const pickLatestRow = (...rows: Array<RowRecord | null | undefined>): RowRecord | null => {
  let latest: RowRecord | null = null;
  let latestTs = Number.NEGATIVE_INFINITY;
  for (const row of rows) {
    if (!row) continue;
    const ts = readTimestamp(row.created_at);
    if (ts === null) {
      if (!latest) latest = row;
      continue;
    }
    if (ts >= latestTs) {
      latest = row;
      latestTs = ts;
    }
  }
  return latest;
};

const MODEL_SELECT_COLUMNS = [
  'session_id',
  'room',
  'trace_id',
  'request_id',
  'intent_id',
  'created_at',
  'event_type',
  'status',
  'provider',
  'model',
  'provider_source',
  'provider_path',
  'provider_request_id',
  'context_priming',
  'metadata',
  'output_payload',
  'error',
].join(',');

const TOOL_SELECT_COLUMNS = [
  'session_id',
  'trace_id',
  'request_id',
  'intent_id',
  'created_at',
  'event_type',
  'status',
  'tool_name',
  'tool_call_id',
  'provider_request_id',
].join(',');

type RowRecord = Record<string, unknown>;

export async function GET(req: NextRequest) {
  const admin = await requireAgentAdminSignedInUserId(req);
  if (!admin.ok) {
    return NextResponse.json({ error: admin.error }, { status: admin.status });
  }

  const searchParams = req.nextUrl.searchParams;
  const room = readOptional(searchParams, 'room');
  const provider = readOptional(searchParams, 'provider');
  const providerPath = readOptional(searchParams, 'providerPath');
  const traceId = readOptional(searchParams, 'traceId');
  const limit = parseLimit(searchParams);
  const scanLimit = traceId ? Math.max(limit, Math.min(500, limit * 10)) : limit;

  try {
    const db = getAdminSupabaseClient();
    let traceToolIoAvailable = true;
    let traceSessionIds: string[] | null = null;
    if (traceId) {
      const sessionIdSet = new Set<string>();
      const { data: traceModelRowsRaw, error: traceModelError } = await db
        .from('agent_model_io')
        .select('session_id')
        .eq('source', 'voice_agent')
        .eq('trace_id', traceId)
        .order('created_at', { ascending: false })
        .limit(200);
      if (traceModelError && isMissingRelationError(traceModelError, 'agent_model_io')) {
        return NextResponse.json({
          ok: true,
          actorUserId: admin.userId,
          available: false,
          toolIoAvailable: false,
          sessions: [],
        });
      }
      if (traceModelError) throw traceModelError;
      for (const row of (traceModelRowsRaw ?? []) as RowRecord[]) {
        const sessionId = readText(row.session_id);
        if (sessionId) sessionIdSet.add(sessionId);
      }

      const { data: traceToolRowsRaw, error: traceToolError } = await db
        .from('agent_tool_io')
        .select('session_id')
        .eq('source', 'voice_agent')
        .eq('trace_id', traceId)
        .order('created_at', { ascending: false })
        .limit(200);
      if (traceToolError && isMissingRelationError(traceToolError, 'agent_tool_io')) {
        traceToolIoAvailable = false;
      } else if (traceToolError) {
        throw traceToolError;
      }
      for (const row of ((traceToolRowsRaw ?? []) as RowRecord[])) {
        const sessionId = readText(row.session_id);
        if (sessionId) sessionIdSet.add(sessionId);
      }

      traceSessionIds = Array.from(sessionIdSet);
      if (traceSessionIds.length === 0) {
        return NextResponse.json({
          ok: true,
          actorUserId: admin.userId,
          available: true,
          toolIoAvailable: traceToolIoAvailable,
          sessions: [],
        });
      }
    }

    let startedQuery = db
      .from('agent_model_io')
      .select(MODEL_SELECT_COLUMNS)
      .eq('source', 'voice_agent')
      .eq('event_type', START_EVENT)
      .order('created_at', { ascending: false });
    if (room) startedQuery = startedQuery.eq('room', room);
    if (provider) startedQuery = startedQuery.eq('provider', provider);
    if (providerPath) startedQuery = startedQuery.eq('provider_path', providerPath);
    if (traceSessionIds) {
      startedQuery = startedQuery.in('session_id', traceSessionIds);
    } else {
      startedQuery = startedQuery.limit(scanLimit);
    }

    const { data: startedRowsRaw, error: startedError } = await startedQuery;
    if (startedError && isMissingRelationError(startedError, 'agent_model_io')) {
      return NextResponse.json({
        ok: true,
        actorUserId: admin.userId,
        available: false,
        toolIoAvailable: false,
        sessions: [],
      });
    }
    if (startedError) throw startedError;

    const startedRows = ((startedRowsRaw ?? []) as RowRecord[]).filter(
      (row) => readText(row.session_id) !== null,
    );
    const sessionIds = Array.from(
      new Set(startedRows.map((row) => readText(row.session_id)).filter((value): value is string => Boolean(value))),
    );

    if (sessionIds.length === 0) {
      return NextResponse.json({
        ok: true,
        actorUserId: admin.userId,
        available: true,
        toolIoAvailable: true,
        sessions: [],
      });
    }

    let modelEventsQuery = db
      .from('agent_model_io')
      .select(MODEL_SELECT_COLUMNS)
      .eq('source', 'voice_agent')
      .in('session_id', sessionIds)
      .order('created_at', { ascending: false });
    if (room) modelEventsQuery = modelEventsQuery.eq('room', room);

    const { data: modelEventsRaw, error: modelEventsError } = await modelEventsQuery;
    if (modelEventsError) throw modelEventsError;

    let toolIoAvailable = traceToolIoAvailable;
    let toolEvents: RowRecord[] = [];
    let toolEventsQuery = db
      .from('agent_tool_io')
      .select(TOOL_SELECT_COLUMNS)
      .eq('source', 'voice_agent')
      .in('session_id', sessionIds)
      .order('created_at', { ascending: false });
    if (room) toolEventsQuery = toolEventsQuery.eq('room', room);

    const { data: toolEventsRaw, error: toolEventsError } = await toolEventsQuery;
    if (toolEventsError && isMissingRelationError(toolEventsError, 'agent_tool_io')) {
      toolIoAvailable = false;
    } else if (toolEventsError) {
      throw toolEventsError;
    } else {
      toolEvents = (toolEventsRaw ?? []) as RowRecord[];
    }

    const modelEventsBySession = new Map<string, RowRecord[]>();
    for (const row of (modelEventsRaw ?? []) as RowRecord[]) {
      const sessionId = readText(row.session_id);
      if (!sessionId) continue;
      const current = modelEventsBySession.get(sessionId);
      if (current) {
        current.push(row);
      } else {
        modelEventsBySession.set(sessionId, [row]);
      }
    }

    const toolEventsBySession = new Map<string, RowRecord[]>();
    for (const row of toolEvents) {
      const sessionId = readText(row.session_id);
      if (!sessionId) continue;
      const current = toolEventsBySession.get(sessionId);
      if (current) {
        current.push(row);
      } else {
        toolEventsBySession.set(sessionId, [row]);
      }
    }

    const sessions = startedRows.map((startRow) => {
      const sessionId = readText(startRow.session_id) as string;
      const modelRows = modelEventsBySession.get(sessionId) ?? [startRow];
      const toolRows = toolEventsBySession.get(sessionId) ?? [];
      const latestModelRow = modelRows[0] ?? startRow;
      const latestToolRow = toolRows[0] ?? null;
      const latestEventRow = pickLatestRow(latestModelRow, latestToolRow);
      const closeRow =
        modelRows.find((row) => readText(row.event_type) === CLOSE_EVENT) ?? null;
      const startMetadata = asRecord(startRow.metadata);
      const modelControl = asRecord(startMetadata?.modelControl);
      const fieldSource = asRecord(modelControl?.fieldSource);
      const closeOutput = asRecord(closeRow?.output_payload);
      const uniqueToolCalls = new Set(
        toolRows.map((row) => readText(row.tool_call_id)).filter((value): value is string => Boolean(value)),
      );
      const closeReason = firstText(closeOutput?.reason, closeRow?.status);
      const closeCode = firstInteger(closeOutput?.code);
      const closeError = firstText(closeRow?.error);
      const status = closeError
        ? 'error'
        : closeRow
          ? 'closed'
          : firstText(latestModelRow.status) === 'error'
            ? 'error'
            : 'running';

      return {
        session_id: sessionId,
        room: firstText(startRow.room, latestModelRow.room),
        status,
        started_at: firstText(startRow.created_at),
        closed_at: firstText(closeRow?.created_at),
        last_activity_at: firstText(latestEventRow?.created_at),
        provider: firstText(startRow.provider, latestModelRow.provider) ?? 'unknown',
        model: firstText(startRow.model, latestModelRow.model),
        provider_source:
          firstText(startRow.provider_source, latestModelRow.provider_source) ?? 'unknown',
        provider_path:
          firstText(startRow.provider_path, latestModelRow.provider_path) ?? 'unknown',
        provider_request_id: firstText(
          latestEventRow?.provider_request_id,
          closeRow?.provider_request_id,
          latestToolRow?.provider_request_id,
          latestModelRow.provider_request_id,
        ),
        trace_id: firstText(
          latestEventRow?.trace_id,
          closeRow?.trace_id,
          latestToolRow?.trace_id,
          latestModelRow.trace_id,
          startRow.trace_id,
        ),
        request_id: firstText(
          latestEventRow?.request_id,
          closeRow?.request_id,
          latestToolRow?.request_id,
          latestModelRow.request_id,
          startRow.request_id,
        ),
        intent_id: firstText(
          latestEventRow?.intent_id,
          closeRow?.intent_id,
          latestToolRow?.intent_id,
          latestModelRow.intent_id,
          startRow.intent_id,
        ),
        event_count: modelRows.length,
        tool_event_count: toolRows.length,
        tool_call_count: uniqueToolCalls.size > 0 ? uniqueToolCalls.size : toolRows.length,
        last_tool_name: firstText(latestToolRow?.tool_name),
        config_version: firstText(modelControl?.configVersion),
        control_scope: firstText(fieldSource?.scope),
        control_scope_id: firstText(fieldSource?.scopeId),
        control_profile_id: firstText(fieldSource?.profileId),
        worker_id: firstText(startMetadata?.workerId),
        participant_identity: firstText(startMetadata?.participantIdentity),
        close_reason: closeReason,
        close_code: closeCode,
        close_error: closeError,
      };
    });

    const filteredSessions = sessions
      .filter((session) => {
        if (!traceId) return true;
        const modelRows = modelEventsBySession.get(session.session_id) ?? [];
        const toolRows = toolEventsBySession.get(session.session_id) ?? [];
        return [...modelRows, ...toolRows].some((row) => readText(row.trace_id) === traceId);
      })
      .slice(0, limit);

    return NextResponse.json({
      ok: true,
      actorUserId: admin.userId,
      available: true,
      toolIoAvailable,
      sessions: filteredSessions,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'failed to load voice sessions' },
      { status: 500 },
    );
  }
}
