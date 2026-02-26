import { setTimeout as delay } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import { AgentTaskQueue, type AgentTask } from '@/lib/agents/shared/queue';
import type { JsonObject } from '@/lib/utils/json-schema';
import { createLogger } from '@/lib/logging';
import { MutationArbiter } from './mutation-arbiter';
import {
  deriveDefaultLockKey,
  extractOrchestrationEnvelope,
} from '@/lib/agents/shared/orchestration-envelope';
import {
  getOrchestrationMetricsSnapshot,
  incrementOrchestrationCounter,
  recordOrchestrationTiming,
} from '@/lib/agents/shared/orchestration-metrics';
import { recordTaskTraceFromParams, recordWorkerHeartbeat } from '@/lib/agents/shared/trace-events';
import { deriveRequestCorrelation } from '@/lib/agents/shared/request-correlation';
import { recordToolIoEvent } from '@/lib/agents/shared/replay-telemetry';
import { deriveProviderParity } from '@/lib/agents/admin/provider-parity';
import {
  extractRuntimeScopeFromParams,
  hasRuntimeScopeMismatch,
  getWorkerHostSkipResourceKey,
  isLocalRuntimeScope,
  resolveRuntimeScopeFromEnv,
} from '@/lib/agents/shared/runtime-scope';
import { resolveModelControl } from '@/lib/agents/control-plane/resolver';

type ConductorRuntimeSettings = {
  roomConcurrency: number;
  taskLeaseTtlMs: number;
  taskIdlePollMs: number;
  taskIdlePollMaxMs: number;
  taskMaxRetryAttempts: number;
  taskRetryBaseDelayMs: number;
  taskRetryMaxDelayMs: number;
  taskRetryJitterRatio: number;
};

const clampInt = (value: unknown, fallback: number, min: number, max: number): number => {
  const parsed =
    typeof value === 'string' ? Number.parseInt(value, 10) : typeof value === 'number' ? value : Number.NaN;
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
};

const clampFloat = (value: unknown, fallback: number, min: number, max: number): number => {
  const parsed =
    typeof value === 'string' ? Number.parseFloat(value) : typeof value === 'number' ? value : Number.NaN;
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
};

const DEFAULT_CONDUCTOR_SETTINGS: ConductorRuntimeSettings = {
  roomConcurrency: Math.max(1, Number.parseInt(process.env.ROOM_CONCURRENCY ?? '2', 10) || 2),
  taskLeaseTtlMs: clampInt(process.env.TASK_LEASE_TTL_MS, 15_000, 500, 300_000),
  taskIdlePollMs: clampInt(process.env.TASK_IDLE_POLL_MS, 500, 5, 60_000),
  taskIdlePollMaxMs: clampInt(process.env.TASK_IDLE_POLL_MAX_MS, 1_000, 10, 120_000),
  taskMaxRetryAttempts: clampInt(process.env.TASK_MAX_RETRY_ATTEMPTS, 5, 1, 30),
  taskRetryBaseDelayMs: clampInt(process.env.TASK_RETRY_BASE_DELAY_MS, 1_000, 100, 120_000),
  taskRetryMaxDelayMs: clampInt(process.env.TASK_RETRY_MAX_DELAY_MS, 15_000, 100, 300_000),
  taskRetryJitterRatio: clampFloat(process.env.TASK_RETRY_JITTER_RATIO, 0.2, 0, 0.9),
};

const CONDUCTOR_SETTINGS_REFRESH_MS = clampInt(
  process.env.MODEL_CONTROL_CONDUCTOR_REFRESH_MS,
  30_000,
  5_000,
  300_000,
);

let conductorSettings: ConductorRuntimeSettings = {
  ...DEFAULT_CONDUCTOR_SETTINGS,
  taskRetryMaxDelayMs: Math.max(
    DEFAULT_CONDUCTOR_SETTINGS.taskRetryBaseDelayMs,
    DEFAULT_CONDUCTOR_SETTINGS.taskRetryMaxDelayMs,
  ),
};
let conductorSettingsRefreshAt = 0;
let conductorSettingsRefreshInFlight: Promise<void> | null = null;

const WORKER_HEARTBEAT_MS = Number(process.env.AGENT_WORKER_HEARTBEAT_MS ?? 5_000);
const TASK_SCOPE_MISMATCH_REQUEUE_DELAY_MS = Math.max(
  100,
  Number.parseInt(process.env.TASK_SCOPE_MISMATCH_REQUEUE_DELAY_MS ?? '300', 10) || 300,
);

