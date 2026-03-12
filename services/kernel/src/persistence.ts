import fs from 'node:fs';
import path from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import {
  approvalRequestSchema,
  artifactSchema,
  executorSessionSchema,
  kernelEventSchema,
  modelProfileSchema,
  presenceMemberSchema,
  taskRunSchema,
  workspaceSessionSchema,
} from '@present/contracts';
import type {
  ApprovalRequest,
  Artifact,
  ExecutorSession,
  KernelEvent,
  ModelProfile,
  PresenceMember,
  TaskRun,
  WorkspaceSession,
} from '@present/contracts';
import type { KernelExecutorLease } from './executor-leases';

const leaseSchema = z.object({
  id: z.string().min(1),
  workspaceSessionId: z.string().min(1),
  identity: z.string().min(1),
  leaseExpiresAt: z.string().min(1),
  updatedAt: z.string().min(1),
});

const resetKernelStateSchema = z.object({
  schemaVersion: z.literal(1),
  workspaces: z.array(workspaceSessionSchema).default([]),
  executors: z.array(executorSessionSchema).default([]),
  leases: z.array(leaseSchema).default([]),
  tasks: z.array(taskRunSchema).default([]),
  artifacts: z.array(artifactSchema).default([]),
  approvals: z.array(approvalRequestSchema).default([]),
  presence: z.array(presenceMemberSchema).default([]),
  modelProfiles: z.array(modelProfileSchema).default([]),
  traces: z.array(kernelEventSchema).default([]),
});

export type ResetKernelState = z.infer<typeof resetKernelStateSchema>;

type ResetCollectionKey =
  | 'workspaces'
  | 'executors'
  | 'leases'
  | 'tasks'
  | 'artifacts'
  | 'approvals'
  | 'presence'
  | 'modelProfiles'
  | 'traces';

type ResetCollectionMap = {
  workspaces: WorkspaceSession;
  executors: ExecutorSession;
  leases: KernelExecutorLease;
  tasks: TaskRun;
  artifacts: Artifact;
  approvals: ApprovalRequest;
  presence: PresenceMember;
  modelProfiles: ModelProfile;
  traces: KernelEvent;
};

type SupabaseRow = Record<string, unknown>;

const resetCollectionTables: Record<ResetCollectionKey, string> = {
  workspaces: 'workspace_sessions',
  executors: 'executor_sessions',
  leases: 'executor_leases',
  tasks: 'task_runs',
  artifacts: 'artifacts',
  approvals: 'approval_requests',
  presence: 'presence_members',
  modelProfiles: 'model_profiles',
  traces: 'reset_trace_events',
};

const supabaseSerializers: { [K in ResetCollectionKey]: (value: ResetCollectionMap[K]) => SupabaseRow } = {
  workspaces: (workspace) => ({
    id: workspace.id,
    workspace_path: workspace.workspacePath,
    branch: workspace.branch,
    title: workspace.title,
    state: workspace.state,
    owner_user_id: workspace.ownerUserId,
    active_executor_session_id: workspace.activeExecutorSessionId,
    metadata: workspace.metadata,
    created_at: workspace.createdAt,
    updated_at: workspace.updatedAt,
  }),
  executors: (executor) => ({
    id: executor.id,
    workspace_session_id: executor.workspaceSessionId,
    identity: executor.identity,
    kind: executor.kind,
    state: executor.state,
    auth_mode: executor.authMode,
    codex_base_url: executor.codexBaseUrl,
    capabilities: executor.capabilities,
    metadata: executor.metadata,
    created_at: executor.createdAt,
    updated_at: executor.updatedAt,
    last_heartbeat_at: executor.lastHeartbeatAt,
  }),
  leases: (lease) => ({
    id: lease.id,
    workspace_session_id: lease.workspaceSessionId,
    identity: lease.identity,
    lease_expires_at: lease.leaseExpiresAt,
    updated_at: lease.updatedAt,
  }),
  tasks: (taskRun) => ({
    id: taskRun.id,
    workspace_session_id: taskRun.workspaceSessionId,
    trace_id: taskRun.traceId,
    task_type: taskRun.taskType,
    status: taskRun.status,
    request_id: taskRun.requestId,
    dedupe_key: taskRun.dedupeKey,
    summary: taskRun.summary,
    result: taskRun.result,
    error: taskRun.error,
    metadata: taskRun.metadata,
    created_at: taskRun.createdAt,
    updated_at: taskRun.updatedAt,
    started_at: taskRun.startedAt,
    completed_at: taskRun.completedAt,
  }),
  artifacts: (artifact) => ({
    id: artifact.id,
    workspace_session_id: artifact.workspaceSessionId,
    trace_id: artifact.traceId,
    kind: artifact.kind,
    title: artifact.title,
    mime_type: artifact.mimeType,
    content: artifact.content,
    metadata: artifact.metadata,
    created_at: artifact.createdAt,
    updated_at: artifact.updatedAt,
  }),
  approvals: (approval) => ({
    id: approval.id,
    workspace_session_id: approval.workspaceSessionId,
    trace_id: approval.traceId,
    task_run_id: approval.taskRunId,
    kind: approval.kind,
    state: approval.state,
    title: approval.title,
    detail: approval.detail,
    requested_by: approval.requestedBy,
    resolved_by: approval.resolvedBy,
    expires_at: approval.expiresAt,
    metadata: approval.metadata,
    created_at: approval.createdAt,
    updated_at: approval.updatedAt,
  }),
  presence: (member) => ({
    id: member.id,
    workspace_session_id: member.workspaceSessionId,
    identity: member.identity,
    display_name: member.displayName,
    state: member.state,
    media: member.media,
    metadata: member.metadata,
    created_at: member.createdAt,
    updated_at: member.updatedAt,
  }),
  modelProfiles: (profile) => ({
    id: profile.id,
    role: profile.role,
    provider: profile.provider,
    model: profile.model,
    label: profile.label,
    source: profile.source,
    is_default: profile.default,
    latency_class: profile.latencyClass,
    supports: profile.supports,
    metadata: profile.metadata,
    created_at: profile.createdAt,
    updated_at: profile.updatedAt,
  }),
  traces: (event) => {
    const { id, traceId, workspaceSessionId, emittedAt, type, ...payload } = event;
    return {
      id,
      trace_id: traceId,
      workspace_session_id: workspaceSessionId,
      event_type: type,
      payload,
      emitted_at: emittedAt,
    };
  },
};

