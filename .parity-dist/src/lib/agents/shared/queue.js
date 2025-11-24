import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';
function createSupabaseClient(options) {
    const url = options?.url ?? process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = options?.serviceRoleKey ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? options?.anonKey;
    if (!url || !key) {
        throw new Error('AgentTaskQueue requires Supabase URL and key');
    }
    return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
export class AgentTaskQueue {
    constructor(options) {
        this.options = options;
        this.supabase = createSupabaseClient(options);
    }
    async enqueueTask(input) {
        const { room, task, params = {}, requestId, dedupeKey, resourceKeys = [], priority = 0, runAt, } = input;
        const nowIso = new Date().toISOString();
        const resourceKeySet = new Set(resourceKeys.length ? resourceKeys : [`room:${room}`]);
        // TEMP instrumentation to trace steward enqueue issues.
        console.debug('[AgentTaskQueue][debug] enqueueTask', {
            room,
            task,
            requestId,
            dedupeKey,
            resourceKeys: Array.from(resourceKeySet),
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
            resource_keys: Array.from(resourceKeySet),
            priority,
            run_at: runAt ? runAt.toISOString() : null,
            created_at: nowIso,
            updated_at: nowIso,
        })
            .select()
            .single();
        if (error) {
            if (error.code === '23505') {
                console.debug('[AgentTaskQueue][debug] enqueueTask dedupe hit', { room, task, requestId });
                return null; // idempotent duplicate
            }
            console.error('[AgentTaskQueue][debug] enqueueTask error', { room, task, error });
            throw error;
        }
        console.debug('[AgentTaskQueue][debug] enqueueTask inserted', { id: data?.id, room, task });
        return data;
    }
    async claimTasks(options = {}) {
        const leaseToken = randomUUID();
        const leaseExpiresAt = new Date(Date.now() + (options.leaseTtlMs ?? 15000)).toISOString();
        const resourceLocks = options.resourceLocks && options.resourceLocks.length ? Array.from(new Set(options.resourceLocks)) : [];
        const { data, error } = await this.supabase.rpc('claim_agent_tasks', {
            p_lease_token: leaseToken,
            p_lease_expires_at: leaseExpiresAt,
            p_limit_tasks: options.limit ?? 1,
            p_resource_keys: resourceLocks,
        });
        if (error)
            throw error;
        return { leaseToken, tasks: data ?? [] };
    }
    async completeTask(taskId, leaseToken, result) {
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
        if (error)
            throw error;
    }
    async failTask(taskId, leaseToken, opts) {
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
        if (error)
            throw error;
    }
    async markInFlight(taskId, leaseToken, payload) {
        const { error } = await this.supabase
            .from('agent_tasks')
            .update({ params: payload })
            .eq('id', taskId)
            .eq('lease_token', leaseToken);
        if (error)
            throw error;
    }
    async listPending(room) {
        const { data, error } = await this.supabase
            .from('agent_tasks')
            .select('*')
            .eq('room', room)
            .in('status', ['queued', 'running'])
            .order('created_at', { ascending: true });
        if (error)
            throw error;
        return data ?? [];
    }
    async cancelTask(taskId) {
        const { error } = await this.supabase
            .from('agent_tasks')
            .update({ status: 'canceled' })
            .eq('id', taskId)
            .neq('status', 'succeeded');
        if (error)
            throw error;
    }
    async extendLease(taskId, leaseToken, ttlMs) {
        const { error } = await this.supabase
            .from('agent_tasks')
            .update({ lease_expires_at: new Date(Date.now() + ttlMs).toISOString() })
            .eq('id', taskId)
            .eq('lease_token', leaseToken);
        if (error)
            throw error;
    }
    async releaseLease(taskId, leaseToken) {
        const { error } = await this.supabase
            .from('agent_tasks')
            .update({ lease_token: null, lease_expires_at: null })
            .eq('id', taskId)
            .eq('lease_token', leaseToken);
        if (error)
            throw error;
    }
    async cancelByRequestId(room, requestId) {
        const { error } = await this.supabase
            .from('agent_tasks')
            .update({ status: 'canceled' })
            .eq('room', room)
            .eq('request_id', requestId)
            .neq('status', 'succeeded');
        if (error)
            throw error;
    }
    async supersede(room, resourceKeys) {
        const { error } = await this.supabase
            .from('agent_tasks')
            .update({ status: 'canceled' })
            .eq('room', room)
            .contains('resource_keys', resourceKeys)
            .in('status', ['queued', 'running']);
        if (error)
            throw error;
    }
}
//# sourceMappingURL=queue.js.map