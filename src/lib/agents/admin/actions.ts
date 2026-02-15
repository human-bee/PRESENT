import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { recordOpsAudit } from '@/lib/agents/shared/trace-events';
import { getAdminSupabaseClient } from './supabase-admin';
import type { JsonObject } from '@/lib/utils/json-schema';

const actionSchema = z.enum(['cancel', 'retry', 'requeue']);
export type AgentSafeAction = z.infer<typeof actionSchema>;

const ActionInputSchema = z.object({
  action: actionSchema,
  targetTaskId: z.string().min(1),
  reason: z.string().min(3).max(600),
});

type AgentTaskRow = {
  id: string;
  room: string;
  task: string;
  params: JsonObject;
  status: string;
  attempt: number;
  request_id: string | null;
  dedupe_key: string | null;
  resource_keys: string[];
  priority: number;
};

export function parseAgentActionInput(value: unknown) {
  return ActionInputSchema.parse(value);
}

export async function runAgentSafeAction(input: {
  actorUserId: string;
  action: AgentSafeAction;
  targetTaskId: string;
  reason: string;
}) {
  const db = getAdminSupabaseClient();
  const { data, error } = await db
    .from('agent_tasks')
    .select('id,room,task,params,status,attempt,request_id,dedupe_key,resource_keys,priority')
    .eq('id', input.targetTaskId)
    .maybeSingle();

  if (error) throw new Error(`Failed to load task: ${error.message}`);
  const row = data as AgentTaskRow | null;
  if (!row) throw new Error('Task not found');

  const beforeStatus = row.status;
  let afterStatus = beforeStatus;
  let result: JsonObject = {};

  if (input.action === 'cancel') {
    if (!['queued', 'running'].includes(row.status)) {
      throw new Error(`Cannot cancel task in status ${row.status}`);
    }
    const { error: updateError } = await db
      .from('agent_tasks')
      .update({
        status: 'canceled',
        lease_token: null,
        lease_expires_at: null,
        updated_at: new Date().toISOString(),
        error: `Canceled by admin: ${input.reason.trim().slice(0, 240)}`,
      })
      .eq('id', row.id);
    if (updateError) throw new Error(`Cancel failed: ${updateError.message}`);
    afterStatus = 'canceled';
    result = { status: 'canceled' };
  } else if (input.action === 'retry') {
    if (row.status !== 'failed') {
      throw new Error(`Retry requires failed task status (got ${row.status})`);
    }
    const retryRequestId =
      typeof row.request_id === 'string' && row.request_id.trim().length > 0
        ? `${row.request_id.trim()}:retry:${Date.now()}`
        : `retry:${row.id}:${Date.now()}`;
    const { data: inserted, error: insertError } = await db
      .from('agent_tasks')
      .insert({
        room: row.room,
        task: row.task,
        params: row.params,
        status: 'queued',
        priority: row.priority,
        attempt: 0,
        request_id: retryRequestId,
        dedupe_key: row.dedupe_key,
        resource_keys: row.resource_keys,
        run_at: null,
      })
      .select('id,status')
      .single();
    if (insertError) throw new Error(`Retry enqueue failed: ${insertError.message}`);
    afterStatus = 'queued';
    result = { status: 'queued', retryTaskId: String(inserted?.id || '') };
  } else if (input.action === 'requeue') {
    if (row.status !== 'running') {
      throw new Error(`Requeue requires running task status (got ${row.status})`);
    }
    const { error: updateError } = await db
      .from('agent_tasks')
      .update({
        status: 'queued',
        lease_token: null,
        lease_expires_at: null,
        run_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', row.id);
    if (updateError) throw new Error(`Requeue failed: ${updateError.message}`);
    afterStatus = 'queued';
    result = { status: 'queued' };
  }

  await recordOpsAudit({
    actorUserId: input.actorUserId,
    action: input.action,
    targetTaskId: row.id,
    targetTraceId: extractTraceId(row.params),
    reason: input.reason,
    beforeStatus,
    afterStatus,
    result,
  });

  return {
    ok: true,
    actionId: randomUUID(),
    action: input.action,
    targetTaskId: row.id,
    beforeStatus,
    afterStatus,
    result,
  };
}

function extractTraceId(params: JsonObject): string | undefined {
  const direct = typeof params.traceId === 'string' ? params.traceId.trim() : '';
  if (direct) return direct;
  const metadata = params.metadata;
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return undefined;
  const metaTraceId = (metadata as Record<string, unknown>).traceId;
  if (typeof metaTraceId !== 'string') return undefined;
  const trimmed = metaTraceId.trim();
  return trimmed || undefined;
}
