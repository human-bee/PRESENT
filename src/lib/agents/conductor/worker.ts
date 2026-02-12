import { setTimeout as delay } from 'node:timers/promises';
import { AgentTaskQueue } from '@/lib/agents/shared/queue';
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

const TASK_LEASE_TTL_MS = Number(process.env.TASK_LEASE_TTL_MS ?? 15_000);
const ROOM_CONCURRENCY = Number(process.env.ROOM_CONCURRENCY ?? 2);

const queue = new AgentTaskQueue();
const logger = createLogger('agents:conductor:worker');
const mutationArbiter = new MutationArbiter();

type ExecuteTaskFn = (taskName: string, params: JsonObject) => Promise<unknown>;

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

async function workerLoop(executeTask: ExecuteTaskFn) {
  while (true) {
    const { leaseToken, tasks } = await queue.claimTasks({
      limit: Number(process.env.TASK_DEFAULT_CONCURRENCY ?? 10),
      leaseTtlMs: TASK_LEASE_TTL_MS,
    });

    if (tasks.length === 0) {
      await delay(500);
      continue;
    }

    logger.info('claimed tasks', {
      count: tasks.length,
      taskNames: tasks.map((task) => task.task),
    });

    const roomBuckets = tasks.reduce<Record<string, typeof tasks>>((acc, task) => {
      const roomKey = task.resource_keys.find((key) => key.startsWith('room:')) || 'room:default';
      if (!acc[roomKey]) acc[roomKey] = [];
      acc[roomKey].push(task);
      return acc;
    }, {});

    await Promise.allSettled(
      Object.entries(roomBuckets).map(async ([roomKey, roomTasks]) => {
        const queueList = [...roomTasks];
        const workers = Array.from({ length: ROOM_CONCURRENCY }).map(async () => {
          while (queueList.length > 0) {
            const task = queueList.shift();
            if (!task) break;
            const stopLeaseExtender = createLeaseExtender(task.id, leaseToken);
            try {
              const startedAt = Date.now();
              const paramsRecord = task.params as Record<string, unknown>;
              const envelope = extractOrchestrationEnvelope(paramsRecord, {
                attempt: task.attempt,
              });
              const lockKeyFromResource = task.resource_keys
                .find((key) => key.startsWith('lock:'))
                ?.slice('lock:'.length);
              const lockKey =
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
                });
              const route = classifyTaskRoute(task.task);
              const executeStart = Date.now();
              const execution = await mutationArbiter.execute(
                { ...envelope, lockKey, attempt: task.attempt },
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
              logger.info('task completed', { roomKey, taskId: task.id, durationMs });
              logger.debug('orchestration metrics', {
                taskId: task.id,
                route,
                counters: getOrchestrationMetricsSnapshot().counters,
              });
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              const retryAt = task.attempt < 3 ? new Date(Date.now() + 2 ** task.attempt * 1000) : undefined;
              logger.warn('task failed', {
                roomKey,
                taskId: task.id,
                task: task.task,
                attempt: task.attempt,
                retryAt,
                error: message,
              });
              await queue.failTask(task.id, leaseToken, { error: message, retryAt });
            } finally {
              stopLeaseExtender();
            }
          }
        });
        await Promise.allSettled(workers);
      }),
    );
  }
}

export async function startConductorWorker(executeTask: ExecuteTaskFn) {
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
