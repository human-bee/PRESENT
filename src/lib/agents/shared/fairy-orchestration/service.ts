import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';

export type FairyProjectMode = 'solo' | 'duo';
export type FairyProjectStatus = 'active' | 'completed' | 'aborted';
export type FairyTaskStatus = 'created' | 'started' | 'done' | 'deleted' | 'awaiting' | 'delegated';

export type FairyOrchestrationEventInput = {
  room: string;
  sessionId: string;
  traceId?: string | null;
  requestId?: string | null;
  actionType: string;
  projectName?: string | null;
  projectMode?: FairyProjectMode | null;
  projectStatus?: FairyProjectStatus | null;
  taskId?: string | null;
  taskTitle?: string | null;
  assignedTo?: string | null;
  taskStatus?: FairyTaskStatus | null;
  payload?: Record<string, unknown>;
};

export type FairyOrchestrationEventRecord = {
  id: string;
  room: string;
  session_id: string;
  trace_id: string | null;
  request_id: string | null;
  action_type: string;
  project_name: string | null;
  project_mode: FairyProjectMode | null;
  project_status: FairyProjectStatus | null;
  task_id: string | null;
  task_title: string | null;
  assigned_to: string | null;
  task_status: FairyTaskStatus | null;
  payload: Record<string, unknown>;
  created_at: string;
};

type PersistResult =
  | { ok: true; storage: 'supabase' | 'memory'; event: FairyOrchestrationEventRecord }
  | { ok: false; reason: string };

let supabase: SupabaseClient | null | undefined;
const inMemoryEvents: FairyOrchestrationEventRecord[] = [];

const readEnv = (...keys: string[]) => {
  for (const key of keys) {
    const value = process.env[key];
    if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  }
  return null;
};

const nowIso = () => new Date().toISOString();

const getSupabaseClient = (): SupabaseClient | null => {
  if (supabase !== undefined) return supabase;
  const url = readEnv('SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL');
  const serviceRoleKey = readEnv('SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_KEY');
  if (!url || !serviceRoleKey) {
    supabase = null;
    return supabase;
  }
  supabase = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return supabase;
};

const isMissingLedgerTableError = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') return false;
  const message = String((error as any).message ?? '');
  const details = String((error as any).details ?? '');
  const hint = String((error as any).hint ?? '');
  const combined = `${message} ${details} ${hint}`.toLowerCase();
  return (
    combined.includes('fairy_orchestration_ledger') &&
    (combined.includes('does not exist') || combined.includes('schema cache') || combined.includes('relation'))
  );
};

const toRecord = (input: FairyOrchestrationEventInput): FairyOrchestrationEventRecord => ({
  id: randomUUID(),
  room: input.room,
  session_id: input.sessionId,
  trace_id: input.traceId ?? null,
  request_id: input.requestId ?? null,
  action_type: input.actionType,
  project_name: input.projectName ?? null,
  project_mode: input.projectMode ?? null,
  project_status: input.projectStatus ?? null,
  task_id: input.taskId ?? null,
  task_title: input.taskTitle ?? null,
  assigned_to: input.assignedTo ?? null,
  task_status: input.taskStatus ?? null,
  payload: input.payload ?? {},
  created_at: nowIso(),
});

export async function appendFairyOrchestrationEvent(input: FairyOrchestrationEventInput): Promise<PersistResult> {
  if (!input.room || !input.sessionId || !input.actionType) {
    return { ok: false, reason: 'invalid_event_input' };
  }

  const nextEvent = toRecord(input);
  const client = getSupabaseClient();
  if (!client) {
    inMemoryEvents.push(nextEvent);
    return { ok: true, storage: 'memory', event: nextEvent };
  }

  const { data, error } = await client
    .from('fairy_orchestration_ledger')
    .insert({
      room: nextEvent.room,
      session_id: nextEvent.session_id,
      trace_id: nextEvent.trace_id,
      request_id: nextEvent.request_id,
      action_type: nextEvent.action_type,
      project_name: nextEvent.project_name,
      project_mode: nextEvent.project_mode,
      project_status: nextEvent.project_status,
      task_id: nextEvent.task_id,
      task_title: nextEvent.task_title,
      assigned_to: nextEvent.assigned_to,
      task_status: nextEvent.task_status,
      payload: nextEvent.payload,
      created_at: nextEvent.created_at,
    })
    .select('*')
    .single();

  if (error) {
    if (isMissingLedgerTableError(error)) {
      inMemoryEvents.push(nextEvent);
      return { ok: true, storage: 'memory', event: nextEvent };
    }
    return { ok: false, reason: error.message || 'ledger_insert_failed' };
  }

  return {
    ok: true,
    storage: 'supabase',
    event: {
      ...(data as FairyOrchestrationEventRecord),
      payload:
        data && typeof (data as Record<string, unknown>).payload === 'object' && !Array.isArray((data as any).payload)
          ? ((data as any).payload as Record<string, unknown>)
          : {},
    },
  };
}

export async function resolveLatestActiveTaskId(args: {
  room: string;
  sessionId: string;
}): Promise<string | null> {
  const client = getSupabaseClient();
  if (client) {
    const { data, error } = await client
      .from('fairy_orchestration_ledger')
      .select('task_id')
      .eq('room', args.room)
      .eq('session_id', args.sessionId)
      .in('task_status', ['started', 'delegated', 'awaiting'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!error && data && typeof (data as Record<string, unknown>).task_id === 'string') {
      const taskId = String((data as Record<string, unknown>).task_id).trim();
      if (taskId) return taskId;
    }
  }

  for (let index = inMemoryEvents.length - 1; index >= 0; index -= 1) {
    const event = inMemoryEvents[index];
    if (event.room !== args.room || event.session_id !== args.sessionId) continue;
    if (event.task_status !== 'started' && event.task_status !== 'delegated' && event.task_status !== 'awaiting') {
      continue;
    }
    if (typeof event.task_id === 'string' && event.task_id.trim().length > 0) {
      return event.task_id.trim();
    }
  }
  return null;
}