const queue = new AgentTaskQueue();
const logger = createLogger('agents:conductor:worker');
const mutationArbiter = new MutationArbiter();
const workerId = process.env.AGENT_WORKER_ID || `conductor-${process.pid}-${randomUUID().slice(0, 8)}`;
const workerHost = os.hostname();
const workerPid = String(process.pid);
const workerRuntimeScope = resolveRuntimeScopeFromEnv();
const workerHandlesLocalScopeDirectClaim =
  (process.env.AGENT_LOCAL_SCOPE_TASK_ISOLATION ?? process.env.AGENT_LOCAL_SCOPE_FAIRY_ISOLATION ?? 'true') !==
    'false' && isLocalRuntimeScope(workerRuntimeScope);
const workerHostSkipResourceKey = getWorkerHostSkipResourceKey(workerHost);
const additionalClaimResourceLocks = String(process.env.AGENT_WORKER_RESOURCE_LOCKS ?? '')
  .split(',')
  .map((entry) => entry.trim())
  .filter(Boolean);
const workerClaimResourceLocks = Array.from(
  new Set([workerHostSkipResourceKey, ...additionalClaimResourceLocks]),
);
let activeTaskCount = 0;
let leasedTaskCount = 0;
type RoomLaneState = {
  active: number;
  waiters: Array<() => void>;
};
const roomLaneStates = new Map<string, RoomLaneState>();

const conductorSettingsEqual = (
  a: ConductorRuntimeSettings,
  b: ConductorRuntimeSettings,
): boolean =>
  a.roomConcurrency === b.roomConcurrency &&
  a.taskLeaseTtlMs === b.taskLeaseTtlMs &&
  a.taskIdlePollMs === b.taskIdlePollMs &&
  a.taskIdlePollMaxMs === b.taskIdlePollMaxMs &&
  a.taskMaxRetryAttempts === b.taskMaxRetryAttempts &&
  a.taskRetryBaseDelayMs === b.taskRetryBaseDelayMs &&
  a.taskRetryMaxDelayMs === b.taskRetryMaxDelayMs &&
  a.taskRetryJitterRatio === b.taskRetryJitterRatio;

const normalizeConductorSettings = (
  defaults: ConductorRuntimeSettings,
  knobs: Record<string, unknown> | undefined,
): ConductorRuntimeSettings => {
  const next: ConductorRuntimeSettings = {
    roomConcurrency: clampInt(knobs?.roomConcurrency, defaults.roomConcurrency, 1, 256),
    taskLeaseTtlMs: clampInt(knobs?.taskLeaseTtlMs, defaults.taskLeaseTtlMs, 500, 300_000),
    taskIdlePollMs: clampInt(knobs?.taskIdlePollMs, defaults.taskIdlePollMs, 5, 60_000),
    taskIdlePollMaxMs: clampInt(knobs?.taskIdlePollMaxMs, defaults.taskIdlePollMaxMs, 10, 120_000),
    taskMaxRetryAttempts: clampInt(knobs?.taskMaxRetryAttempts, defaults.taskMaxRetryAttempts, 1, 30),
    taskRetryBaseDelayMs: clampInt(knobs?.taskRetryBaseDelayMs, defaults.taskRetryBaseDelayMs, 100, 120_000),
    taskRetryMaxDelayMs: clampInt(knobs?.taskRetryMaxDelayMs, defaults.taskRetryMaxDelayMs, 100, 300_000),
    taskRetryJitterRatio: clampFloat(knobs?.taskRetryJitterRatio, defaults.taskRetryJitterRatio, 0, 0.9),
  };
  next.taskRetryMaxDelayMs = Math.max(next.taskRetryBaseDelayMs, next.taskRetryMaxDelayMs);
  return next;
};

