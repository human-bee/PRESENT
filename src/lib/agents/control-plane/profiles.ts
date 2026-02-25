import { randomUUID } from 'node:crypto';
import { getAdminSupabaseClient } from '@/lib/agents/admin/supabase-admin';
import { modelControlPatchSchema, type ModelControlProfileUpsertInput } from './schemas';
import type { KnobScope, ModelControlPatch } from './types';

export type ModelControlProfileRow = {
  id: string;
  scope_type: KnobScope;
  scope_id: string;
  task_prefix: string | null;
  enabled: boolean;
  priority: number;
  config: ModelControlPatch;
  version: number;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

type ListProfilesOptions = {
  scopeType?: KnobScope;
  scopeId?: string;
  task?: string;
};

const parsePatch = (value: unknown): ModelControlPatch => {
  const parsed = modelControlPatchSchema.safeParse(value ?? {});
  return parsed.success ? parsed.data : {};
};

const normalizePrefix = (value?: string | null): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
};

const taskPrefixMatches = (task: string | undefined, prefix: string | null): boolean => {
  if (!prefix) return true;
  if (!task || !task.trim()) return false;
  return task.trim().startsWith(prefix);
};

const taskScopeIdMatches = (task: string | undefined, scopeId: string): boolean => {
  if (!task || !task.trim()) return false;
  const normalizedTask = task.trim();
  const normalizedScopeId = scopeId.trim();
  if (!normalizedScopeId) return false;
  if (normalizedScopeId === 'global' || normalizedScopeId === 'task') return true;
  if (normalizedTask === normalizedScopeId) return true;
  return normalizedTask.startsWith(`${normalizedScopeId}.`);
};

export async function listModelControlProfiles(
  options: ListProfilesOptions = {},
): Promise<ModelControlProfileRow[]> {
  const db = getAdminSupabaseClient();
  let query = db
    .from('agent_model_control_profiles')
    .select('id,scope_type,scope_id,task_prefix,enabled,priority,config,version,updated_by,created_at,updated_at')
    .eq('enabled', true);
  if (options.scopeType) {
    query = query.eq('scope_type', options.scopeType);
  }
  if (options.scopeId) {
    query = query.eq('scope_id', options.scopeId);
  }
  const { data, error } = await query.order('priority', { ascending: false }).order('updated_at', { ascending: false });
  if (error) {
    throw new Error(`Failed to list model control profiles: ${error.message}`);
  }
  const rows = (data || []) as ModelControlProfileRow[];
  const task = options.task?.trim();
  return rows.filter((row) => taskPrefixMatches(task, normalizePrefix(row.task_prefix)));
}

export async function getModelControlProfilesForResolution(input: {
  task?: string;
  room?: string;
  userId?: string;
  includeUserScope?: boolean;
}): Promise<ModelControlProfileRow[]> {
  const db = getAdminSupabaseClient();
  const scopeTypes: KnobScope[] = ['global'];
  if (input.task) scopeTypes.push('task');
  if (input.room) scopeTypes.push('room');
  if (input.userId && input.includeUserScope !== false) scopeTypes.push('user');
  const { data, error } = await db
    .from('agent_model_control_profiles')
    .select('id,scope_type,scope_id,task_prefix,enabled,priority,config,version,updated_by,created_at,updated_at')
    .eq('enabled', true)
    .in('scope_type', Array.from(new Set(scopeTypes)))
    .order('priority', { ascending: true })
    .order('updated_at', { ascending: true });
  if (error) {
    throw new Error(`Failed to load model control profiles: ${error.message}`);
  }
  const roomScopeId = input.room?.trim() || null;
  const userScopeId = input.userId?.trim() || null;
  const task = input.task?.trim();
  const scopeRank: Record<KnobScope, number> = {
    global: 0,
    task: 1,
    room: 2,
    user: 3,
  };
  return ((data || []) as ModelControlProfileRow[])
    .filter((row) => {
      if (!taskPrefixMatches(task, normalizePrefix(row.task_prefix))) return false;
      if (row.scope_type === 'global') return row.scope_id === 'global';
      if (row.scope_type === 'room') return Boolean(roomScopeId && row.scope_id === roomScopeId);
      if (row.scope_type === 'user') {
        return Boolean(userScopeId && input.includeUserScope !== false && row.scope_id === userScopeId);
      }
      if (row.scope_type === 'task') {
        return taskScopeIdMatches(task, row.scope_id);
      }
      return false;
    })
    .sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      if (scopeRank[a.scope_type] !== scopeRank[b.scope_type]) {
        return scopeRank[a.scope_type] - scopeRank[b.scope_type];
      }
      const updatedA = Date.parse(a.updated_at);
      const updatedB = Date.parse(b.updated_at);
      if (Number.isFinite(updatedA) && Number.isFinite(updatedB) && updatedA !== updatedB) {
        return updatedA - updatedB;
      }
      return a.id.localeCompare(b.id);
    });
}

export async function upsertModelControlProfile(params: {
  input: ModelControlProfileUpsertInput;
  actorUserId: string;
}): Promise<ModelControlProfileRow> {
  const db = getAdminSupabaseClient();
  const scopeType = params.input.scopeType;
  const scopeId = params.input.scopeId.trim();
  const taskPrefix = normalizePrefix(params.input.taskPrefix ?? null);
  let existingQuery = db
    .from('agent_model_control_profiles')
    .select('id,version,enabled,priority')
    .eq('scope_type', scopeType)
    .eq('scope_id', scopeId);
  existingQuery = taskPrefix ? existingQuery.eq('task_prefix', taskPrefix) : existingQuery.is('task_prefix', null);
  const existing = await existingQuery.maybeSingle();
  if (existing.error && existing.error.code !== 'PGRST116') {
    throw new Error(`Failed to load current profile version: ${existing.error.message}`);
  }
  const nextVersion = (existing.data?.version ?? 0) + 1;
  const row = {
    id: existing.data?.id ?? randomUUID(),
    scope_type: scopeType,
    scope_id: scopeId,
    task_prefix: taskPrefix,
    enabled: params.input.enabled ?? existing.data?.enabled ?? true,
    priority: params.input.priority ?? existing.data?.priority ?? 100,
    config: parsePatch(params.input.config),
    version: nextVersion,
    updated_by: params.actorUserId,
    updated_at: new Date().toISOString(),
  };
  const mutation = existing.data?.id
    ? db.from('agent_model_control_profiles').update(row).eq('id', existing.data.id)
    : db.from('agent_model_control_profiles').insert(row);
  const { data, error } = await mutation
    .select('id,scope_type,scope_id,task_prefix,enabled,priority,config,version,updated_by,created_at,updated_at')
    .single();
  if (error) {
    throw new Error(`Failed to upsert model control profile: ${error.message}`);
  }
  return data as ModelControlProfileRow;
}
