import type { Room } from 'livekit-client';
import { ConnectionError } from 'livekit-client';
import {
  TOKEN_TIMEOUT_MS,
  LIVEKIT_CONNECT_MAX_ATTEMPTS,
  LIVEKIT_CONNECT_RETRY_DELAY_MS,
} from '../../utils';
import type { LivekitRoomConnectorState } from './lk-types';

const RETRYABLE_ERROR_SUBSTRINGS = [
  'could not establish signal connection',
  'connection timed out',
  'socket hang up',
  'signal connection closed',
  'networkerror',
  'websocket',
  'econnrefused',
];

function createAbortError(): Error {
  const error = new Error('LiveKit connection aborted');
  error.name = 'AbortError';
  return error;
}

function isAbortSignal(signal?: AbortSignal): boolean {
  return Boolean(signal?.aborted);
}

async function ensureDisconnected(room: Room): Promise<void> {
  if (room.state === 'disconnected') {
    return;
  }

  try {
    await room.disconnect();
  } catch {
    // Ignore disconnect errors during cleanup; the room may already be closed
  }
}

function isRetryableError(error: unknown): boolean {
  if (error instanceof ConnectionError) {
    return true;
  }

  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    return RETRYABLE_ERROR_SUBSTRINGS.some((pattern) => message.includes(pattern));
  }

  return false;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    if (!signal) {
      setTimeout(resolve, ms);
      return;
    }

    if (signal.aborted) {
      resolve();
      return;
    }

    const onAbort = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      resolve();
    };

    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);

    signal.addEventListener('abort', onAbort, { once: true });
  });
}

interface ConnectRoomParams {
  room: Room;
  wsUrl: string;
  token: string;
  audioOnly: boolean;
  publishLocalMedia: boolean;
  roomName: string;
  mergeState: (patch: Partial<LivekitRoomConnectorState>) => void;
  getState: () => LivekitRoomConnectorState;
  scheduleAgentJoin: (room: Room) => void;
  signal?: AbortSignal;
  maxAttempts?: number;
  retryDelayMs?: number;
}

export async function connectRoomWithToken({
  room,
  wsUrl,
  token,
  audioOnly,
  publishLocalMedia,
  roomName,
  mergeState,
  getState,
  scheduleAgentJoin,
  signal,
  maxAttempts = LIVEKIT_CONNECT_MAX_ATTEMPTS,
  retryDelayMs = LIVEKIT_CONNECT_RETRY_DELAY_MS,
}: ConnectRoomParams): Promise<void> {
  const attempts = Math.max(1, maxAttempts);
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (isAbortSignal(signal)) {
      await ensureDisconnected(room);
      throw createAbortError();
    }

    await ensureDisconnected(room);

    const abortHandler = () => {
      void room.disconnect();
    };
    if (signal) {
      signal.addEventListener('abort', abortHandler, { once: true });
    }

    const timeoutId = setTimeout(async () => {
      const latest = getState();
      if (latest.connectionState !== 'connected') {
        try {
          await room.disconnect();
        } catch {
          // ignore disconnect errors during timeout recovery
        }
        mergeState({
          connectionState: 'error',
          errorMessage: 'Connection timed out.',
        });
      }
    }, TOKEN_TIMEOUT_MS);

    try {
      await room.connect(wsUrl, token);

      if (isAbortSignal(signal)) {
        await ensureDisconnected(room);
        throw createAbortError();
      }

      if (publishLocalMedia) {
        try {
          if (!audioOnly) {
            await room.localParticipant.enableCameraAndMicrophone();
          } else {
            await room.localParticipant.setMicrophoneEnabled(true);
          }
        } catch (mediaError) {
          console.warn(`⚠️ [LiveKitConnector-${roomName}] Media device error:`, mediaError);
        }
      }

      mergeState({
        connectionState: 'connected',
        participantCount: room.numParticipants,
        errorMessage: null,
      });

      scheduleAgentJoin(room);
      return;
    } catch (connectError) {
      lastError = connectError;

      if (isAbortSignal(signal)) {
        await ensureDisconnected(room);
        throw createAbortError();
      }

      if (attempt < attempts && isRetryableError(connectError)) {
        const nextAttempt = attempt + 1;
        mergeState({
          connectionState: 'connecting',
          errorMessage: `Connection failed – retrying (${nextAttempt}/${attempts})...`,
        });

        await sleep(retryDelayMs, signal);

        if (isAbortSignal(signal)) {
          await ensureDisconnected(room);
          throw createAbortError();
        }

        continue;
      }

      throw connectError;
    } finally {
      clearTimeout(timeoutId);
      if (signal) {
        signal.removeEventListener('abort', abortHandler);
      }
    }
  }

  if (lastError) {
    throw lastError;
  }
}