const refreshConductorRuntimeSettings = async (force = false): Promise<void> => {
  const now = Date.now();
  if (!force && now < conductorSettingsRefreshAt) {
    return;
  }
  if (conductorSettingsRefreshInFlight) {
    return conductorSettingsRefreshInFlight;
  }
  conductorSettingsRefreshInFlight = (async () => {
    try {
      const resolved = await resolveModelControl(
        {
          task: 'conductor.worker',
          includeUserScope: false,
        },
        { skipCache: true },
      );
      const resolvedKnobs =
        resolved.effective.knobs?.conductor && typeof resolved.effective.knobs.conductor === 'object'
          ? (resolved.effective.knobs.conductor as unknown as Record<string, unknown>)
          : undefined;
      const next = normalizeConductorSettings(DEFAULT_CONDUCTOR_SETTINGS, resolvedKnobs);
      if (!conductorSettingsEqual(conductorSettings, next)) {
        logger.info('updated conductor runtime settings from model control plane', {
          previous: conductorSettings,
          next,
          configVersion: resolved.configVersion,
        });
        conductorSettings = next;
      }
    } catch (error) {
      logger.warn('failed to refresh conductor runtime settings', {
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      conductorSettingsRefreshAt = Date.now() + CONDUCTOR_SETTINGS_REFRESH_MS;
      conductorSettingsRefreshInFlight = null;
    }
  })();
  return conductorSettingsRefreshInFlight;
};

const computeTaskRetryDelayMs = (attempt: number): number => {
  const exponent = Math.max(0, attempt - 1);
  const base = Math.min(
    conductorSettings.taskRetryMaxDelayMs,
    conductorSettings.taskRetryBaseDelayMs * 2 ** exponent,
  );
  if (conductorSettings.taskRetryJitterRatio <= 0 || base <= 0) {
    return Math.round(base);
  }
  const jitter = base * conductorSettings.taskRetryJitterRatio;
  return Math.max(0, Math.round(base - jitter + Math.random() * jitter * 2));
};

type ExecuteTaskFn = (taskName: string, params: JsonObject) => Promise<unknown>;
type ClaimedTask = {
  task: AgentTask;
  leaseToken: string;
  stopLeaseExtender: () => void;
  claimMode: 'rpc' | 'local_scope_direct_claim';
};

const normalizeString = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const normalizeTaskResourceKeys = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => normalizeString(entry))
    .filter((entry): entry is string => Boolean(entry));
};

const asRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
};

const describeUnknownError = (error: unknown): {
  message: string;
  stack?: string;
  detail?: string;
} => {
  if (error instanceof Error) {
    let detail: string | undefined;
    const extra = error as Error & { cause?: unknown };
    if (typeof extra.cause !== 'undefined') {
      try {
        detail = JSON.stringify(extra.cause);
      } catch {
        detail = String(extra.cause);
      }
    }
    return { message: error.message, stack: error.stack, ...(detail ? { detail } : {}) };
  }
  try {
    const detail = JSON.stringify(error);
    return { message: detail, detail };
  } catch {
    const detail = String(error);
    return { message: detail, detail };
  }
};

const deriveRuntimeProviderHint = (
  taskName: string,
  result: unknown,
): {
  provider?: string;
  model?: string;
  providerSource?: string;
  providerPath?: string;
  providerRequestId?: string;
} => {
  const resultRecord = asRecord(result);
  const outputRecord = asRecord(resultRecord?.output ?? resultRecord);
  const traceRecord = asRecord(resultRecord?._trace) ?? asRecord(outputRecord?._trace);
  if (traceRecord) {
    return {
      provider: normalizeString(traceRecord.provider) ?? undefined,
      model: normalizeString(traceRecord.model) ?? undefined,
      providerSource: normalizeString(traceRecord.providerSource) ?? normalizeString(traceRecord.provider_source) ?? undefined,
      providerPath: normalizeString(traceRecord.providerPath) ?? normalizeString(traceRecord.provider_path) ?? undefined,
      providerRequestId: normalizeString(traceRecord.providerRequestId) ?? normalizeString(traceRecord.provider_request_id) ?? undefined,
    };
  }

  const normalizedTask = taskName.toLowerCase();
  if (normalizedTask.startsWith('search.')) {
    return {
      provider: 'openai',
      providerSource: 'runtime_selected',
      providerPath: 'primary',
      model:
        process.env.CANVAS_STEWARD_SEARCH_MODEL ||
        process.env.DEBATE_STEWARD_SEARCH_MODEL ||
        'gpt-5-mini',
    };
  }

  if (normalizedTask.startsWith('flowchart.')) {
    return {
      provider: 'openai',
      providerSource: 'runtime_selected',
      providerPath: 'primary',
      model: 'gpt-5-mini',
    };
  }

  if (normalizedTask.startsWith('scorecard.')) {
    if (
      normalizedTask === 'scorecard.fact_check' ||
      normalizedTask === 'scorecard.verify' ||
      normalizedTask === 'scorecard.refute'
    ) {
      return {
        provider: 'openai',
        providerSource: 'runtime_selected',
        providerPath: 'primary',
      };
    }

    const fastStatus = normalizeString(outputRecord?.status)?.toLowerCase();
    if (fastStatus === 'ok' || fastStatus === 'no_change' || fastStatus === 'error') {
      return {
        provider: 'cerebras',
        providerSource: 'runtime_selected',
        providerPath: 'fast',
        model: process.env.DEBATE_STEWARD_FAST_MODEL || undefined,
      };
    }

    return {
      provider: 'openai',
      providerSource: 'runtime_selected',
      providerPath: 'primary',
    };
  }

  return {};
};

