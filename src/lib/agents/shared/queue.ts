import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';
import type { JsonObject } from '@/lib/utils/json-schema';
import { createLogger } from '@/lib/logging';
import { deriveRequestCorrelation } from './request-correlation';
import { recordAgentTraceEvent, recordTaskTraceFromParams } from './trace-events';

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
}

export interface ClaimOptions {
  limit?: number;
  resourceLocks?: string[];
  leaseTtlMs?: number;
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
      void recordAgentTraceEvent({
        stage: 'deduped',
        status: existingForDedup.status,
        traceId: correlation.traceId,
        requestId: correlation.requestId,
        intentId: correlation.intentId,
        taskId: existingForDedup.id,
        task,
        room,
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

    const coalescingTaskNames = ['fairy.intent', 'canvas.agent_prompt', 'canvas.quick_text'];
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
      request_id: resolvedRequestId ?? null,
      dedupe_key: resolvedDedupeKey ?? null,
      resource_keys: normalizedResourceKeys,
      priority,
      run_at: runAt ? runAt.toISOString() : null,
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
      if (insertResult.data && typeof (insertResult.data as Record<string, unknown>).trace_id === 'undefined') {
        insertResult = {
          ...insertResult,
          data: {
            ...(insertResult.data as Record<string, unknown>),
            trace_id: null,
          } as AgentTask,
        };
      }
    }

    const { data, error } = insertResult;

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
        status: 'queued',
        taskId: data.id,
        task,
        room,
        params,
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

  async completeTask(taskId: string, leaseToken: string, result?: JsonObject) {
    const { error } = await this.supabase
      .from('agent_tasks')
      .update({
        status: 'succeeded',
        lease_token: null,
        lease_expires_at: null,
        result: result ?? null,
      })
      .eq('id', taskId)
      .eq('lease_token', leaseToken);

    if (error) throw error;
  }

  async failTask(taskId: string, leaseToken: string, opts: { error: string; retryAt?: Date }) {
    await this.supabase.rpc('increment_agent_task_attempt', { task_id: taskId });

    const { error } = await this.supabase
      .from('agent_tasks')
      .update({
        status: opts.retryAt ? 'queued' : 'failed',
        lease_token: null,
        lease_expires_at: null,
        run_at: opts.retryAt ? opts.retryAt.toISOString() : null,
        error: opts.error,
      })
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
