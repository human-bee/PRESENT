import { NextRequest, NextResponse } from 'next/server';
import {
  isAgentAdminDetailGlobalScopeEnabled,
  isAgentAdminDetailMaskDefaultEnabled,
  requireAgentAdminUserId,
} from '@/lib/agents/admin/auth';
import { getAdminSupabaseClient } from '@/lib/agents/admin/supabase-admin';
import { isMissingRelationError } from '@/lib/agents/admin/supabase-errors';

export const runtime = 'nodejs';

const PROVIDERS = [
  'openai',
  'anthropic',
  'google',
  'cerebras',
  'together',
  'debug',
  'unknown',
] as const;

const FAILURE_STATUSES = ['failed', 'error', 'fallback_error', 'queue_error'];

const initProviderCounts = () =>
  Object.fromEntries(PROVIDERS.map((provider) => [provider, 0])) as Record<
    (typeof PROVIDERS)[number],
    number
  >;

const KNOWN_PROVIDERS = PROVIDERS.filter((provider) => provider !== 'unknown');

export async function GET(req: NextRequest) {
  const admin = await requireAgentAdminUserId(req);
  if (!admin.ok) {
    return NextResponse.json({ error: admin.error }, { status: admin.status });
  }

  try {
    const db = getAdminSupabaseClient();
    const sinceIso = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const queueStatuses = ['queued', 'running', 'failed', 'succeeded', 'canceled'] as const;

    const statusCounts: Record<string, number> = {};
    for (const status of queueStatuses) {
      const { count, error } = await db
        .from('agent_tasks')
        .select('id', { count: 'exact', head: true })
        .eq('status', status);
      if (error) throw error;
      statusCounts[status] = count ?? 0;
    }

    const { data: oldestQueuedRows, error: oldestQueuedError } = await db
      .from('agent_tasks')
      .select('created_at')
      .eq('status', 'queued')
      .order('created_at', { ascending: true })
      .limit(1);
    if (oldestQueuedError) throw oldestQueuedError;
    const oldestQueuedAt =
      Array.isArray(oldestQueuedRows) &&
      oldestQueuedRows.length > 0 &&
      typeof oldestQueuedRows[0]?.created_at === 'string'
        ? oldestQueuedRows[0].created_at
        : null;
    const oldestQueuedAgeMs = oldestQueuedAt
      ? Math.max(0, Date.now() - new Date(oldestQueuedAt).getTime())
      : null;

    const { count: recentTraceCount, error: traceCountError } = await db
      .from('agent_trace_events')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', sinceIso);
    let tracesLastHour = recentTraceCount ?? 0;
    let failedTracesLastHour = 0;
    const providerMix = initProviderCounts();
    const providerFailures = initProviderCounts();
    if (traceCountError && isMissingRelationError(traceCountError, 'agent_trace_events')) {
      const { count: fallbackTraceCount, error: fallbackTraceError } = await db
        .from('agent_tasks')
        .select('id', { count: 'exact', head: true })
        .gte('created_at', sinceIso);
      if (fallbackTraceError) throw fallbackTraceError;
      tracesLastHour = fallbackTraceCount ?? 0;
      const { count: fallbackFailedCount, error: fallbackFailedError } = await db
        .from('agent_tasks')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'failed')
        .gte('created_at', sinceIso);
      if (fallbackFailedError) throw fallbackFailedError;
      failedTracesLastHour = fallbackFailedCount ?? 0;
      providerMix.unknown = tracesLastHour;
      providerFailures.unknown = failedTracesLastHour;
    } else if (traceCountError) {
      throw traceCountError;
    } else {
      const { count: failedTraceCount, error: failedTraceError } = await db
        .from('agent_trace_events')
        .select('id', { count: 'exact', head: true })
        .gte('created_at', sinceIso)
        .in('status', FAILURE_STATUSES);
      if (failedTraceError) throw failedTraceError;
      failedTracesLastHour = failedTraceCount ?? 0;

      const providerProbe = await db
        .from('agent_trace_events')
        .select('provider', { count: 'exact', head: true })
        .gte('created_at', sinceIso);

      if (providerProbe.error) {
        providerMix.unknown = tracesLastHour;
        providerFailures.unknown = failedTracesLastHour;
      } else {
        const providerTotals = await Promise.all(
          KNOWN_PROVIDERS.map(async (provider) => {
            const response = await db
              .from('agent_trace_events')
              .select('id', { count: 'exact', head: true })
              .gte('created_at', sinceIso)
              .eq('provider', provider);
            return { provider, count: response.count ?? 0, error: response.error };
          }),
        );
        const providerFailureTotals = await Promise.all(
          KNOWN_PROVIDERS.map(async (provider) => {
            const response = await db
              .from('agent_trace_events')
              .select('id', { count: 'exact', head: true })
              .gte('created_at', sinceIso)
              .eq('provider', provider)
              .in('status', FAILURE_STATUSES);
            return { provider, count: response.count ?? 0, error: response.error };
          }),
        );
        const providerQueryError =
          providerTotals.some(({ error }) => Boolean(error)) ||
          providerFailureTotals.some(({ error }) => Boolean(error));
        if (providerQueryError) {
          // Provider-level dimensions are optional for diagnostics; keep overview
          // available with unknown buckets when older schemas or API quirks fail.
          providerMix.unknown = tracesLastHour;
          providerFailures.unknown = failedTracesLastHour;
        } else {
          let knownTotal = 0;
          for (const { provider, count } of providerTotals) {
            providerMix[provider] = count;
            knownTotal += count;
          }
          let knownFailure = 0;
          for (const { provider, count } of providerFailureTotals) {
            providerFailures[provider] = count;
            knownFailure += count;
          }
          providerMix.unknown = Math.max(0, tracesLastHour - knownTotal);
          providerFailures.unknown = Math.max(0, failedTracesLastHour - knownFailure);
        }
      }
    }

    const { data: workers, error: workersError } = await db
      .from('agent_worker_heartbeats')
      .select('worker_id,updated_at,active_tasks,queue_lag_ms,host,pid,version')
      .order('updated_at', { ascending: false })
      .limit(50);
    const normalizedWorkers =
      workersError && isMissingRelationError(workersError, 'agent_worker_heartbeats') ? [] : workers;
    if (workersError && !isMissingRelationError(workersError, 'agent_worker_heartbeats')) throw workersError;

    return NextResponse.json({
      ok: true,
      actorUserId: admin.userId,
      actorAccessMode: admin.mode,
      safeActionsAllowed: admin.mode === 'allowlist',
      detailGlobalScope: isAgentAdminDetailGlobalScopeEnabled(),
      detailMaskDefault: isAgentAdminDetailMaskDefaultEnabled(),
      queue: statusCounts,
      queueOldestQueuedAt: oldestQueuedAt,
      queueOldestQueuedAgeMs: oldestQueuedAgeMs,
      tracesLastHour,
      providerMix,
      providerFailures,
      activeWorkers: (normalizedWorkers ?? []).length,
      workers: normalizedWorkers ?? [],
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'failed to load overview';
    return NextResponse.json({
      ok: false,
      degraded: true,
      actorUserId: admin.userId,
      actorAccessMode: admin.mode,
      safeActionsAllowed: admin.mode === 'allowlist',
      detailGlobalScope: isAgentAdminDetailGlobalScopeEnabled(),
      detailMaskDefault: isAgentAdminDetailMaskDefaultEnabled(),
      queue: {
        queued: 0,
        running: 0,
        failed: 0,
        succeeded: 0,
        canceled: 0,
      },
      queueOldestQueuedAt: null,
      queueOldestQueuedAgeMs: null,
      tracesLastHour: 0,
      providerMix: initProviderCounts(),
      providerFailures: initProviderCounts(),
      activeWorkers: 0,
      workers: [],
      errors: [{ scope: 'overview', reason }],
      generatedAt: new Date().toISOString(),
    });
  }
}