const supabaseDeserializers: { [K in ResetCollectionKey]: (value: SupabaseRow) => ResetCollectionMap[K] } = {
  workspaces: (value) =>
    workspaceSessionSchema.parse({
      id: value.id,
      workspacePath: value.workspace_path,
      branch: value.branch,
      title: value.title,
      state: value.state,
      ownerUserId: value.owner_user_id ?? null,
      activeExecutorSessionId: value.active_executor_session_id ?? null,
      metadata: value.metadata ?? {},
      createdAt: value.created_at,
      updatedAt: value.updated_at,
    }),
  executors: (value) =>
    executorSessionSchema.parse({
      id: value.id,
      workspaceSessionId: value.workspace_session_id,
      identity: value.identity,
      kind: value.kind,
      state: value.state,
      authMode: value.auth_mode,
      codexBaseUrl: value.codex_base_url ?? null,
      capabilities: value.capabilities ?? [],
      metadata: value.metadata ?? {},
      createdAt: value.created_at,
      updatedAt: value.updated_at,
      lastHeartbeatAt: value.last_heartbeat_at ?? null,
    }),
  leases: (value) =>
    leaseSchema.parse({
      id: value.id,
      workspaceSessionId: value.workspace_session_id,
      identity: value.identity,
      leaseExpiresAt: value.lease_expires_at,
      updatedAt: value.updated_at,
    }),
  tasks: (value) =>
    taskRunSchema.parse({
      id: value.id,
      workspaceSessionId: value.workspace_session_id,
      traceId: value.trace_id,
      taskType: value.task_type,
      status: value.status,
      requestId: value.request_id ?? null,
      dedupeKey: value.dedupe_key ?? null,
      summary: value.summary,
      result: value.result ?? null,
      error: value.error ?? null,
      metadata: value.metadata ?? {},
      createdAt: value.created_at,
      updatedAt: value.updated_at,
      startedAt: value.started_at ?? null,
      completedAt: value.completed_at ?? null,
    }),
  artifacts: (value) =>
    artifactSchema.parse({
      id: value.id,
      workspaceSessionId: value.workspace_session_id,
      traceId: value.trace_id ?? null,
      kind: value.kind,
      title: value.title,
      mimeType: value.mime_type,
      content: value.content ?? '',
      metadata: value.metadata ?? {},
      createdAt: value.created_at,
      updatedAt: value.updated_at,
    }),
  approvals: (value) =>
    approvalRequestSchema.parse({
      id: value.id,
      workspaceSessionId: value.workspace_session_id,
      traceId: value.trace_id,
      taskRunId: value.task_run_id ?? null,
      kind: value.kind,
      state: value.state,
      title: value.title,
      detail: value.detail,
      requestedBy: value.requested_by,
      resolvedBy: value.resolved_by ?? null,
      expiresAt: value.expires_at ?? null,
      metadata: value.metadata ?? {},
      createdAt: value.created_at,
      updatedAt: value.updated_at,
    }),
  presence: (value) =>
    presenceMemberSchema.parse({
      id: value.id,
      workspaceSessionId: value.workspace_session_id,
      identity: value.identity,
      displayName: value.display_name,
      state: value.state,
      media: value.media ?? { audio: false, video: false, screen: false },
      metadata: value.metadata ?? {},
      createdAt: value.created_at,
      updatedAt: value.updated_at,
    }),
  modelProfiles: (value) =>
    modelProfileSchema.parse({
      id: value.id,
      role: value.role,
      provider: value.provider,
      model: value.model,
      label: value.label,
      source: value.source,
      default: value.is_default,
      latencyClass: value.latency_class,
      supports: value.supports ?? [],
      metadata: value.metadata ?? {},
      createdAt: value.created_at,
      updatedAt: value.updated_at,
    }),
  traces: (value) => {
    const payload = typeof value.payload === 'object' && value.payload ? (value.payload as SupabaseRow) : {};
    return kernelEventSchema.parse({
      ...payload,
      id: value.id,
      traceId: value.trace_id,
      workspaceSessionId: value.workspace_session_id,
      emittedAt: value.emitted_at,
      type: value.event_type,
    });
  },
};

