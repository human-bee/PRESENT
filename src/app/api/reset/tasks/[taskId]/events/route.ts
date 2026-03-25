import { getTaskRun, listTraceEvents } from '@present/kernel';
import { hydrateResetKernel } from '../../../_lib/persistence';

export const runtime = 'nodejs';

const encoder = new TextEncoder();
const terminalTaskStates = new Set(['succeeded', 'failed', 'canceled']);

const encodeSseEvent = (name: string, payload: unknown) =>
  encoder.encode(`event: ${name}\ndata: ${JSON.stringify(payload)}\n\n`);

export async function GET(
  request: Request,
  context: { params: Promise<{ taskId: string }> },
) {
  await hydrateResetKernel();
  const { taskId } = await context.params;
  const initialTask = await getTaskRun(taskId);

  if (!initialTask) {
    return new Response(JSON.stringify({ error: 'Task run not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const seenTraceIds = new Set<string>();
  let interval: ReturnType<typeof setInterval> | null = null;
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enqueue = (name: string, payload: unknown) => {
        if (closed) return false;
        controller.enqueue(encodeSseEvent(name, payload));
        return true;
      };

      const close = () => {
        if (closed) return;
        closed = true;
        if (interval) {
          clearInterval(interval);
          interval = null;
        }
        controller.close();
      };

      const pump = async () => {
        if (closed) return;
        const taskRun = await getTaskRun(taskId);
        if (closed) return;

        if (!taskRun) {
          enqueue('done', { taskId, status: 'missing' });
          close();
          return;
        }

        if (!enqueue('task', taskRun)) {
          return;
        }

        for (const event of listTraceEvents(taskRun.traceId).slice().reverse()) {
          if (seenTraceIds.has(event.id)) continue;
          seenTraceIds.add(event.id);
          if (!enqueue('trace', event)) {
            return;
          }
        }

        if (terminalTaskStates.has(taskRun.status)) {
          enqueue('done', { taskId: taskRun.id, status: taskRun.status });
          close();
        }
      };

      interval = setInterval(() => {
        void pump().catch(() => {
          close();
        });
      }, 1000);

      await pump();
      request.signal.addEventListener('abort', close, { once: true });
    },
    cancel() {
      if (interval) {
        clearInterval(interval);
        interval = null;
      }
      closed = true;
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
