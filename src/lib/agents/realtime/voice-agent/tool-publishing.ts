import { randomUUID } from 'crypto';
import type { JsonObject } from '@/lib/utils/json-schema';

export type ToolEvent = {
  id: string;
  roomId: string;
  type: 'tool_call';
  payload: {
    tool: string;
    params: JsonObject;
    context: {
      source: 'voice';
      timestamp: number;
      fast_route_type?: 'timer' | 'sticky' | 'plain_text';
      idempotency_key?: string;
      participant_id?: string;
      experiment_id?: string;
      variant_id?: string;
      assignment_namespace?: string;
      factor_levels?: Record<string, string>;
      assignment_unit?: 'room_session';
      assignment_ts?: string;
    };
  };
  timestamp: number;
  source: 'voice';
};

export type PendingToolCallEntry = {
  event: ToolEvent;
  reliable: boolean;
};

export type CanvasDispatchEntry = {
  ts: number;
  requestId?: string;
};

export const resolveDispatchSuppressionScope = ({
  task,
  roomName,
  currentTurnId,
  requestId,
  intentId,
}: {
  task: string;
  roomName: string;
  currentTurnId: number;
  requestId?: string;
  intentId?: string;
}): { suppressRoomName: string; suppressRequestId?: string } => {
  const suppressRequestId =
    task === 'fairy.intent' ? intentId ?? requestId : requestId ?? intentId;
  const suppressRoomName =
    task === 'fairy.intent' && !suppressRequestId
      ? `${roomName}::turn:${currentTurnId}`
      : roomName;
  return {
    suppressRoomName,
    suppressRequestId,
  };
};

export const CANVAS_DISPATCH_SUPPRESS_MS = 3000;

export const buildToolEvent = (
  tool: string,
  params: JsonObject,
  roomId: string,
  context?: {
    fast_route_type?: 'timer' | 'sticky' | 'plain_text';
    idempotency_key?: string;
    participant_id?: string;
    experiment_id?: string;
    variant_id?: string;
    assignment_namespace?: string;
    factor_levels?: Record<string, string>;
    assignment_unit?: 'room_session';
    assignment_ts?: string;
  },
): ToolEvent => ({
  id: randomUUID(),
  roomId,
  type: 'tool_call',
  payload: {
    tool,
    params,
    context: {
      source: 'voice',
      timestamp: Date.now(),
      ...(context?.fast_route_type ? { fast_route_type: context.fast_route_type } : {}),
      ...(context?.idempotency_key ? { idempotency_key: context.idempotency_key } : {}),
      ...(context?.participant_id ? { participant_id: context.participant_id } : {}),
      ...(context?.experiment_id ? { experiment_id: context.experiment_id } : {}),
      ...(context?.variant_id ? { variant_id: context.variant_id } : {}),
      ...(context?.assignment_namespace ? { assignment_namespace: context.assignment_namespace } : {}),
      ...(context?.factor_levels ? { factor_levels: context.factor_levels } : {}),
      ...(context?.assignment_unit ? { assignment_unit: context.assignment_unit } : {}),
      ...(context?.assignment_ts ? { assignment_ts: context.assignment_ts } : {}),
    },
  },
  timestamp: Date.now(),
  source: 'voice',
});

export const shouldSuppressCanvasDispatch = ({
  dispatches,
  roomName,
  message,
  requestId,
  now = Date.now(),
  suppressMs = CANVAS_DISPATCH_SUPPRESS_MS,
  maxEntries = 20,
}: {
  dispatches: Map<string, CanvasDispatchEntry>;
  roomName: string;
  message: string;
  requestId?: string;
  now?: number;
  suppressMs?: number;
  maxEntries?: number;
}): boolean => {
  const key = `${roomName}::${message}`;
  const existing = dispatches.get(key);
  if (
    existing &&
    now - existing.ts < suppressMs &&
    (existing.requestId === undefined || existing.requestId === requestId)
  ) {
    return true;
  }

  dispatches.set(key, { ts: now, requestId });
  if (dispatches.size > maxEntries) {
    for (const [mapKey, entry] of dispatches) {
      if (now - entry.ts > suppressMs) {
        dispatches.delete(mapKey);
      }
    }
  }

  return false;
};

