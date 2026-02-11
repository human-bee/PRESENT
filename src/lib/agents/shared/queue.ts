import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';
import type { JsonObject } from '@/lib/utils/json-schema';
import { createLogger } from '@/lib/logging';

export type AgentTaskStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled';

export interface AgentTask {
  id: string;
  created_at: string;
  updated_at: string;
  room: string;
  task: string;
  params: JsonObject;
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

export class AgentTaskQueue {
  private readonly supabase: SupabaseClient;

  constructor(private readonly options?: QueueClientOptions) {
    this.supabase = createSupabaseClient(options);
  }

  async enqueueTask(input: EnqueueTaskInput): Promise<AgentTask | null> {
    const {
      room,
      task,
      params = {},
      requestId,
      dedupeKey,
      resourceKeys = [],
      priority = 0,
      runAt,
      coalesceByResource = false,
    } = input;

    const nowIso = new Date().toISOString();

    const resourceKeySet = new Set(resourceKeys.length ? resourceKeys : [`room:${room}`]);
    const normalizedResourceKeys = Array.from(resourceKeySet);
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
      requestId,
      dedupeKey,
      resourceKeys: normalizedResourceKeys,
      coalesced: shouldCoalesce,
      hasSupabase: Boolean(this.supabase),
    });

    const { data, error } = await this.supabase
      .from('agent_tasks')
      .insert({
        room,
        task,
        params,
        request_id: requestId ?? null,
        dedupe_key: dedupeKey ?? null,
        resource_keys: normalizedResourceKeys,
        priority,
        run_at: runAt ? runAt.toISOString() : null,
        created_at: nowIso,
        updated_at: nowIso,
      })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        logger.debug('enqueueTask dedupe hit', { room, task, requestId });
        return null; // idempotent duplicate
      }
      logger.error('enqueueTask failed', { room, task, error });
      throw error;
    }

    logger.debug('enqueueTask inserted', { id: data?.id, room, task });

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
