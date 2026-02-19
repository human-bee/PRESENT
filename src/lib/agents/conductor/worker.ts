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
import { deriveProviderParity } from '@/lib/agents/admin/provider-parity';

const TASK_LEASE_TTL_MS = Number(process.env.TASK_LEASE_TTL_MS ?? 15_000);
const ROOM_CONCURRENCY = Math.max(1, Number.parseInt(process.env.ROOM_CONCURRENCY ?? '2', 10) || 2);
const WORKER_HEARTBEAT_MS = Number(process.env.AGENT_WORKER_HEARTBEAT_MS ?? 5_000);
const TASK_IDLE_POLL_MS = Number(process.env.TASK_IDLE_POLL_MS ?? 500);
const TASK_IDLE_POLL_MAX_MS = Number(process.env.TASK_IDLE_POLL_MAX_MS ?? 1_000);
const TASK_MAX_RETRY_ATTEMPTS = Math.max(
  1,
  Number.parseInt(process.env.TASK_MAX_RETRY_ATTEMPTS ?? '5', 10) || 5,
);
const TASK_RETRY_BASE_DELAY_MS = Math.max(
  100,
  Number.parseInt(process.env.TASK_RETRY_BASE_DELAY_MS ?? '1000', 10) || 1_000,
);
const TASK_RETRY_MAX_DELAY_MS = Math.max(
  TASK_RETRY_BASE_DELAY_MS,
  Number.parseInt(process.env.TASK_RETRY_MAX_DELAY_MS ?? '15000', 10) || 15_000,
);
const TASK_RETRY_JITTER_RATIO = Math.min(
  0.9,
  Math.max(0, Number.parseFloat(process.env.TASK_RETRY_JITTER_RATIO ?? '0.2') || 0.2),
);

const queue = new AgentTaskQueue();
const logger = createLogger('agents:conductor:worker');
const mutationArbiter = new MutationArbiter();
const workerId = process.env.AGENT_WORKER_ID || `conductor-${process.pid}-${randomUUID().slice(0, 8)}`;
const workerHost = os.hostname();
const workerPid = String(process.pid);
let activeTaskCount = 0;
let leasedTaskCount = 0;
type RoomLaneState = {
  active: number;
  waiters: Array<() => void>;
};
const roomLaneStates = new Map<string, RoomLaneState>();

const computeTaskRetryDelayMs = (attempt: number): number => {
  const exponent = Math.max(0, attempt - 1);
  const base = Math.min(TASK_RETRY_MAX_DELAY_MS, TASK_RETRY_BASE_DELAY_MS * 2 ** exponent);
  if (TASK_RETRY_JITTER_RATIO <= 0 || base <= 0) {
    return Math.round(base);
  }
  const jitter = base * TASK_RETRY_JITTER_RATIO;
  return Math.max(0, Math.round(base - jitter + Math.random() * jitter * 2));
};

type ExecuteTaskFn = (taskName: string, params: JsonObject) => Promise<unknown>;
type ClaimedTask = {
  task: AgentTask;
  leaseToken: string;
  stopLeaseExtender: () => void;
};

const normalizeString = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
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
  const intervalMs = Math.max(1_000, Math.floor(TASK_LEASE_TTL_MS * 0.6));
  let stopped = false;

  const intervalId = setInterval(() => {
    if (stopped) return;
    void queue.extendLease(taskId, leaseToken, TASK_LEASE_TTL_MS).catch((error) => {
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

  if (state.active >= ROOM_CONCURRENCY) {
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
    const roomKey =
      claimed.task.resource_keys.find((key) => key.startsWith('room:')) || 'room:default';
    if (!acc[roomKey]) acc[roomKey] = [];
    acc[roomKey].push(claimed);
    return acc;
  }, {});

  await Promise.allSettled(
    Object.entries(roomBuckets).map(async ([roomKey, roomTasks]) => {
      const queueList = [...roomTasks];
      const workers = Array.from({ length: ROOM_CONCURRENCY }).map(async () => {
        while (queueList.length > 0) {
          const claimed = queueList.shift();
          if (!claimed) break;

          const { task, leaseToken, stopLeaseExtender } = claimed;
          const releaseRoomSlot = await acquireRoomSlot(roomKey);
          let route: ReturnType<typeof classifyTaskRoute> = classifyTaskRoute(task.task);
          let lockKey: string | null = null;
          const executingProviderParity = deriveProviderParity({
            task: task.task,
            status: 'running',
            params: task.params,
          });

          try {
            activeTaskCount += 1;
            route = classifyTaskRoute(task.task);
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
            const lockKeyFromResource = task.resource_keys
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
              payload: {
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
              },
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
            const shouldRetry = task.attempt < TASK_MAX_RETRY_ATTEMPTS;
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
            await queue.failTask(task.id, leaseToken, { error: message, retryAt });
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
                provider: failedProviderParity.provider,
                model: failedProviderParity.model,
                providerSource: failedProviderParity.providerSource,
                providerPath: failedProviderParity.providerPath,
                providerRequestId: failedProviderParity.providerRequestId,
              },
            });
          } finally {
            releaseRoomSlot();
            activeTaskCount = Math.max(0, activeTaskCount - 1);
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
  const baseIdlePollMs = Math.max(5, Number.isFinite(TASK_IDLE_POLL_MS) ? Math.floor(TASK_IDLE_POLL_MS) : 500);
  const maxIdlePollMs = Math.max(
    baseIdlePollMs,
    Number.isFinite(TASK_IDLE_POLL_MAX_MS) ? Math.floor(TASK_IDLE_POLL_MAX_MS) : 2_000,
  );
  let idlePollMs = baseIdlePollMs;

  while (true) {
    const availableCapacity = Math.max(0, maxClaimConcurrency - leasedTaskCount);
    if (availableCapacity < 1) {
      await delay(Math.min(100, baseIdlePollMs));
      continue;
    }

    const { leaseToken, tasks } = await queue.claimTasks({
      limit: availableCapacity,
      leaseTtlMs: TASK_LEASE_TTL_MS,
    });

    if (tasks.length === 0) {
      await delay(idlePollMs);
      idlePollMs = Math.min(maxIdlePollMs, idlePollMs * 2);
      continue;
    }

    idlePollMs = baseIdlePollMs;

    logger.info('claimed tasks', {
      count: tasks.length,
      taskNames: tasks.map((task) => task.task),
      leasedTaskCount,
      availableCapacity,
    });

    leasedTaskCount += tasks.length;
    const claimedTasks = tasks.map((task) => ({
      task,
      leaseToken,
      stopLeaseExtender: createLeaseExtender(task.id, leaseToken),
    }));

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