export const flushPendingToolCallQueue = async ({
  queue,
  isConnected,
  publish,
  onPublishError,
}: {
  queue: PendingToolCallEntry[];
  isConnected: boolean;
  publish: (entry: PendingToolCallEntry) => Promise<boolean>;
  onPublishError?: (error: unknown, entry: PendingToolCallEntry) => void;
}): Promise<boolean> => {
  if (!isConnected) return false;

  while (queue.length > 0) {
    const next = queue.shift();
    if (!next) continue;
    try {
      const sent = await publish(next);
      if (!sent) {
        queue.unshift(next);
        return false;
      }
    } catch (error) {
      onPublishError?.(error, next);
      queue.unshift(next);
      return false;
    }
  }

  return true;
};

export const safeCloneJson = (value: unknown): JsonObject => {
  if (!value || typeof value !== 'object') return {};
  try {
    return JSON.parse(JSON.stringify(value)) as JsonObject;
  } catch {
    return {};
  }
};

export const coerceComponentPatch = (raw: unknown): JsonObject => {
  if (!raw) return {};
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? safeCloneJson(parsed) : { instruction: raw };
    } catch {
      return { instruction: raw } as JsonObject;
    }
  }
  if (typeof raw === 'object') {
    return safeCloneJson(raw);
  }
  return {};
};

export const normalizeSpecInput = (raw: unknown): JsonObject => {
  if (!raw) return {};
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? safeCloneJson(parsed) : {};
    } catch {
      return {};
    }
  }
  if (raw && typeof raw === 'object') {
    return safeCloneJson(raw);
  }
  return {};
};