const defaultResetKernelState = (): ResetKernelState => ({
  schemaVersion: 1,
  workspaces: [],
  executors: [],
  leases: [],
  tasks: [],
  artifacts: [],
  approvals: [],
  presence: [],
  modelProfiles: [],
  traces: [],
});

let cachedSupabase: SupabaseClient | null | undefined;
let hydrationPromise: Promise<ResetKernelState> | null = null;
let hasHydratedFromSupabase = false;
let lastSupabaseHydratedAt = 0;
const pendingMirrorWrites = new Set<Promise<void>>();
let warningKeys = new Set<string>();

const getStatePath = () =>
  process.env.PRESENT_RESET_STATE_PATH ?? path.join(process.cwd(), '.tmp', 'present-reset-state.json');

const getSupabaseCacheTtlMs = () => {
  const rawValue = Number(process.env.PRESENT_RESET_SUPABASE_CACHE_TTL_MS ?? '2000');
  if (!Number.isFinite(rawValue) || rawValue < 0) {
    return 2000;
  }
  return rawValue;
};

const ensureParentDirectory = (statePath: string) => {
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
};

const backupUnreadableState = (statePath: string, detail: string) => {
  const backupPath = `${statePath}.invalid-${Date.now()}.json`;
  try {
    ensureParentDirectory(statePath);
    fs.copyFileSync(statePath, backupPath);
    warnOnce(
      `state:invalid:${statePath}`,
      `[present-reset] Reset state at ${statePath} could not be read (${detail}). Backed up to ${backupPath} and continuing with a fresh cache.`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    warnOnce(
      `state:invalid:${statePath}`,
      `[present-reset] Reset state at ${statePath} could not be read (${detail}), and backup failed: ${message}. Continuing with a fresh cache.`,
    );
  }
};

const warnOnce = (key: string, message: string) => {
  if (warningKeys.has(key)) return;
  warningKeys.add(key);
  console.warn(message);
};

const getSupabase = () => {
  if (cachedSupabase !== undefined) {
    return cachedSupabase;
  }

  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    cachedSupabase = null;
    return cachedSupabase;
  }

  cachedSupabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return cachedSupabase;
};

const readPersistedState = (): ResetKernelState => {
  const statePath = getStatePath();
  if (!fs.existsSync(statePath)) return defaultResetKernelState();

  try {
    const text = fs.readFileSync(statePath, 'utf8');
    if (!text.trim()) return defaultResetKernelState();
    const parsed = resetKernelStateSchema.safeParse(JSON.parse(text));
    if (parsed.success) {
      return parsed.data;
    }
    backupUnreadableState(statePath, parsed.error.issues[0]?.message ?? 'schema validation failed');
    return defaultResetKernelState();
  } catch (error) {
    backupUnreadableState(
      statePath,
      error instanceof Error ? error.message : 'unknown parse failure',
    );
    return defaultResetKernelState();
  }
};

const writePersistedState = (state: ResetKernelState) => {
  const statePath = getStatePath();
  ensureParentDirectory(statePath);
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf8');
};

const loadCollectionFromSupabase = async <K extends ResetCollectionKey>(key: K): Promise<ResetCollectionMap[K][] | null> => {
  const supabase = getSupabase();
  if (!supabase) return null;

  const result = await supabase.from(resetCollectionTables[key]).select('*');
  if (result.error) {
    warnOnce(
      `hydrate:${key}`,
      `[present-reset] Supabase hydration failed for ${resetCollectionTables[key]}: ${result.error.message}`,
    );
    return null;
  }

  return (result.data ?? []).map((entry) => supabaseDeserializers[key](entry as SupabaseRow));
};

