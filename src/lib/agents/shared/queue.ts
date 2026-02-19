import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';
import os from 'node:os';
import type { JsonObject } from '@/lib/utils/json-schema';
import { createLogger } from '@/lib/logging';
import { isMissingRelationError } from '@/lib/agents/admin/supabase-errors';
import { deriveRequestCorrelation } from './request-correlation';
import { recordTaskTraceFromParams } from './trace-events';
import {
  areWorkerHostsEquivalent,
  extractRuntimeScopeFromParams,
  getRuntimeScopeResourceKey,
  getWorkerHostSkipResourceKey,
  isLocalRuntimeScope,
  normalizeWorkerHostIdentity,
} from './runtime-scope';

export type AgentTaskStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled';

export interface AgentTask {
  id: string;
  created_at: string;
  updated_at: string;
  room: string;
  task: string;
  params: JsonObject;
  trace_id: string | null;
  status: AgentTaskStatus;
  priority: number;
  run_at: string | null;
  attempt: number;
  error: string | null;
  request_id: string | null;
  dedupe_key: string | null;
  resource_keys: string[];
  lease_token: string | null;
  lease_expires_at: string | null;
  result: JsonObject | null;
}

export interface EnqueueTaskInput {
  room: string;
  task: string;
  params?: JsonObject;
  requestId?: string;
  dedupeKey?: string;
  executionId?: string;
  idempotencyKey?: string;
  lockKey?: string;
  attempt?: number;
  resourceKeys?: string[];
  priority?: number;
  runAt?: Date;
  coalesceByResource?: boolean;
  coalesceTaskFilter?: string[];
}

export interface ClaimOptions {
  limit?: number;
  resourceLocks?: string[];
  leaseTtlMs?: number;
}

export interface ClaimLocalScopeTasksOptions {
  limit?: number;
  leaseTtlMs?: number;
  runtimeScope?: string | null;
}

// Backward-compatible alias for existing call sites/tests.
export type ClaimLocalScopeFairyOptions = ClaimLocalScopeTasksOptions;

export interface RequeueTaskOptions {
  runAt?: Date | null;
  error?: string | null;
  params?: JsonObject;
  resourceKeys?: string[];
}

export interface QueueClientOptions {
  anonKey?: string;
  serviceRoleKey?: string;
  url?: string;
}