const classifyTaskRoute = (taskName: string): 'visual' | 'widget-lifecycle' | 'research' | 'livekit' | 'mcp' | 'other' => {
  if (taskName.startsWith('canvas.') || taskName.startsWith('fairy.')) return 'visual';
  if (taskName.startsWith('search.') || taskName.startsWith('scorecard.')) return 'research';
  if (taskName.startsWith('livekit.') || taskName.includes('livekit')) return 'livekit';
  if (taskName.startsWith('mcp.') || taskName.includes('mcp')) return 'mcp';
  if (taskName.includes('component')) return 'widget-lifecycle';
  return 'other';
};

const verifyTaskContract = (
  taskName: string,
  params: JsonObject,
  result: unknown,
): { ok: boolean; reason?: string } => {
  const paramsRecord = params as Record<string, unknown>;
  const resultRecord = asRecord(result);
  const resultStatus = normalizeString(resultRecord?.status)?.toLowerCase();
  if (taskName === 'canvas.agent_prompt') {
    const nestedParams =
      paramsRecord.params && typeof paramsRecord.params === 'object'
        ? (paramsRecord.params as Record<string, unknown>)
        : null;
    const message =
      typeof paramsRecord.message === 'string'
        ? paramsRecord.message.trim()
        : typeof nestedParams?.message === 'string'
          ? nestedParams.message.trim()
          : '';
    if (!message) {
      return { ok: false, reason: 'canvas.agent_prompt requires message' };
    }
    if (resultStatus === 'skipped') {
      const skipReason = normalizeString(resultRecord?.reason)?.toLowerCase();
      if (skipReason === 'server_canvas_steward_disabled') {
        return { ok: true };
      }
      return { ok: false, reason: 'canvas.agent_prompt was skipped before steward execution' };
    }
  }
  if (taskName.startsWith('canvas.') && resultStatus === 'skipped') {
    return { ok: true };
  }
  if (taskName.startsWith('scorecard.')) {
    const componentId =
      typeof paramsRecord.componentId === 'string'
        ? paramsRecord.componentId.trim()
        : '';
    if (!componentId) {
      return { ok: false, reason: 'scorecard task requires componentId' };
    }
  }
  if (result === undefined) {
    return { ok: false, reason: 'task returned undefined' };
  }
  return { ok: true };
};

function createLeaseExtender(taskId: string, leaseToken: string) {
  const intervalMs = Math.max(1_000, Math.floor(conductorSettings.taskLeaseTtlMs * 0.6));
  let stopped = false;

  const intervalId = setInterval(() => {
    if (stopped) return;
    void queue.extendLease(taskId, leaseToken, conductorSettings.taskLeaseTtlMs).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn('failed to extend lease', { taskId, error: message });
    });
  }, intervalMs);

  return () => {
    stopped = true;
    clearInterval(intervalId);
  };
}

async function acquireRoomSlot(roomKey: string): Promise<() => void> {
  const state = roomLaneStates.get(roomKey) ?? { active: 0, waiters: [] };
  if (!roomLaneStates.has(roomKey)) {
    roomLaneStates.set(roomKey, state);
  }

  if (state.active >= conductorSettings.roomConcurrency) {
    await new Promise<void>((resolve) => {
      state.waiters.push(resolve);
    });
  }

  state.active += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    state.active = Math.max(0, state.active - 1);
    const next = state.waiters.shift();
    if (next) {
      next();
      return;
    }
    if (state.active === 0) {
      roomLaneStates.delete(roomKey);
    }
  };
}

