import { createClient } from '@supabase/supabase-js';
import { AgentTaskQueue, type AgentTask } from '@/lib/agents/shared/queue';
import { taskRunSchema, type TaskRun } from '@present/contracts';
import { createResetId, RESET_ID_PREFIXES } from './ids';
import { readResetCollection, writeResetCollection } from './persistence';
import { createTraceId, recordKernelEvent } from './traces';

const getSupabase = () => {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
};

const listPersistedTasks = () =>
  readResetCollection('tasks').sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));

const saveTaskRun = (taskRun: TaskRun) => {
  writeResetCollection(
    'tasks',
    [...listPersistedTasks().filter((entry) => entry.id !== taskRun.id), taskRun].sort((left, right) =>
      right.updatedAt.localeCompare(left.updatedAt),
    ),
  );
  return taskRun;
};

const mapAgentTaskToTaskRun = (workspaceSessionId: string, agentTask: AgentTask, summary: string) =>
  taskRunSchema.parse({
    id: agentTask.id,
    workspaceSessionId,
    traceId: agentTask.trace_id ?? createTraceId(),
    taskType: agentTask.task,
    status: agentTask.status,
    requestId: agentTask.request_id,
    dedupeKey: agentTask.dedupe_key,
    summary,
    createdAt: agentTask.created_at,
    updatedAt: agentTask.updated_at,
    startedAt: agentTask.status === 'running' ? agentTask.updated_at : null,
    completedAt: agentTask.status === 'succeeded' || agentTask.status === 'failed' ? agentTask.updated_at : null,
    result: agentTask.result,
    error: agentTask.error,
    metadata: {
      priority: agentTask.priority,
      room: agentTask.room,
      resourceKeys: agentTask.resource_keys,
    },
  });

export function createTaskRun(input: {
  workspaceSessionId: string;
  summary: string;
  taskType: string;
  traceId?: string;
  requestId?: string;
  dedupeKey?: string;
  status?: TaskRun['status'];
  metadata?: Record<string, unknown>;
}) {
  const now = new Date().toISOString();
  const taskRun = taskRunSchema.parse({
    id: createResetId(RESET_ID_PREFIXES.taskRun),
    workspaceSessionId: input.workspaceSessionId,
    traceId: input.traceId ?? createTraceId(),
    taskType: input.taskType,
    status: input.status ?? 'queued',
    requestId: input.requestId ?? null,
    dedupeKey: input.dedupeKey ?? null,
    summary: input.summary,
    createdAt: now,
    updatedAt: now,
    startedAt: input.status === 'running' ? now : null,
    completedAt: null,
    result: null,
    error: null,
    metadata: input.metadata ?? {},
  });
  saveTaskRun(taskRun);
  return taskRun;
}

export async function enqueueTaskRun(input: {
  workspaceSessionId: string;
  summary: string;
  taskType: string;
  room?: string;
  params?: Record<string, unknown>;
  requestId?: string;
  dedupeKey?: string;
}) {
  const traceId = createTraceId();
  const queue = new AgentTaskQueue();
  try {
    const queued = await queue.enqueueTask({
      room: input.room ?? input.workspaceSessionId,
      task: input.taskType,
      params: {
        workspaceSessionId: input.workspaceSessionId,
        traceId,
        ...(input.params ?? {}),
      },
      requestId: input.requestId,
      dedupeKey: input.dedupeKey,
      resourceKeys: [`workspace:${input.workspaceSessionId}`],
    });
    if (queued) {
      const taskRun = saveTaskRun(mapAgentTaskToTaskRun(input.workspaceSessionId, queued, input.summary));
      recordKernelEvent({
        type: 'turn.started',
        traceId: taskRun.traceId,
        workspaceSessionId: taskRun.workspaceSessionId,
        taskRunId: taskRun.id,
        title: taskRun.summary,
        detail: null,
        metadata: taskRun.metadata,
      });
      return taskRun;
    }
  } catch {
    // Fall through to local task record when queue access is unavailable.
  }

  const taskRun = createTaskRun({
    workspaceSessionId: input.workspaceSessionId,
    summary: input.summary,
    taskType: input.taskType,
    traceId,
    requestId: input.requestId,
    dedupeKey: input.dedupeKey,
    metadata: input.params ?? {},
  });

  recordKernelEvent({
    type: 'turn.started',
    traceId: taskRun.traceId,
    workspaceSessionId: taskRun.workspaceSessionId,
    taskRunId: taskRun.id,
    title: taskRun.summary,
    detail: 'Queued in local reset fallback.',
    metadata: taskRun.metadata,
  });

  return taskRun;
}

export function updateTaskRun(
  taskRunId: string,
  patch: Partial<Omit<TaskRun, 'id' | 'workspaceSessionId' | 'traceId' | 'createdAt'>>,
) {
  const current = listPersistedTasks().find((task) => task.id === taskRunId);
  if (!current) return null;

  const next = taskRunSchema.parse({
    ...current,
    ...patch,
    metadata: {
      ...current.metadata,
      ...(patch.metadata ?? {}),
    },
    updatedAt: new Date().toISOString(),
  });

  saveTaskRun(next);
  return next;
}

export function startTaskRun(taskRunId: string, metadata?: Record<string, unknown>) {
  return updateTaskRun(taskRunId, {
    status: 'running',
    startedAt: new Date().toISOString(),
    error: null,
    metadata,
  });
}

export function completeTaskRun(taskRunId: string, result: Record<string, unknown>) {
  const taskRun = updateTaskRun(taskRunId, {
    status: 'succeeded',
    completedAt: new Date().toISOString(),
    result,
    error: null,
  });
  if (!taskRun) return null;
  recordKernelEvent({
    type: 'turn.completed',
    traceId: taskRun.traceId,
    workspaceSessionId: taskRun.workspaceSessionId,
    taskRunId: taskRun.id,
    title: taskRun.summary,
    detail: typeof result.finalResponse === 'string' ? (result.finalResponse as string) : null,
    metadata: result,
  });
  return taskRun;
}

export function failTaskRun(taskRunId: string, error: string, metadata?: Record<string, unknown>) {
  const taskRun = updateTaskRun(taskRunId, {
    status: 'failed',
    completedAt: new Date().toISOString(),
    error,
    metadata,
  });
  if (!taskRun) return null;
  recordKernelEvent({
    type: 'turn.failed',
    traceId: taskRun.traceId,
    workspaceSessionId: taskRun.workspaceSessionId,
    taskRunId: taskRun.id,
    title: taskRun.summary,
    detail: error,
    metadata: metadata ?? {},
  });
  return taskRun;
}

export async function getTaskRun(taskRunId: string) {
  const persisted = listPersistedTasks().find((task) => task.id === taskRunId);
  const supabase = getSupabase();
  if (!supabase) return persisted ?? null;

  const { data } = await supabase
    .from('agent_tasks')
    .select('*')
    .eq('id', taskRunId)
    .maybeSingle<AgentTask>();
  if (!data) return persisted ?? null;

  const workspaceSessionId =
    typeof data.params?.workspaceSessionId === 'string'
      ? (data.params.workspaceSessionId as string)
      : persisted?.workspaceSessionId ?? data.room;
  const summary =
    typeof data.params?.summary === 'string' ? (data.params.summary as string) : persisted?.summary ?? data.task;
  return saveTaskRun(mapAgentTaskToTaskRun(workspaceSessionId, data, summary));
}

export function listTaskRuns(workspaceSessionId?: string) {
  return listPersistedTasks().filter((task) => !workspaceSessionId || task.workspaceSessionId === workspaceSessionId);
}