export const normalizeComponentPatch = (patch: JsonObject, fallbackSeconds: number): JsonObject => {
  const next: JsonObject = { ...patch };
  const timestamp = Date.now();
  next.updatedAt = typeof next.updatedAt === 'number' ? next.updatedAt : timestamp;

  const coerceBoolean = (value: unknown): boolean | undefined => {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') {
      if (value === 1) return true;
      if (value === 0) return false;
    }
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (!normalized) return undefined;
      if (['true', 'yes', 'start', 'run', 'running', 'resume', 'play', 'on', '1'].includes(normalized)) {
        return true;
      }
      if (['false', 'no', 'stop', 'stopped', 'pause', 'paused', 'halt', 'off', '0'].includes(normalized)) {
        return false;
      }
    }
    return undefined;
  };

  const coerceDurationValue = (value: unknown, fallbackSecondsValue: number) => {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return Math.max(1, Math.round(value));
    }
    if (typeof value === 'string') {
      const cleaned = value.trim().toLowerCase();
      if (!cleaned) return fallbackSecondsValue;
      const parsed = Number.parseFloat(cleaned);
      if (!Number.isFinite(parsed)) return fallbackSecondsValue;
      const isMinutes =
        cleaned.includes('min') ||
        cleaned.endsWith('m') ||
        cleaned.endsWith('minutes') ||
        cleaned.endsWith('minute');
      const seconds = isMinutes ? parsed * 60 : parsed;
      return Math.max(1, Math.round(seconds));
    }
    return fallbackSecondsValue;
  };

  const coerceIntValue = (value: unknown, fallback: number) => {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return Math.round(value);
    }
    if (typeof value === 'string') {
      const parsed = Number.parseFloat(value);
      if (Number.isFinite(parsed)) {
        return Math.round(parsed);
      }
    }
    return fallback;
  };

  if (next.durationMinutes !== undefined) {
    const minutesValue = coerceIntValue(
      (next as any).durationMinutes,
      Math.max(1, Math.round(((next as any).configuredDuration ?? fallbackSeconds) as number / 60)),
    );
    const durationSeconds = Math.max(1, minutesValue) * 60;
    const seconds = durationSeconds % 60;
    const minutes = Math.floor(durationSeconds / 60);
    next.configuredDuration = durationSeconds;
    if (typeof next.timeLeft !== 'number') {
      next.timeLeft = durationSeconds;
    }
    next.initialMinutes = minutes;
    next.initialSeconds = seconds;
    delete (next as any).durationMinutes;
  }

  if (next.update && typeof (next as any).update === 'object' && !Array.isArray((next as any).update)) {
    const update = (next as any).update as Record<string, unknown>;
    const defaultMinutes = Math.max(0, Math.floor(fallbackSeconds / 60));
    const defaultSeconds = fallbackSeconds % 60;
    const minutesCandidate =
      'minutes' in update ? coerceIntValue(update.minutes, defaultMinutes) : null;
    const secondsCandidate =
      'seconds' in update ? coerceIntValue(update.seconds, defaultSeconds) : null;
    if (minutesCandidate !== null || secondsCandidate !== null) {
      const minutes =
        minutesCandidate !== null
          ? Math.max(0, minutesCandidate)
          : secondsCandidate !== null
            ? 0
            : defaultMinutes;
      const seconds = secondsCandidate !== null ? Math.max(0, Math.min(59, secondsCandidate)) : defaultSeconds;
      const durationSeconds = Math.max(1, minutes * 60 + seconds);
      next.configuredDuration = durationSeconds;
      next.timeLeft = durationSeconds;
      next.initialMinutes = minutes;
      next.initialSeconds = seconds;
      next.isFinished = false;
      next.isRunning = false;
    }
    delete (next as any).update;
  }

  if (next.duration !== undefined) {
    const durationSeconds = coerceDurationValue(
      next.duration,
      Math.max(1, Math.round((next as any).configuredDuration ?? fallbackSeconds)),
    );
    const minutes = Math.floor(durationSeconds / 60);
    const seconds = durationSeconds % 60;
    next.configuredDuration = durationSeconds;
    if (typeof next.timeLeft !== 'number') {
      next.timeLeft = durationSeconds;
    }
    next.initialMinutes = minutes;
    next.initialSeconds = seconds;
    delete next.duration;
  }
  if (next.durationSeconds !== undefined) {
    const durationSeconds = coerceDurationValue(
      (next as any).durationSeconds,
      Math.max(1, Math.round((next as any).configuredDuration ?? fallbackSeconds)),
    );
    const minutes = Math.floor(durationSeconds / 60);
    const seconds = durationSeconds % 60;
    next.configuredDuration = durationSeconds;
    if (typeof next.timeLeft !== 'number') {
      next.timeLeft = durationSeconds;
    }
    next.initialMinutes = minutes;
    next.initialSeconds = seconds;
  }
  if (next.initialMinutes !== undefined || next.initialSeconds !== undefined) {
    const hasMinutesField = (next as any).initialMinutes !== undefined;
    const hasSecondsField = (next as any).initialSeconds !== undefined;
    const defaultMinutes = Math.max(
      0,
      Math.floor((((next as any).configuredDuration ?? fallbackSeconds) as number) / 60),
    );
    const defaultSeconds = (((next as any).configuredDuration ?? fallbackSeconds) as number) % 60;
    const minutesCandidate = hasMinutesField
      ? coerceIntValue((next as any).initialMinutes, defaultMinutes)
      : null;
    const secondsCandidate = hasSecondsField
      ? coerceIntValue((next as any).initialSeconds, defaultSeconds)
      : null;
    if (minutesCandidate !== null || secondsCandidate !== null) {
      const minutes =
        minutesCandidate !== null
          ? Math.max(0, minutesCandidate)
          : secondsCandidate !== null
            ? 0
            : defaultMinutes;
      const seconds =
        secondsCandidate !== null ? Math.max(0, Math.min(59, secondsCandidate)) : Math.max(0, Math.min(59, defaultSeconds));
      const totalSeconds = Math.max(1, minutes * 60 + seconds);
      next.configuredDuration = totalSeconds;
      if (typeof next.timeLeft !== 'number') {
        next.timeLeft = totalSeconds;
      }
      next.initialMinutes = minutes;
      next.initialSeconds = seconds;
    }
  }

  if (typeof (next as any).state === 'string') {
    const stateLabel = ((next as any).state as string).trim().toLowerCase();
    delete (next as any).state;
    const markRunning = () => {
      next.isRunning = true;
      next.isFinished = false;
      if (typeof next.timeLeft !== 'number' || next.timeLeft <= 0) {
        const durationSeconds = typeof next.configuredDuration === 'number' ? next.configuredDuration : fallbackSeconds;
        next.timeLeft = Math.max(1, Math.round(durationSeconds));
      }
    };
    const markStopped = (finished: boolean) => {
      next.isRunning = false;
      if (finished) {
        next.isFinished = true;
        if (typeof next.timeLeft !== 'number' || next.timeLeft < 0) {
          next.timeLeft = 0;
        }
      }
    };
    if (
      ['run', 'running', 'start', 'started', 'resume', 'resumed', 'play', 'playing', 'active'].includes(
        stateLabel,
      )
    ) {
      markRunning();
    } else if (
      ['paused', 'pause', 'stop', 'stopped', 'halt', 'idle', 'ready', 'standby'].includes(stateLabel)
    ) {
      markStopped(false);
    } else if (
      ['finished', 'complete', 'completed', 'done', 'expired', "time's up", 'time up', 'timeup'].includes(
        stateLabel,
      )
    ) {
      markStopped(true);
    }
  }

  const runningValue =
    'running' in next ? coerceBoolean(next.running) : undefined;
  if (runningValue !== undefined) {
    next.isRunning = runningValue;
    if (runningValue) {
      next.isFinished = false;
      if (typeof next.timeLeft !== 'number' && typeof next.configuredDuration === 'number') {
        next.timeLeft = next.configuredDuration;
      }
    }
    delete next.running;
  }

  const autoStartValue =
    'autoStart' in next ? coerceBoolean(next.autoStart) : undefined;
  if (autoStartValue !== undefined) {
    next.autoStart = autoStartValue;
    next.isRunning = autoStartValue;
    if (autoStartValue) {
      next.isFinished = false;
      if (typeof next.timeLeft !== 'number' && typeof next.configuredDuration === 'number') {
        next.timeLeft = next.configuredDuration;
      }
    }
  }

  const statusValue =
    'status' in next ? coerceBoolean(next.status) : undefined;
  if (statusValue !== undefined && next.isRunning === undefined) {
    next.isRunning = statusValue;
    if (statusValue) {
      next.isFinished = false;
      if (typeof next.timeLeft !== 'number' && typeof next.configuredDuration === 'number') {
        next.timeLeft = next.configuredDuration;
      }
    }
  }

  if (typeof (next as any).action === 'string') {
    const action = ((next as any).action as string).trim().toLowerCase();
    delete (next as any).action;
    if (action === 'start' || action === 'resume' || action === 'run' || action === 'play') {
      next.isRunning = true;
      next.isFinished = false;
      if (typeof next.timeLeft !== 'number' || next.timeLeft <= 0) {
        const durationSeconds = typeof next.configuredDuration === 'number' ? next.configuredDuration : fallbackSeconds;
        next.timeLeft = Math.max(1, Math.round(durationSeconds));
      }
    } else if (action === 'pause' || action === 'stop' || action === 'halt') {
      next.isRunning = false;
    } else if (action === 'reset') {
      const durationSeconds = typeof next.configuredDuration === 'number' ? next.configuredDuration : fallbackSeconds;
      next.timeLeft = Math.max(1, Math.round(durationSeconds));
      next.isRunning = false;
      next.isFinished = false;
    }
  }

  if (typeof (next as any).command === 'string') {
    const command = ((next as any).command as string).trim().toLowerCase();
    delete (next as any).command;
    if (command === 'start' || command === 'resume' || command === 'run' || command === 'play') {
      next.isRunning = true;
      next.isFinished = false;
      if (typeof next.timeLeft !== 'number' || next.timeLeft <= 0) {
        const durationSeconds = typeof next.configuredDuration === 'number' ? next.configuredDuration : fallbackSeconds;
        next.timeLeft = Math.max(1, Math.round(durationSeconds));
      }
    } else if (command === 'pause' || command === 'stop' || command === 'halt') {
      next.isRunning = false;
    } else if (command === 'reset') {
      const durationSeconds = typeof next.configuredDuration === 'number' ? next.configuredDuration : fallbackSeconds;
      next.timeLeft = Math.max(1, Math.round(durationSeconds));
      next.isRunning = false;
      next.isFinished = false;
    }
  }

  return next;
};

export const shouldForceReliableUpdate = (tool: string, params: JsonObject): boolean =>
  tool === 'update_component' &&
  params &&
  typeof (params as any).patch === 'object' &&
  (params as any).patch !== null &&
  typeof ((params as any).patch as any).instruction === 'string' &&
  (((params as any).patch as any).instruction as string).trim().length > 0;