async function processClaimedTasks(executeTask: ExecuteTaskFn, claimedTasks: ClaimedTask[]) {
  const roomBuckets = claimedTasks.reduce<Record<string, ClaimedTask[]>>((acc, claimed) => {
    const resourceKeys = normalizeTaskResourceKeys(claimed.task.resource_keys);
    const roomKey =
      resourceKeys.find((key) => key.startsWith('room:')) || 'room:default';
    if (!acc[roomKey]) acc[roomKey] = [];
    acc[roomKey].push(claimed);
    return acc;
  }, {});

  await Promise.allSettled(
    Object.entries(roomBuckets).map(async ([roomKey, roomTasks]) => {
      const queueList = [...roomTasks];
      const workers = Array.from({ length: conductorSettings.roomConcurrency }).map(async () => {
        while (queueList.length > 0) {
          const claimed = queueList.shift();
          if (!claimed) break;

          const { task, leaseToken, stopLeaseExtender, claimMode } = claimed;
          const releaseRoomSlot = await acquireRoomSlot(roomKey);
          let route: ReturnType<typeof classifyTaskRoute> = classifyTaskRoute(task.task);
          let lockKey: string | null = null;
          let countedActiveTask = false;
          const executingProviderParity = deriveProviderParity({
            task: task.task,
            status: 'running',
            params: task.params,
          });
          const taskCorrelation = deriveRequestCorrelation({
            task: task.task,
            requestId: task.request_id ?? undefined,
            params: task.params,
          });
          const replayRequestId = taskCorrelation.requestId ?? task.request_id ?? task.id;
          const replayTraceId = taskCorrelation.traceId ?? task.trace_id ?? replayRequestId;
          const replayIntentId = taskCorrelation.intentId ?? replayRequestId;

          try {
            const taskResourceKeys = normalizeTaskResourceKeys(task.resource_keys);
            const taskRuntimeScope = extractRuntimeScopeFromParams(task.params);
            if (hasRuntimeScopeMismatch(taskRuntimeScope, workerRuntimeScope)) {
              const existingKeys = taskResourceKeys;
              const nextResourceKeys = Array.from(new Set([...existingKeys, workerHostSkipResourceKey]));
              const retryAt = new Date(Date.now() + TASK_SCOPE_MISMATCH_REQUEUE_DELAY_MS);
              await queue.requeueTask(task.id, leaseToken, {
                runAt: retryAt,
                error: null,
                resourceKeys: nextResourceKeys,
              });
              void recordTaskTraceFromParams({
                stage: 'claimed',
                status: 'scope_mismatch_requeued',
                taskId: task.id,
                task: task.task,
                room: task.room,
                params: task.params,
                attempt: task.attempt,
                payload: {
                  workerId,
                  workerHost,
                  workerPid,
                  taskRuntimeScope,
                  workerRuntimeScope,
                  skipKey: workerHostSkipResourceKey,
                  retryAt: retryAt.toISOString(),
                },
              });
              logger.info('requeued task after runtime scope mismatch', {
                taskId: task.id,
                room: task.room,
                task: task.task,
                taskRuntimeScope,
                workerRuntimeScope,
                skipKey: workerHostSkipResourceKey,
                retryAt: retryAt.toISOString(),
              });
              continue;
            }
            activeTaskCount += 1;
            countedActiveTask = true;
            route = classifyTaskRoute(task.task);
            recordToolIoEvent({
              source: 'conductor_worker',
              eventType: 'task_execute',
              status: 'running',
              sequence: task.attempt,
              sessionId: `conductor-${workerId}`,
              room: task.room,
              traceId: replayTraceId ?? undefined,
              requestId: replayRequestId ?? undefined,
              intentId: replayIntentId ?? undefined,
              taskId: task.id,
              toolName: task.task,
              toolCallId: task.id,
              provider: executingProviderParity.provider,
              model: executingProviderParity.model ?? undefined,
              providerSource: executingProviderParity.providerSource,
              providerPath: executingProviderParity.providerPath,
              providerRequestId: executingProviderParity.providerRequestId ?? undefined,
              input: task.params,
              metadata: {
                workerId,
                workerHost,
                workerPid,
                leaseToken,
                route,
              },
            });
            void recordTaskTraceFromParams({
              stage: 'executing',
              status: 'running',
              taskId: task.id,
              task: task.task,
              room: task.room,
              params: task.params,
              attempt: task.attempt,
              provider: executingProviderParity.provider,
              model: executingProviderParity.model ?? undefined,
              providerSource: executingProviderParity.providerSource,
              providerPath: executingProviderParity.providerPath,
              providerRequestId: executingProviderParity.providerRequestId ?? undefined,
              payload: {
                workerId,
                workerHost,
                workerPid,
                route,
                leaseToken,
                provider: executingProviderParity.provider,
                model: executingProviderParity.model,
                providerSource: executingProviderParity.providerSource,
                providerPath: executingProviderParity.providerPath,
                providerRequestId: executingProviderParity.providerRequestId,
              },
            });
            const startedAt = Date.now();
            const paramsRecord = task.params as Record<string, unknown>;
            const envelope = extractOrchestrationEnvelope(paramsRecord, {
              attempt: task.attempt,
            });
            const lockKeyFromResource = taskResourceKeys
              .find((key) => key.startsWith('lock:'))
              ?.slice('lock:'.length);
            lockKey =
              envelope.lockKey ??
              lockKeyFromResource ??
              deriveDefaultLockKey({
                task: task.task,
                room: task.room,
                componentId:
                  typeof paramsRecord.componentId === 'string'
                    ? paramsRecord.componentId
                    : undefined,
                componentType:
                  typeof paramsRecord.type === 'string'
                    ? paramsRecord.type
                    : typeof paramsRecord.componentType === 'string'
                      ? paramsRecord.componentType
                      : undefined,
              }) ??
              null;
            const executeStart = Date.now();
            const execution = await mutationArbiter.execute(
              { ...envelope, lockKey: lockKey ?? undefined, attempt: task.attempt },
              async () => executeTask(task.task, task.params),
            );
            recordOrchestrationTiming({
              stage: 'worker.execute',
              task: task.task,
              route,
              durationMs: Date.now() - executeStart,
            });
            if (execution.deduped) {
              incrementOrchestrationCounter('mutationDeduped');
            } else {
              incrementOrchestrationCounter('mutationExecuted');
            }
            const verifyStart = Date.now();
            const verification = verifyTaskContract(task.task, task.params, execution.result);
            recordOrchestrationTiming({
              stage: 'worker.verify',
              task: task.task,
              route,
              durationMs: Date.now() - verifyStart,
            });
            if (!verification.ok) {
              incrementOrchestrationCounter('verificationFailures');
              throw new Error(verification.reason ?? 'verification failed');
            }
            const result = execution.result;
            const jsonResult =
              result && typeof result === 'object' && !Array.isArray(result)
                ? ({
                    ...(result as JsonObject),
                    executionId: envelope.executionId ?? task.id,
                    idempotencyKey: envelope.idempotencyKey ?? null,
                    lockKey: lockKey ?? null,
                    deduped: execution.deduped,
                  } as JsonObject)
                : ({ status: 'completed' } as JsonObject);
            await queue.completeTask(task.id, leaseToken, jsonResult);
            const durationMs = Date.now() - startedAt;
            const runtimeProviderHint = deriveRuntimeProviderHint(task.task, result);
            const completedProviderParity = deriveProviderParity({
              task: task.task,
              status: 'succeeded',
              params: task.params,
              payload: asRecord(result) ? (result as JsonObject) : undefined,
              provider: runtimeProviderHint.provider,
              model: runtimeProviderHint.model,
              providerSource: runtimeProviderHint.providerSource,
              providerPath: runtimeProviderHint.providerPath,
              providerRequestId: runtimeProviderHint.providerRequestId,
            });
            recordToolIoEvent({
              source: 'conductor_worker',
              eventType: 'task_execute',
              status: 'succeeded',
              sequence: task.attempt,
              sessionId: `conductor-${workerId}`,
              room: task.room,
              traceId: replayTraceId ?? undefined,
              requestId: replayRequestId ?? undefined,
              intentId: replayIntentId ?? undefined,
              taskId: task.id,
              toolName: task.task,
              toolCallId: task.id,
              provider: completedProviderParity.provider,
              model: completedProviderParity.model ?? undefined,
              providerSource: completedProviderParity.providerSource,
              providerPath: completedProviderParity.providerPath,
              providerRequestId: completedProviderParity.providerRequestId ?? undefined,
              input: task.params,
              output: result,
              latencyMs: durationMs,
              metadata: {
                workerId,
                workerHost,
                workerPid,
                route,
                deduped: execution.deduped,
              },
            });
            const completedTracePayload: JsonObject = {
              workerId,
              workerHost,
              workerPid,
              route,
              lockKey: lockKey ?? null,
              deduped: execution.deduped,
              leaseToken,
              provider: completedProviderParity.provider,
              model: completedProviderParity.model,
              providerSource: completedProviderParity.providerSource,
              providerPath: completedProviderParity.providerPath,
              providerRequestId: completedProviderParity.providerRequestId,
            };
            if (task.task === 'fairy.intent' && asRecord(result)) {
              completedTracePayload.result = result as JsonObject;
            }
            void recordTaskTraceFromParams({
              stage: 'completed',
              status: 'succeeded',
              taskId: task.id,
              task: task.task,
              room: task.room,
              params: task.params,
              attempt: task.attempt,
              latencyMs: durationMs,
              provider: completedProviderParity.provider,
              model: completedProviderParity.model ?? undefined,
              providerSource: completedProviderParity.providerSource,
              providerPath: completedProviderParity.providerPath,
              providerRequestId: completedProviderParity.providerRequestId ?? undefined,
              payload: completedTracePayload,
            });
            logger.info('task completed', { roomKey, taskId: task.id, durationMs });
            logger.debug('orchestration metrics', {
              taskId: task.id,
              route,
              counters: getOrchestrationMetricsSnapshot().counters,
            });
          } catch (error) {
            const described = describeUnknownError(error);
            const message = described.message;
            const shouldRetry = task.attempt < conductorSettings.taskMaxRetryAttempts;
            const retryDelayMs = shouldRetry ? computeTaskRetryDelayMs(task.attempt) : undefined;
            const retryAt = retryDelayMs !== undefined ? new Date(Date.now() + retryDelayMs) : undefined;
            logger.warn('task failed', {
              roomKey,
              taskId: task.id,
              task: task.task,
              attempt: task.attempt,
              retryDelayMs,
              retryAt,
              error: message,
              ...(described.stack ? { stack: described.stack } : {}),
              ...(described.detail ? { detail: described.detail } : {}),
            });
            await queue.failTask(task.id, leaseToken, {
              error: message,
              retryAt,
              keepInRunningLane: claimMode === 'local_scope_direct_claim',
            });
            const failedProviderParity = deriveProviderParity({
              task: task.task,
              status: 'failed',
              params: task.params,
              provider: executingProviderParity.provider,
              model: executingProviderParity.model ?? undefined,
              providerSource: executingProviderParity.providerSource,
              providerPath: executingProviderParity.providerPath,
              providerRequestId: executingProviderParity.providerRequestId ?? undefined,
            });
            recordToolIoEvent({
              source: 'conductor_worker',
              eventType: 'task_execute',
              status: shouldRetry ? 'retrying' : 'failed',
              sequence: task.attempt,
              sessionId: `conductor-${workerId}`,
              room: task.room,
              traceId: replayTraceId ?? undefined,
              requestId: replayRequestId ?? undefined,
              intentId: replayIntentId ?? undefined,
              taskId: task.id,
              toolName: task.task,
              toolCallId: task.id,
              provider: failedProviderParity.provider,
              model: failedProviderParity.model ?? undefined,
              providerSource: failedProviderParity.providerSource,
              providerPath: failedProviderParity.providerPath,
              providerRequestId: failedProviderParity.providerRequestId ?? undefined,
              input: task.params,
              output: { retryAt: retryAt ? retryAt.toISOString() : null },
              error: message,
              metadata: {
                workerId,
                workerHost,
                workerPid,
                route,
                retryable: shouldRetry,
                retryAt: retryAt ? retryAt.toISOString() : null,
              },
              priority: 'high',
            });
            void recordTaskTraceFromParams({
              stage: 'failed',
              status: 'failed',
              taskId: task.id,
              task: task.task,
              room: task.room,
              params: task.params,
              attempt: task.attempt,
              provider: failedProviderParity.provider,
              model: failedProviderParity.model ?? undefined,
              providerSource: failedProviderParity.providerSource,
              providerPath: failedProviderParity.providerPath,
              providerRequestId: failedProviderParity.providerRequestId ?? undefined,
              payload: {
                workerId,
                workerHost,
                workerPid,
                route,
                lockKey: lockKey ?? null,
                error: message,
                retryDelayMs: retryDelayMs ?? null,
                retryAt: retryAt ? retryAt.toISOString() : null,
                claimMode,
                provider: failedProviderParity.provider,
                model: failedProviderParity.model,
                providerSource: failedProviderParity.providerSource,
                providerPath: failedProviderParity.providerPath,
                providerRequestId: failedProviderParity.providerRequestId,
              },
            });
          } finally {
            releaseRoomSlot();
            if (countedActiveTask) {
              activeTaskCount = Math.max(0, activeTaskCount - 1);
            }
            leasedTaskCount = Math.max(0, leasedTaskCount - 1);
            stopLeaseExtender();
          }
        }
      });
      await Promise.allSettled(workers);
    }),
  );
}