function createSupabaseClient(options?: QueueClientOptions): SupabaseClient {
  const url = options?.url ?? process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = options?.serviceRoleKey ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? options?.anonKey;
  if (!url || !key) {
    throw new Error('AgentTaskQueue requires Supabase URL and key');
  }
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

const logger = createLogger('agents:queue');
const ACTIVE_DEDUPE_STATUSES: AgentTaskStatus[] = ['queued', 'running'];
const LOCAL_SCOPE_HOST_FENCE_ENABLED = process.env.AGENT_LOCAL_SCOPE_HOST_FENCE !== 'false';
const LOCAL_SCOPE_HOST_FENCE_LOOKBACK_MS = Math.max(
  5_000,
  Number.parseInt(process.env.AGENT_LOCAL_SCOPE_HOST_FENCE_LOOKBACK_MS ?? '120000', 10) || 120_000,
);
const LOCAL_SCOPE_HOST_FENCE_LIMIT = Math.max(
  5,
  Number.parseInt(process.env.AGENT_LOCAL_SCOPE_HOST_FENCE_LIMIT ?? '120', 10) || 120,
);
const LOCAL_SCOPE_TASK_ISOLATION_ENABLED =
  (process.env.AGENT_LOCAL_SCOPE_TASK_ISOLATION ??
    process.env.AGENT_LOCAL_SCOPE_FAIRY_ISOLATION ??
    'true') !== 'false';
const LOCAL_SCOPE_DIRECT_CLAIM_RESOURCE_KEY = 'queue-mode:local-scope-direct-claim';

const readErrorText = (error: unknown, key: 'message' | 'details' | 'hint' | 'code'): string => {
  if (!error || typeof error !== 'object') return '';
  const value = (error as Record<string, unknown>)[key];
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : '';
};

const isMissingTraceIdColumnError = (error: unknown): boolean => {
  const message = readErrorText(error, 'message');
  const details = readErrorText(error, 'details');
  const hint = readErrorText(error, 'hint');
  const combined = `${message} ${details} ${hint}`.toLowerCase();
  return combined.includes('trace_id') && (combined.includes('column') || combined.includes('schema cache'));
};

const shouldUseLocalScopeDirectClaim = (args: {
  runtimeScope: string | null;
  task: string;
}): boolean => {
  if (!LOCAL_SCOPE_TASK_ISOLATION_ENABLED) return false;
  if (!isLocalRuntimeScope(args.runtimeScope)) return false;
  return true;
};

export class AgentTaskQueue {
  private readonly supabase: SupabaseClient;

  constructor(private readonly options?: QueueClientOptions) {
    this.supabase = createSupabaseClient(options);
  }

  private async findExistingTaskForDedup(args: {
    room: string;
    task: string;
    requestId?: string;
    dedupeKey?: string;
    activeOnly?: boolean;
  }): Promise<AgentTask | null> {
    const { room, task, requestId, dedupeKey, activeOnly = true } = args;
    const normalizedRequestId = typeof requestId === 'string' && requestId.trim() ? requestId.trim() : null;
    const normalizedDedupeKey = typeof dedupeKey === 'string' && dedupeKey.trim() ? dedupeKey.trim() : null;
    if (!normalizedRequestId && !normalizedDedupeKey) return null;

    let query = this.supabase
      .from('agent_tasks')
      .select('*')
      .eq('room', room)
      .eq('task', task)
      .order('created_at', { ascending: false })
      .limit(1);
    if (activeOnly) {
      query = query.in('status', ACTIVE_DEDUPE_STATUSES);
    }

    if (normalizedRequestId) {
      query = query.eq('request_id', normalizedRequestId);
    } else if (normalizedDedupeKey) {
      query = query.eq('dedupe_key', normalizedDedupeKey);
    }

    const { data, error } = await query.maybeSingle();
    if (error) {
      logger.warn('findExistingTaskForDedup failed', {
        room,
        task,
        requestId: normalizedRequestId,
        dedupeKey: normalizedDedupeKey,
        error,
      });
      return null;
    }
    return (data as AgentTask | null) ?? null;
  }

  private async resolveLocalScopeForeignHostSkipKeys(runtimeScope: string | null): Promise<string[]> {
    if (!LOCAL_SCOPE_HOST_FENCE_ENABLED) return [];
    if (!isLocalRuntimeScope(runtimeScope)) return [];

    const localHost = normalizeWorkerHostIdentity(os.hostname());
    if (!localHost) return [];

    const { data, error } = await this.supabase
      .from('agent_worker_heartbeats')
      .select('host,updated_at')
      .order('updated_at', { ascending: false })
      .limit(LOCAL_SCOPE_HOST_FENCE_LIMIT);

    if (error) {
      if (isMissingRelationError(error, 'agent_worker_heartbeats')) return [];
      logger.warn('resolveLocalScopeForeignHostSkipKeys failed', {
        runtimeScope,
        error,
      });
      return [];
    }

    const cutoffMs = Date.now() - LOCAL_SCOPE_HOST_FENCE_LOOKBACK_MS;
    const foreignHosts = new Set<string>();
    for (const row of (data as Array<{ host?: unknown; updated_at?: unknown }> | null) ?? []) {
      const host = normalizeWorkerHostIdentity(row.host);
      if (!host || areWorkerHostsEquivalent(host, localHost)) continue;
      const updatedAtMs =
        typeof row.updated_at === 'string' && row.updated_at.trim().length > 0
          ? Date.parse(row.updated_at)
          : Number.NaN;
      if (!Number.isFinite(updatedAtMs) || updatedAtMs < cutoffMs) continue;
      foreignHosts.add(host);
    }

    return Array.from(foreignHosts).map((host) => getWorkerHostSkipResourceKey(host));
  }

  async enqueueTask(input: EnqueueTaskInput): Promise<AgentTask | null> {
    const {
      room,
      task,
      params = {},
      requestId,
      dedupeKey,
      idempotencyKey,
      lockKey,
      resourceKeys = [],
      priority = 0,
      runAt,
      coalesceByResource = false,
    } = input;

    const nowIso = new Date().toISOString();
    const paramsRecord = params as Record<string, unknown>;
    const lockKeyFromParams =
      typeof paramsRecord.lockKey === 'string' && paramsRecord.lockKey.trim().length > 0
        ? paramsRecord.lockKey.trim()
        : undefined;
    const lockKeyNormalized =
      (typeof lockKey === 'string' && lockKey.trim().length > 0 ? lockKey.trim() : undefined) ??
      lockKeyFromParams;
    const idempotencyKeyFromParams =
      typeof paramsRecord.idempotencyKey === 'string' && paramsRecord.idempotencyKey.trim().length > 0
        ? paramsRecord.idempotencyKey.trim()
        : undefined;
    const idempotencyNormalized =
      (typeof idempotencyKey === 'string' && idempotencyKey.trim().length > 0
        ? idempotencyKey.trim()
        : undefined) ?? idempotencyKeyFromParams;

    const resourceKeySet = new Set(resourceKeys.length ? resourceKeys : [`room:${room}`]);
    if (lockKeyNormalized) {
      resourceKeySet.add(`lock:${lockKeyNormalized}`);
    }
    const runtimeScope = extractRuntimeScopeFromParams(params);
    const localScopeDirectClaim = shouldUseLocalScopeDirectClaim({
      runtimeScope,
      task,
    });
    const localScopeForeignHostSkipKeys = await this.resolveLocalScopeForeignHostSkipKeys(runtimeScope);
    for (const skipHostKey of localScopeForeignHostSkipKeys) {
      resourceKeySet.add(skipHostKey);
    }
    if (localScopeDirectClaim) {
      resourceKeySet.add(LOCAL_SCOPE_DIRECT_CLAIM_RESOURCE_KEY);
    }
    const normalizedResourceKeys = Array.from(resourceKeySet);
    const resolvedRequestId =
      (typeof requestId === 'string' && requestId.trim().length > 0 ? requestId.trim() : undefined) ??
      idempotencyNormalized;
    const resolvedDedupeKey =
      (typeof dedupeKey === 'string' && dedupeKey.trim().length > 0 ? dedupeKey.trim() : undefined) ??
      idempotencyNormalized;
    const existingForDedup = await this.findExistingTaskForDedup({
      room,
      task,
      requestId: resolvedRequestId,
      dedupeKey: resolvedDedupeKey,
      activeOnly: true,
    });
    if (existingForDedup) {
      logger.debug('enqueueTask dedupe pre-check hit', {
        room,
        task,
        requestId: resolvedRequestId,
        dedupeKey: resolvedDedupeKey,
        existingTaskId: existingForDedup.id,
        status: existingForDedup.status,
      });
      const correlation = deriveRequestCorrelation({
        task,
        requestId: resolvedRequestId,
        params,
      });
      void recordTaskTraceFromParams({
        stage: 'deduped',
        status: existingForDedup.status,
        traceId: correlation.traceId,
        requestId: correlation.requestId,
        intentId: correlation.intentId,
        taskId: existingForDedup.id,
        task,
        room,
        params: (existingForDedup.params ?? params) as JsonObject,
        attempt: existingForDedup.attempt,
        payload: {
          dedupeTraceId: correlation.traceId ?? null,
          dedupeRequestId: correlation.requestId ?? null,
          dedupeIntentId: correlation.intentId ?? null,
        },
      });
      return existingForDedup;
    }
    const queueDepthLimit = Number(process.env.TASK_QUEUE_MAX_DEPTH_PER_ROOM ?? 0);
    if (Number.isFinite(queueDepthLimit) && queueDepthLimit > 0) {
      const { count, error: countError } = await this.supabase
        .from('agent_tasks')
        .select('id', { count: 'exact', head: true })
        .eq('room', room)
        .in('status', ['queued', 'running']);
      if (countError) throw countError;
      if ((count ?? 0) >= queueDepthLimit) {
        throw new Error(`QUEUE_DEPTH_LIMIT_REACHED:${room}`);
      }
    }

    // Keep mutation-bearing fairy/quick_text tasks out of default coalescing:
    // sequential fan-out intents must not cancel each other. Dedupe for retries
    // is handled via request/idempotency keys instead.
    const defaultCoalescingTaskNames = ['canvas.agent_prompt'];
    const coalescingTaskNames = Array.from(
      new Set([...(input.coalesceTaskFilter ?? []), ...defaultCoalescingTaskNames]),
    );
    const shouldCoalesce = coalesceByResource || coalescingTaskNames.includes(task);
    const coalesceTaskFilter = coalesceByResource
      ? Array.from(new Set([...coalescingTaskNames, task]))
      : coalescingTaskNames;
    if (shouldCoalesce) {
      const { error: coalesceError } = await this.supabase
        .from('agent_tasks')
        .update({ status: 'canceled', updated_at: nowIso })
        .eq('room', room)
        .eq('status', 'queued')
        .contains('resource_keys', normalizedResourceKeys)
        .in('task', coalesceTaskFilter);
      if (coalesceError) {
        console.warn('[AgentTaskQueue][debug] enqueueTask coalesce failed', {
          room,
          task,
          error: coalesceError.message,
        });
      }
    }

    logger.debug('enqueueTask', {
      room,
      task,
      requestId: resolvedRequestId,
      dedupeKey: resolvedDedupeKey,
      resourceKeys: normalizedResourceKeys,
      coalesced: shouldCoalesce,
      hasSupabase: Boolean(this.supabase),
    });

    const correlation = deriveRequestCorrelation({
      task,
      requestId: resolvedRequestId,
      params,
    });
    const resolvedTraceId =
      typeof correlation.traceId === 'string' && correlation.traceId.trim().length > 0
        ? correlation.traceId.trim()
        : null;

    const baseInsertPayload = {
      room,
      task,
      params,
      status: localScopeDirectClaim ? ('running' as const) : ('queued' as const),
      request_id: resolvedRequestId ?? null,
      dedupe_key: resolvedDedupeKey ?? null,
      resource_keys: normalizedResourceKeys,
      priority,
      run_at: runAt ? runAt.toISOString() : null,
      lease_token: null,
      lease_expires_at: null,
      created_at: nowIso,
      updated_at: nowIso,
    };

    let insertResult = await this.supabase
      .from('agent_tasks')
      .insert({
        ...baseInsertPayload,
        trace_id: resolvedTraceId,
      })
      .select()
      .single();

    if (insertResult.error && isMissingTraceIdColumnError(insertResult.error)) {
      logger.warn('agent_tasks.trace_id unavailable; retrying enqueue without trace_id', {
        room,
        task,
        requestId: resolvedRequestId,
      });
      insertResult = await this.supabase
        .from('agent_tasks')
        .insert(baseInsertPayload)
        .select()
        .single();
    }

    const data = insertResult.data
      ? ({
          ...(insertResult.data as Record<string, unknown>),
          trace_id:
            typeof (insertResult.data as Record<string, unknown>).trace_id === 'undefined'
              ? null
              : (insertResult.data as Record<string, unknown>).trace_id,
        } as AgentTask)
      : null;
    const { error } = insertResult;

    if (error) {
      if (error.code === '23505') {
        logger.debug('enqueueTask dedupe hit', { room, task, requestId: resolvedRequestId });
        const existingAfterConflict = await this.findExistingTaskForDedup({
          room,
          task,
          requestId: resolvedRequestId,
          dedupeKey: resolvedDedupeKey,
          activeOnly: false,
        });
        return existingAfterConflict;
      }
      logger.error('enqueueTask failed', { room, task, error });
      throw error;
    }

    logger.debug('enqueueTask inserted', { id: data?.id, room, task });
    if (data?.id) {
      void recordTaskTraceFromParams({
        stage: 'queued',
        status: localScopeDirectClaim ? 'running' : 'queued',
        taskId: data.id,
        task,
        room,
        params,
        payload: localScopeDirectClaim
          ? {
              queueMode: 'local_scope_direct_claim',
              runtimeScope,
            }
          : undefined,
      });
    }

    return data;
  }

  async claimTasks(options: ClaimOptions = {}) {
    const leaseToken = randomUUID();
    const leaseExpiresAt = new Date(Date.now() + (options.leaseTtlMs ?? 15_000)).toISOString();
    const resourceLocks = options.resourceLocks && options.resourceLocks.length ? Array.from(new Set(options.resourceLocks)) : [];

    const { data, error } = await this.supabase.rpc('claim_agent_tasks', {
      p_lease_token: leaseToken,
      p_lease_expires_at: leaseExpiresAt,
      p_limit_tasks: options.limit ?? 1,
      p_resource_keys: resourceLocks,
    });

    if (error) throw error;
    for (const task of (data as AgentTask[] | null) ?? []) {
      void recordTaskTraceFromParams({
        stage: 'claimed',
        status: 'running',
        taskId: task.id,
        task: task.task,
        room: task.room,
        params: task.params,
        attempt: task.attempt,
      });
    }

    return { leaseToken, tasks: (data as AgentTask[] | null) ?? [] };
  }

  async claimLocalScopeTasks(options: ClaimLocalScopeTasksOptions = {}) {
    const leaseToken = randomUUID();
    const limit = Math.max(1, options.limit ?? 1);
    const leaseExpiresAt = new Date(Date.now() + (options.leaseTtlMs ?? 15_000)).toISOString();
    const scopeKey = getRuntimeScopeResourceKey(options.runtimeScope ?? null);
    if (!scopeKey) {
      return { leaseToken, tasks: [] as AgentTask[] };
    }

    const nowMs = Date.now();
    const fetchLimit = Math.max(limit * 4, 20);
    const { data: candidates, error } = await this.supabase
      .from('agent_tasks')
      .select('*')
      .eq('status', 'running')
      .is('lease_token', null)
      .contains('resource_keys', [scopeKey])
      .contains('resource_keys', [LOCAL_SCOPE_DIRECT_CLAIM_RESOURCE_KEY])
      .order('priority', { ascending: false })
      .order('created_at', { ascending: true })
      .limit(fetchLimit);
    if (error) throw error;

    const dueCandidates = ((candidates as AgentTask[] | null) ?? []).filter((task) => {
      if (!task.run_at) return true;
      const runAtMs = Date.parse(task.run_at);
      if (!Number.isFinite(runAtMs)) return true;
      return runAtMs <= nowMs;
    });

    const claimed: AgentTask[] = [];
    for (const candidate of dueCandidates) {
      if (claimed.length >= limit) break;
      const { data: updated, error: updateError } = await this.supabase
        .from('agent_tasks')
        .update({
          lease_token: leaseToken,
          lease_expires_at: leaseExpiresAt,
          updated_at: new Date().toISOString(),
        })
        .eq('id', candidate.id)
        .eq('status', 'running')
        .is('lease_token', null)
        .select('*')
        .maybeSingle();
      if (updateError) throw updateError;
      if (!updated) continue;
      claimed.push(updated as AgentTask);
    }

    for (const task of claimed) {
      void recordTaskTraceFromParams({
        stage: 'claimed',
        status: 'running',
        taskId: task.id,
        task: task.task,
        room: task.room,
        params: task.params,
        attempt: task.attempt,
        payload: {
          claimMode: 'local_scope_direct_claim',
          runtimeScope: options.runtimeScope ?? null,
        },
      });
    }

    return { leaseToken, tasks: claimed };
  }

  async claimLocalScopeFairyTasks(options: ClaimLocalScopeFairyOptions = {}) {
    return this.claimLocalScopeTasks(options);
  }

  async completeTask(taskId: string, leaseToken: string, result?: JsonObject) {
    const { error } = await this.supabase
      .from('agent_tasks')
      .update({
        status: 'succeeded',
        lease_token: null,
        lease_expires_at: null,
        result: result ?? null,
        error: null,
      })
      .eq('id', taskId)
      .eq('lease_token', leaseToken);

    if (error) throw error;
  }

  async failTask(
    taskId: string,
    leaseToken: string,
    opts: { error: string; retryAt?: Date; keepInRunningLane?: boolean },
  ) {
    await this.supabase.rpc('increment_agent_task_attempt', { task_id: taskId });

    const { error } = await this.supabase
      .from('agent_tasks')
      .update({
        status: opts.retryAt ? (opts.keepInRunningLane ? 'running' : 'queued') : 'failed',
        lease_token: null,
        lease_expires_at: null,
        run_at: opts.retryAt ? opts.retryAt.toISOString() : null,
        error: opts.error,
      })
      .eq('id', taskId)
      .eq('lease_token', leaseToken);

    if (error) throw error;
  }

  async requeueTask(taskId: string, leaseToken: string, opts: RequeueTaskOptions = {}) {
    const updatePayload: Record<string, unknown> = {
      status: 'queued',
      lease_token: null,
      lease_expires_at: null,
      updated_at: new Date().toISOString(),
    };
    if (Object.prototype.hasOwnProperty.call(opts, 'runAt')) {
      updatePayload.run_at = opts.runAt ? opts.runAt.toISOString() : null;
    }
    if (Object.prototype.hasOwnProperty.call(opts, 'error')) {
      updatePayload.error = opts.error ?? null;
    }
    if (opts.params) {
      updatePayload.params = opts.params;
    }
    if (Array.isArray(opts.resourceKeys) && opts.resourceKeys.length > 0) {
      updatePayload.resource_keys = Array.from(new Set(opts.resourceKeys));
    }

    const { error } = await this.supabase
      .from('agent_tasks')
      .update(updatePayload)
      .eq('id', taskId)
      .eq('lease_token', leaseToken);

    if (error) throw error;
  }

  async markInFlight(taskId: string, leaseToken: string, payload: JsonObject) {
    const { error } = await this.supabase
      .from('agent_tasks')
      .update({ params: payload })
      .eq('id', taskId)
      .eq('lease_token', leaseToken);

    if (error) throw error;
  }

  async listPending(room: string) {
    const { data, error } = await this.supabase
      .from('agent_tasks')
      .select('*')
      .eq('room', room)
      .in('status', ['queued', 'running'])
      .order('created_at', { ascending: true });

    if (error) throw error;
    return data ?? [];
  }

  async cancelTask(taskId: string) {
    const { error } = await this.supabase
      .from('agent_tasks')
      .update({ status: 'canceled' })
      .eq('id', taskId)
      .neq('status', 'succeeded');

    if (error) throw error;
  }

  async extendLease(taskId: string, leaseToken: string, ttlMs: number) {
    const { error } = await this.supabase
      .from('agent_tasks')
      .update({ lease_expires_at: new Date(Date.now() + ttlMs).toISOString() })
      .eq('id', taskId)
      .eq('lease_token', leaseToken);

    if (error) throw error;
  }

  async releaseLease(taskId: string, leaseToken: string) {
    const { error } = await this.supabase
      .from('agent_tasks')
      .update({ lease_token: null, lease_expires_at: null })
      .eq('id', taskId)
      .eq('lease_token', leaseToken);

    if (error) throw error;
  }

  async cancelByRequestId(room: string, requestId: string) {
    const { error } = await this.supabase
      .from('agent_tasks')
      .update({ status: 'canceled' })
      .eq('room', room)
      .eq('request_id', requestId)
      .neq('status', 'succeeded');

    if (error) throw error;
  }

  async supersede(room: string, resourceKeys: string[]) {
    const { error } = await this.supabase
      .from('agent_tasks')
      .update({ status: 'canceled' })
      .eq('room', room)
      .contains('resource_keys', resourceKeys)
      .in('status', ['queued', 'running']);

    if (error) throw error;
  }
}