const mirrorResetCollection = async <K extends ResetCollectionKey>(key: K, value: ResetCollectionMap[K][]) => {
  const supabase = getSupabase();
  if (!supabase) return;

  const table = resetCollectionTables[key];
  const payload = value.map((entry) => supabaseSerializers[key](entry));
  const upsertResult = await supabase.from(table).upsert(payload, { onConflict: 'id' });
  if (upsertResult.error) {
    warnOnce(`mirror:${key}`, `[present-reset] Supabase mirror failed for ${table}: ${upsertResult.error.message}`);
    return;
  }

  if (!hasHydratedFromSupabase) return;

  const existingIds = await supabase.from(table).select('id');
  if (existingIds.error) {
    warnOnce(
      `mirror:select:${key}`,
      `[present-reset] Supabase stale-row scan failed for ${table}: ${existingIds.error.message}`,
    );
    return;
  }

  const nextIds = new Set(payload.map((entry) => String(entry.id)));
  const staleIds = (existingIds.data ?? [])
    .map((entry) => String((entry as { id: string }).id))
    .filter((entryId) => !nextIds.has(entryId));
  if (!staleIds.length) return;

  const deleteResult = await supabase.from(table).delete().in('id', staleIds);
  if (deleteResult.error) {
    warnOnce(
      `mirror:delete:${key}`,
      `[present-reset] Supabase delete sync failed for ${table}: ${deleteResult.error.message}`,
    );
  }
};

const scheduleMirror = <K extends ResetCollectionKey>(key: K, value: ResetCollectionMap[K][]) => {
  if (!getSupabase()) return;

  const promise = mirrorResetCollection(key, value)
    .catch((error) => {
      warnOnce(
        `mirror:throw:${key}`,
        `[present-reset] Supabase mirror threw for ${key}: ${error instanceof Error ? error.message : String(error)}`,
      );
    })
    .finally(() => {
      pendingMirrorWrites.delete(promise);
    });

  pendingMirrorWrites.add(promise);
};

export const readResetKernelState = () => readPersistedState();

export async function ensureResetKernelHydrated(input: { force?: boolean } = {}) {
  const cacheExpired =
    hasHydratedFromSupabase &&
    getSupabase() &&
    Date.now() - lastSupabaseHydratedAt >= getSupabaseCacheTtlMs();

  if (hasHydratedFromSupabase && !input.force && !cacheExpired) {
    return readPersistedState();
  }
  if (!getSupabase()) {
    return readPersistedState();
  }
  if (hydrationPromise && !input.force) {
    return hydrationPromise;
  }

  hydrationPromise = (async () => {
    const localState = readPersistedState();
    const nextState = defaultResetKernelState();
    const mutableState = nextState as Record<ResetCollectionKey, unknown>;
    const localCollections = localState as Record<ResetCollectionKey, unknown>;

    for (const key of Object.keys(resetCollectionTables) as ResetCollectionKey[]) {
      const hydratedValue = (await loadCollectionFromSupabase(key)) ?? localCollections[key];
      mutableState[key] = hydratedValue;
    }

    const parsed = resetKernelStateSchema.parse(nextState);
    writePersistedState(parsed);
    hasHydratedFromSupabase = true;
    lastSupabaseHydratedAt = Date.now();
    return parsed;
  })().finally(() => {
    hydrationPromise = null;
  });

  return hydrationPromise;
}

export function mutateResetKernelState<T>(mutator: (state: ResetKernelState) => T) {
  const state = readPersistedState();
  const result = mutator(state);
  writePersistedState(resetKernelStateSchema.parse(state));
  return result;
}

export function readResetCollection<K extends ResetCollectionKey>(key: K): ResetCollectionMap[K][] {
  return [...readPersistedState()[key]] as ResetCollectionMap[K][];
}

export function writeResetCollection<K extends ResetCollectionKey>(key: K, value: ResetCollectionMap[K][]) {
  const nextValue = mutateResetKernelState((state) => {
    state[key] = [...value] as unknown as ResetKernelState[K];
    return state[key];
  });
  scheduleMirror(key, value);
  return nextValue;
}

export async function flushResetPersistenceMirrors() {
  if (!pendingMirrorWrites.size) return;
  await Promise.allSettled([...pendingMirrorWrites]);
}

export function resetKernelStateForTests() {
  const statePath = getStatePath();
  if (fs.existsSync(statePath)) {
    fs.rmSync(statePath, { force: true });
  }
  cachedSupabase = undefined;
  hydrationPromise = null;
  hasHydratedFromSupabase = false;
  lastSupabaseHydratedAt = 0;
  warningKeys = new Set<string>();
  pendingMirrorWrites.clear();
}

export function getResetKernelStatePath() {
  return getStatePath();
}
