import { setTimeout as delay } from 'node:timers/promises';
import { AgentTaskQueue } from '@/lib/agents/shared/queue';
import type { JsonObject } from '@/lib/utils/json-schema';
import { createLogger } from '@/lib/logging';

const TASK_LEASE_TTL_MS = Number(process.env.TASK_LEASE_TTL_MS ?? 15_000);
const ROOM_CONCURRENCY = Number(process.env.ROOM_CONCURRENCY ?? 2);

const queue = new AgentTaskQueue();
const logger = createLogger('agents:conductor:worker');

type ExecuteTaskFn = (taskName: string, params: JsonObject) => Promise<unknown>;

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
              const result = await executeTask(task.task, task.params);
              const jsonResult =
                result && typeof result === 'object' && !Array.isArray(result)
                  ? (result as JsonObject)
                  : ({ status: 'completed' } as JsonObject);
              await queue.completeTask(task.id, leaseToken, jsonResult);
              const durationMs = Date.now() - startedAt;
              logger.info('task completed', { roomKey, taskId: task.id, durationMs });
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
