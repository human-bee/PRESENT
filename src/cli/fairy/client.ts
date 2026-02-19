import { randomUUID } from 'node:crypto';
import type {
  FairyCliMutationResult,
  FairyCliMutationStatus,
  FairyCliRunEnvelope,
  FairyCliTaskSnapshot,
} from '@/lib/agents/shared/fairy-cli-contract';

type ClientOptions = {
  baseUrl: string;
  token?: string;
};

const readString = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const jsonHeaders = (token?: string): Record<string, string> => {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  const bearer = readString(token);
  if (bearer) headers.Authorization = `Bearer ${bearer}`;
  return headers;
};

async function parseJsonSafe(response: Response): Promise<unknown> {
  const text = await response.text().catch(() => '');
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

const readRecordField = (record: Record<string, unknown>, ...keys: string[]): unknown => {
  for (const key of keys) {
    if (key in record) return record[key];
  }
  return undefined;
};

function normalizeTaskSnapshot(task: Record<string, unknown> | null): FairyCliTaskSnapshot | null {
  if (!task) return null;
  const id = readString(task.id) ?? '';
  const room = readString(task.room) ?? '';
  const taskName = readString(task.task) ?? '';
  const status = readString(task.status) ?? '';
  const attempt = typeof task.attempt === 'number' && Number.isFinite(task.attempt) ? task.attempt : 0;
  if (!id || !room || !taskName || !status) return null;
  return {
    id,
    room,
    task: taskName,
    status,
    attempt,
    requestId: readString(readRecordField(task, 'request_id', 'requestId')),
    traceId: readString(readRecordField(task, 'trace_id', 'traceId')),
    error: readString(task.error),
    createdAt: readString(readRecordField(task, 'created_at', 'createdAt')),
    updatedAt: readString(readRecordField(task, 'updated_at', 'updatedAt')),
  };
}

const mapTaskStatus = (status: string): FairyCliMutationStatus => {
  const normalized = status.trim().toLowerCase();
  if (normalized === 'succeeded' || normalized === 'completed' || normalized === 'applied') return 'applied';
  if (normalized === 'queued' || normalized === 'running') return 'queued';
  if (normalized === 'canceled' || normalized === 'failed') return 'failed';
  return 'failed';
};

export async function runCanvasTask(
  options: ClientOptions,
  envelope: FairyCliRunEnvelope,
): Promise<{ response: Response; body: unknown; requestId: string; traceId: string; intentId: string | null }> {
  const requestId = readString(envelope.requestId) ?? `cli-${randomUUID()}`;
  const traceId = readString(envelope.traceId) ?? requestId;
  const intentId = readString(envelope.intentId) ?? (envelope.task === 'fairy.intent' ? requestId : null);

  const payload = {
    ...envelope,
    requestId,
    traceId,
    intentId: intentId ?? undefined,
  };

  const response = await fetch(new URL('/api/steward/runCanvas', options.baseUrl), {
    method: 'POST',
    headers: jsonHeaders(options.token),
    body: JSON.stringify(payload),
  });
  const body = await parseJsonSafe(response);
  return { response, body, requestId, traceId, intentId };
}

export async function pollTaskStatus(
  options: ClientOptions,
  args: { taskId: string; room: string; timeoutMs: number },
): Promise<FairyCliTaskSnapshot | null> {
  const startedAt = Date.now();
  let attempt = 0;
  while (Date.now() - startedAt < args.timeoutMs) {
    attempt += 1;
    const statusResponse = await fetch(
      new URL(
        `/api/steward/task-status?taskId=${encodeURIComponent(args.taskId)}&room=${encodeURIComponent(args.room)}`,
        options.baseUrl,
      ),
      { headers: jsonHeaders(options.token) },
    );
    const statusBody = await parseJsonSafe(statusResponse);
    if (!statusResponse.ok) {
      if ([401, 403].includes(statusResponse.status)) return null;
      if (statusResponse.status === 404 && attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, 200 + attempt * 100));
        continue;
      }
    }
    const task = normalizeTaskSnapshot((statusBody?.task as Record<string, unknown>) ?? null);
    if (!task) {
      await new Promise((resolve) => setTimeout(resolve, 300));
      continue;
    }
    const normalized = task.status.toLowerCase();
    if (normalized === 'succeeded' || normalized === 'failed' || normalized === 'canceled') {
      return task;
    }
    await new Promise((resolve) => setTimeout(resolve, Math.min(1200, 250 + attempt * 90)));
  }
  return null;
}

export async function sendRunAndMaybeWait(
  options: ClientOptions,
  envelope: FairyCliRunEnvelope,
  waitForTerminal: boolean,
  timeoutMs: number,
): Promise<FairyCliMutationResult> {
  const { response, body, requestId, traceId, intentId } = await runCanvasTask(options, envelope);
  const bodyRecord = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  const room = envelope.room;
  const task = envelope.task;

  if (!response.ok) {
    const errorMessage = readString(bodyRecord.error) ?? `runCanvas failed with ${response.status}`;
    const status: FairyCliMutationStatus =
      response.status === 401 || response.status === 403 ? 'unauthorized' : 'failed';
    return {
      status,
      taskId: readString(bodyRecord.taskId),
      room,
      task,
      requestId,
      traceId,
      intentId,
      reason: errorMessage,
      taskStatus: null,
    };
  }

  const taskId = readString(bodyRecord.taskId);
  if (!waitForTerminal || !taskId) {
    return {
      status: 'queued',
      taskId,
      room,
      task,
      requestId: readString(bodyRecord.requestId) ?? requestId,
      traceId: readString(bodyRecord.traceId) ?? traceId,
      intentId: readString(bodyRecord.intentId) ?? intentId,
      taskStatus: null,
    };
  }

  const terminal = await pollTaskStatus(options, { taskId, room, timeoutMs });
  if (!terminal) {
    return {
      status: 'timeout',
      taskId,
      room,
      task,
      requestId: readString(bodyRecord.requestId) ?? requestId,
      traceId: readString(bodyRecord.traceId) ?? traceId,
      intentId: readString(bodyRecord.intentId) ?? intentId,
      taskStatus: null,
      reason: 'Timed out waiting for terminal task status',
    };
  }

  return {
    status: mapTaskStatus(terminal.status),
    taskId,
    room,
    task,
    requestId: readString(bodyRecord.requestId) ?? requestId,
    traceId: readString(bodyRecord.traceId) ?? traceId,
    intentId: readString(bodyRecord.intentId) ?? intentId,
    taskStatus: terminal,
    reason: terminal.error ?? undefined,
  };
}

export async function getTraceSession(
  options: ClientOptions,
  args: { room: string; limit?: number },
): Promise<{ response: Response; body: unknown }> {
  const limit = Math.max(1, Math.min(500, Math.floor(args.limit ?? 200)));
  const response = await fetch(
    new URL(`/api/admin/agents/session?room=${encodeURIComponent(args.room)}&limit=${limit}`, options.baseUrl),
    { headers: jsonHeaders(options.token) },
  );
  const body = await parseJsonSafe(response);
  return { response, body };
}

export async function runAdminAction(
  options: ClientOptions,
  args: { action: 'cancel' | 'retry' | 'requeue'; targetTaskId: string; reason: string },
): Promise<{ response: Response; body: unknown }> {
  const response = await fetch(new URL('/api/admin/agents/actions', options.baseUrl), {
    method: 'POST',
    headers: jsonHeaders(options.token),
    body: JSON.stringify(args),
  });
  const body = await parseJsonSafe(response);
  return { response, body };
}