async function workerLoop(executeTask: ExecuteTaskFn) {
  const maxClaimConcurrency = Math.max(1, Number(process.env.TASK_DEFAULT_CONCURRENCY ?? 10));
  await refreshConductorRuntimeSettings(true);
  let idlePollMs = Math.max(5, conductorSettings.taskIdlePollMs);

  while (true) {
    await refreshConductorRuntimeSettings();
    const baseIdlePollMs = Math.max(5, conductorSettings.taskIdlePollMs);
    const maxIdlePollMs = Math.max(baseIdlePollMs, conductorSettings.taskIdlePollMaxMs);
    const availableCapacity = Math.max(0, maxClaimConcurrency - leasedTaskCount);
    if (availableCapacity < 1) {
      await delay(Math.min(100, baseIdlePollMs));
      continue;
    }

    const localScopeDirectClaim = workerHandlesLocalScopeDirectClaim
      ? await queue.claimLocalScopeTasks({
          limit: availableCapacity,
          leaseTtlMs: conductorSettings.taskLeaseTtlMs,
          runtimeScope: workerRuntimeScope,
        })
      : { leaseToken: null, tasks: [] as AgentTask[] };
    const remainingCapacity = Math.max(0, availableCapacity - localScopeDirectClaim.tasks.length);
    const rpcClaim =
      remainingCapacity > 0
        ? await queue.claimTasks({
            limit: remainingCapacity,
            leaseTtlMs: conductorSettings.taskLeaseTtlMs,
            resourceLocks: workerClaimResourceLocks,
          })
        : { leaseToken: '', tasks: [] as AgentTask[] };

    if (localScopeDirectClaim.tasks.length === 0 && rpcClaim.tasks.length === 0) {
      await delay(idlePollMs);
      idlePollMs = Math.min(maxIdlePollMs, idlePollMs * 2);
      continue;
    }

    idlePollMs = baseIdlePollMs;
    const tasks = [...localScopeDirectClaim.tasks, ...rpcClaim.tasks];

    logger.info('claimed tasks', {
      count: tasks.length,
      localScopeDirectCount: localScopeDirectClaim.tasks.length,
      rpcCount: rpcClaim.tasks.length,
      taskNames: tasks.map((task) => task.task),
      leasedTaskCount,
      availableCapacity,
    });

    leasedTaskCount += tasks.length;
    const claimedTasks: ClaimedTask[] = [
      ...localScopeDirectClaim.tasks.map((task) => ({
        task,
        leaseToken: localScopeDirectClaim.leaseToken ?? '',
        stopLeaseExtender: createLeaseExtender(task.id, localScopeDirectClaim.leaseToken ?? ''),
        claimMode: 'local_scope_direct_claim' as const,
      })),
      ...rpcClaim.tasks.map((task) => ({
        task,
        leaseToken: rpcClaim.leaseToken,
        stopLeaseExtender: createLeaseExtender(task.id, rpcClaim.leaseToken),
        claimMode: 'rpc' as const,
      })),
    ];

    void processClaimedTasks(executeTask, claimedTasks);
  }
}

function startHeartbeat() {
  const emitHeartbeat = async () => {
    await recordWorkerHeartbeat({
      workerId,
      activeTasks: activeTaskCount,
    });
  };
  void emitHeartbeat();
  return setInterval(() => {
    void emitHeartbeat();
  }, Math.max(1_000, WORKER_HEARTBEAT_MS));
}

export async function startConductorWorker(executeTask: ExecuteTaskFn) {
  startHeartbeat();
  for (;;) {
    try {
      await workerLoop(executeTask);
    } catch (error) {
      logger.error('worker failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      await delay(2_000);
    }
  }
}
