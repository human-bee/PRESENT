/**
 * Enhanced RetroTimer with TLDraw state synchronization.
 *
 * Components register with the ComponentRegistry for discovery, but live updates
 * are driven through TLDraw shape state so every client stays in sync.
 */

'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useComponentRegistration } from '@/lib/component-registry';
import { z } from 'zod';
import { cn } from '@/lib/utils';
import { Play, Pause, RotateCcw, Clock } from 'lucide-react';
import { LoadingState } from '@/lib/with-progressive-loading';
import { LoadingWrapper, SkeletonPatterns } from '@/components/ui/shared/loading-states';

const RETRO_TIMER_DEBUG = process.env.NEXT_PUBLIC_CANVAS_DEBUG === 'true';

type UpdateStateFn = (
  patch:
    | Record<string, unknown>
    | ((prev: Record<string, unknown>) => Record<string, unknown>),
) => void;

interface TimerRuntimeSnapshot {
  configuredDuration: number;
  timeLeft: number;
  isRunning: boolean;
  isFinished: boolean;
  updatedAt: number;
}

function toFiniteNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function sanitizeDurationSeconds(value: unknown, fallbackSeconds: number): number {
  const num = toFiniteNumber(value);
  if (num === undefined) return Math.max(1, Math.round(fallbackSeconds));
  return Math.max(1, Math.round(num));
}

function sanitizeTimeLeftSeconds(value: unknown, maxSeconds: number, fallback: number): number {
  const num = toFiniteNumber(value);
  if (num === undefined) return Math.max(0, Math.min(maxSeconds, Math.round(fallback)));
  return Math.max(0, Math.min(maxSeconds, Math.round(num)));
}

function deriveConfiguredDurationFromPatch(
  patch: Record<string, unknown>,
  prev: TimerRuntimeSnapshot,
  fallbackSeconds: number,
): number {
  if ('configuredDuration' in patch) {
    return sanitizeDurationSeconds(patch.configuredDuration, prev.configuredDuration || fallbackSeconds);
  }
  const minutes = toFiniteNumber(patch.initialMinutes);
  const seconds = toFiniteNumber(patch.initialSeconds);
  if (minutes !== undefined || seconds !== undefined) {
    const nextMinutes = minutes ?? Math.floor(prev.configuredDuration / 60);
    const nextSeconds = seconds ?? prev.configuredDuration % 60;
    return sanitizeDurationSeconds(nextMinutes * 60 + nextSeconds, fallbackSeconds);
  }
  const durationSeconds = toFiniteNumber((patch as Record<string, unknown>)?.durationSeconds);
  if (durationSeconds !== undefined) {
    return sanitizeDurationSeconds(durationSeconds, fallbackSeconds);
  }
  return prev.configuredDuration || Math.max(1, Math.round(fallbackSeconds));
}

function deriveTimeLeftFromPatch(
  patch: Record<string, unknown>,
  prev: TimerRuntimeSnapshot,
  configuredDuration: number,
): number {
  if ('timeLeft' in patch) {
    return sanitizeTimeLeftSeconds(patch.timeLeft, configuredDuration, prev.timeLeft);
  }
  const remainingSeconds = toFiniteNumber((patch as Record<string, unknown>)?.remainingSeconds);
  if (remainingSeconds !== undefined) {
    return sanitizeTimeLeftSeconds(remainingSeconds, configuredDuration, prev.timeLeft);
  }
  if ('time_left_seconds' in patch) {
    return sanitizeTimeLeftSeconds((patch as Record<string, unknown>).time_left_seconds, configuredDuration, prev.timeLeft);
  }
  if ('configuredDuration' in patch || 'initialMinutes' in patch || 'initialSeconds' in patch) {
    return configuredDuration;
  }
  return prev.timeLeft;
}

function buildNextSnapshot(
  prev: TimerRuntimeSnapshot,
  patch: Record<string, unknown>,
  fallbackSeconds: number,
  timestamp: number,
): TimerRuntimeSnapshot {
  const configuredDuration = deriveConfiguredDurationFromPatch(patch, prev, fallbackSeconds);
  let timeLeft = deriveTimeLeftFromPatch(patch, prev, configuredDuration);

  let isRunning = typeof patch.isRunning === 'boolean' ? patch.isRunning : prev.isRunning;
  const autoStart = typeof patch.autoStart === 'boolean' ? patch.autoStart : undefined;
  if (autoStart === true && ('configuredDuration' in patch || 'initialMinutes' in patch || 'initialSeconds' in patch)) {
    isRunning = true;
    timeLeft = configuredDuration;
  }
  if (autoStart === false) {
    isRunning = false;
  }

  let isFinished = typeof patch.isFinished === 'boolean' ? patch.isFinished : prev.isFinished;

  if (timeLeft <= 0) {
    timeLeft = 0;
    isFinished = true;
    isRunning = false;
  } else if (isFinished && timeLeft > 0) {
    isFinished = false;
  }

  const updatedAt = toFiniteNumber(patch.updatedAt) ?? timestamp;

  return {
    configuredDuration,
    timeLeft,
    isRunning,
    isFinished,
    updatedAt,
  };
}

function parseRuntimeState(
  raw: unknown,
  fallbackSeconds: number,
  autoStart: boolean,
): TimerRuntimeSnapshot {
  const base: TimerRuntimeSnapshot = {
    configuredDuration: Math.max(1, Math.round(fallbackSeconds)),
    timeLeft: Math.max(1, Math.round(fallbackSeconds)),
    isRunning: autoStart,
    isFinished: false,
    updatedAt: 0,
  };
  if (!raw || typeof raw !== 'object') {
    return base;
  }
  const parsed = buildNextSnapshot(base, raw as Record<string, unknown>, fallbackSeconds, toFiniteNumber((raw as Record<string, unknown>).updatedAt) ?? 0);
  return parsed;
}

function statesEqual(a: TimerRuntimeSnapshot, b: TimerRuntimeSnapshot) {
  return (
    a.configuredDuration === b.configuredDuration &&
    a.timeLeft === b.timeLeft &&
    a.isRunning === b.isRunning &&
    a.isFinished === b.isFinished &&
    a.updatedAt === b.updatedAt
  );
}

export const retroTimerEnhancedSchema = z.object({
  initialMinutes: z
    .number()
    .min(1)
    .max(120)
    .default(5)
    .describe('Initial timer duration in minutes'),
  initialSeconds: z
    .number()
    .min(0)
    .max(59)
    .default(0)
    .describe('Initial timer duration in seconds'),
  title: z.string().optional().describe('Timer title/label'),
  autoStart: z.boolean().default(false).describe('Start timer automatically'),
  showPresets: z.boolean().default(true).describe('Show preset time buttons'),
  componentId: z.string().default('retro-timer').describe('Unique component identifier'),
  __custom_message_id: z.string().optional().describe('Internal: custom message ID for AI updates'),
});

export type RetroTimerEnhancedProps = z.infer<typeof retroTimerEnhancedSchema>;

type RetroTimerEnhancedInjectedProps = RetroTimerEnhancedProps & {
  state?: Record<string, unknown>;
  updateState?: UpdateStateFn;
};

export function RetroTimerEnhanced({
  initialMinutes = 5,
  initialSeconds = 0,
  title,
  autoStart = false,
  showPresets = true,
  componentId = 'retro-timer',
  __custom_message_id,
  state: injectedState,
  updateState,
}: RetroTimerEnhancedInjectedProps) {
  const DEBUG = typeof process !== 'undefined' && process.env.NEXT_PUBLIC_TOOL_DISPATCHER_LOGS === 'true';
  const initialTimeInSeconds = useMemo(
    () => Math.max(1, Math.round(initialMinutes * 60 + initialSeconds)),
    [initialMinutes, initialSeconds],
  );

  const runtimeFromShape = useMemo(
    () => parseRuntimeState(injectedState, initialTimeInSeconds, autoStart),
    [injectedState, initialTimeInSeconds, autoStart],
  );

  const [timerState, setTimerState] = useState<TimerRuntimeSnapshot>(runtimeFromShape);
  const timerStateRef = useRef(timerState);
  const syncRef = useRef(false);
  const [titleOverride, setTitleOverride] = useState<string | undefined>(title);

  useEffect(() => {
    timerStateRef.current = timerState;
  }, [timerState]);

  useEffect(() => {
    setTitleOverride(title);
  }, [title]);

  useEffect(() => {
    if (syncRef.current) {
      if (statesEqual(timerState, runtimeFromShape) || runtimeFromShape.updatedAt >= timerState.updatedAt) {
        syncRef.current = false;
      }
      return;
    }
    if (!statesEqual(timerState, runtimeFromShape)) {
      setTimerState(runtimeFromShape);
    }
  }, [runtimeFromShape, timerState]);

  const pushRuntimePatch = useCallback(
    (patchInput: Record<string, unknown>) => {
      if ('title' in patchInput && typeof patchInput.title === 'string') {
        setTitleOverride(patchInput.title);
      }
      const timestamp = toFiniteNumber(patchInput.updatedAt) ?? Date.now();
      const nextSnapshot = buildNextSnapshot(timerState, patchInput, initialTimeInSeconds, timestamp);
      if (statesEqual(timerState, nextSnapshot)) {
        if (syncRef.current) syncRef.current = false;
        return;
      }
      syncRef.current = true;
      setTimerState(nextSnapshot);
      if (updateState) {
        updateState((prev: any) => {
          const prevRecord = prev && typeof prev === 'object' ? prev : {};
          const minutes = Math.floor(nextSnapshot.configuredDuration / 60);
          const seconds = nextSnapshot.configuredDuration % 60;
          return {
            ...prevRecord,
            ...patchInput,
            configuredDuration: nextSnapshot.configuredDuration,
            timeLeft: nextSnapshot.timeLeft,
            isRunning: nextSnapshot.isRunning,
            isFinished: nextSnapshot.isFinished,
            updatedAt: nextSnapshot.updatedAt,
            initialMinutes: minutes,
            initialSeconds: seconds,
          };
        });
      } else {
        syncRef.current = false;
      }
    },
    [timerState, initialTimeInSeconds, updateState],
  );

  const pushRuntimePatchRef = useRef(pushRuntimePatch);
  useEffect(() => {
    pushRuntimePatchRef.current = pushRuntimePatch;
  }, [pushRuntimePatch]);

  const coerceNumber = useCallback((value: unknown): number | null => {
    const num = toFiniteNumber(value);
    return num === undefined ? null : num;
  }, []);

  const coerceBoolean = useCallback((value: unknown): boolean | null => {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') {
      if (value === 1) return true;
      if (value === 0) return false;
    }
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (!normalized) return null;
      if (['true', 'yes', 'start', 'go', 'run', 'play', 'resume', '1'].includes(normalized)) return true;
      if (['false', 'no', 'stop', 'pause', 'halt', '0'].includes(normalized)) return false;
    }
    return null;
  }, []);

  const effectiveMessageId = useMemo(() => {
    if (__custom_message_id) {
      if (RETRO_TIMER_DEBUG) {
        if (DEBUG) console.debug('[RetroTimerEnhanced] Using provided custom message ID', __custom_message_id);
      }
      return __custom_message_id;
    }
    const fallbackId = `timer-${componentId}-${initialMinutes}min`;
    if (RETRO_TIMER_DEBUG) {
      if (DEBUG) console.debug('[RetroTimerEnhanced] Using fallback message ID', fallbackId);
    }
    return fallbackId;
  }, [__custom_message_id, componentId, initialMinutes]);

  const stableProps = useMemo(
    () => ({
      initialMinutes,
      initialSeconds,
      title,
      autoStart,
      showPresets,
      componentId,
    }),
    [initialMinutes, initialSeconds, title, autoStart, showPresets, componentId],
  );

  const handleAIUpdate = useCallback(
    (patch: Record<string, unknown>) => {
      if (RETRO_TIMER_DEBUG) {
        if (DEBUG) console.debug('[RetroTimerEnhanced] AI update received', patch);
      }

      // Handle direct property patches from voice agent (fast path, no regex)
      if ('isRunning' in patch || 'timeLeft' in patch || 'configuredDuration' in patch || 'reset' in patch || 'addSeconds' in patch) {
        const directPatch: Record<string, unknown> = {};
        
        if ('isRunning' in patch) {
          directPatch.isRunning = coerceBoolean((patch as any).isRunning);
          if (directPatch.isRunning) {
            directPatch.isFinished = false;
          }
        }
        
        if ('configuredDuration' in patch) {
          const duration = coerceNumber((patch as any).configuredDuration);
          if (duration !== null && duration > 0) {
            directPatch.configuredDuration = duration;
            if (!('timeLeft' in patch)) {
              directPatch.timeLeft = duration;
            }
            directPatch.isFinished = false;
          }
        }
        
        if ('timeLeft' in patch) {
          const timeLeft = coerceNumber((patch as any).timeLeft);
          if (timeLeft !== null && timeLeft >= 0) {
            directPatch.timeLeft = timeLeft;
            directPatch.isFinished = false;
          }
        }
        
        if ('reset' in patch && coerceBoolean((patch as any).reset)) {
          directPatch.timeLeft = timerState.configuredDuration;
          directPatch.isRunning = false;
          directPatch.isFinished = false;
        }
        
        if ('addSeconds' in patch) {
          const add = coerceNumber((patch as any).addSeconds);
          if (add !== null) {
            directPatch.timeLeft = Math.max(0, timerState.timeLeft + add);
            directPatch.configuredDuration = Math.max(timerState.configuredDuration, directPatch.timeLeft as number);
          }
        }
        
        if (Object.keys(directPatch).length > 0) {
          pushRuntimePatch(directPatch);
          return;
        }
      }

      const rawMinutes = 'initialMinutes' in patch ? coerceNumber((patch as any).initialMinutes) : null;
      const rawSeconds = 'initialSeconds' in patch ? coerceNumber((patch as any).initialSeconds) : null;
      const normalizedMinutes =
        rawMinutes !== null ? Math.min(Math.max(Math.round(rawMinutes), 1), 120) : null;
      const normalizedSeconds =
        rawSeconds !== null ? Math.min(Math.max(Math.round(rawSeconds), 0), 59) : null;
      const durationWasUpdated = normalizedMinutes !== null || normalizedSeconds !== null;

      const resolvedMinutes =
        normalizedMinutes !== null ? normalizedMinutes : Math.max(1, Math.round(timerState.configuredDuration / 60));
      const resolvedSeconds =
        normalizedSeconds !== null ? normalizedSeconds : Math.max(0, timerState.configuredDuration % 60);
      const nextDurationSeconds = resolvedMinutes * 60 + resolvedSeconds;

      const autoStartPatch = 'autoStart' in patch ? coerceBoolean((patch as any).autoStart) : null;

      const runtimePatch: Record<string, unknown> = {};
      if (durationWasUpdated) {
        runtimePatch.configuredDuration = nextDurationSeconds;
        runtimePatch.timeLeft = nextDurationSeconds;
        runtimePatch.initialMinutes = resolvedMinutes;
        runtimePatch.initialSeconds = resolvedSeconds;
        runtimePatch.isFinished = false;
      }
      if (autoStartPatch !== null) {
        runtimePatch.isRunning = autoStartPatch;
        if (autoStartPatch) {
          runtimePatch.isFinished = false;
          if (!durationWasUpdated && timerState.timeLeft <= 0) {
            runtimePatch.timeLeft = timerState.configuredDuration;
          }
        }
      } else if (durationWasUpdated) {
        runtimePatch.isRunning = false;
      }
      if ('title' in patch && typeof (patch as any).title === 'string') {
        runtimePatch.title = String((patch as any).title);
      }

      const mergedPatch = { ...patch, ...runtimePatch };
      pushRuntimePatch(mergedPatch);
    },
    [pushRuntimePatch, timerState.configuredDuration, timerState.timeLeft, coerceNumber, coerceBoolean],
  );

  useComponentRegistration(
    effectiveMessageId,
    'RetroTimerEnhanced',
    stableProps,
    'default',
    handleAIUpdate,
  );

  const loadingState = LoadingState.COMPLETE;

  useEffect(() => {
    if (!timerState.isRunning) return;
    const interval = window.setInterval(() => {
      const current = timerStateRef.current;
      if (!current.isRunning) return;
      if (current.timeLeft <= 0) {
        pushRuntimePatchRef.current?.({
          timeLeft: 0,
          isRunning: false,
          isFinished: true,
        });
        return;
      }
      const nextTimeLeft = current.timeLeft - 1;
      pushRuntimePatchRef.current?.({
        timeLeft: nextTimeLeft,
        isRunning: nextTimeLeft > 0,
        isFinished: nextTimeLeft <= 0,
      });
    }, 1000);
    return () => window.clearInterval(interval);
  }, [timerState.isRunning]);

  const startPause = useCallback(() => {
    if (!timerState.isRunning && timerState.timeLeft <= 0) {
      pushRuntimePatch({
        timeLeft: timerState.configuredDuration,
        isRunning: true,
        isFinished: false,
      });
      return;
    }
    pushRuntimePatch({
      isRunning: !timerState.isRunning,
      isFinished: !timerState.isRunning ? false : timerState.isFinished,
    });
  }, [timerState, pushRuntimePatch]);

  const reset = useCallback(() => {
    pushRuntimePatch({
      timeLeft: timerState.configuredDuration,
      isRunning: false,
      isFinished: false,
    });
  }, [timerState.configuredDuration, pushRuntimePatch]);

  const setPresetTime = useCallback(
    (minutes: number) => {
      const nextSeconds = Math.max(1, Math.round(minutes)) * 60;
      pushRuntimePatch({
        configuredDuration: nextSeconds,
        timeLeft: nextSeconds,
        isRunning: false,
        isFinished: false,
      });
    },
    [pushRuntimePatch],
  );

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const headerTitle =
    titleOverride || `${Math.max(1, Math.round(timerState.configuredDuration / 60))} Minute Timer`;

  return (
    <LoadingWrapper
      state={loadingState}
      skeleton={SkeletonPatterns.timer}
      showLoadingIndicator={true}
      loadingProgress={{
        state: loadingState,
        progress:
          loadingState === LoadingState.SKELETON
            ? 33
            : loadingState === LoadingState.PARTIAL
              ? 66
              : 100,
        message:
          loadingState === LoadingState.SKELETON
            ? 'Loading timer...'
            : loadingState === LoadingState.PARTIAL
              ? 'Initializing...'
              : 'Ready!',
        eta:
          loadingState === LoadingState.SKELETON
            ? 250
            : loadingState === LoadingState.PARTIAL
              ? 100
              : 0,
      }}
    >
      <div
        className={cn(
          'bg-gradient-to-br from-gray-900 to-gray-800 rounded-xl p-6 text-white shadow-2xl',
          'border border-gray-700 max-w-sm mx-auto',
          'touch-manipulation',
          timerState.isFinished && 'ring-2 ring-red-500 ring-opacity-50',
        )}
      >
        <div className="text-center mb-6">
          <div className="flex items-center justify-center gap-2 mb-2">
            <Clock className="w-5 h-5 text-blue-400" />
            <h3 className="text-lg font-semibold">{headerTitle}</h3>
          </div>
          <div className="text-xs text-gray-400">Enhanced with AI Updates • {componentId}</div>
        </div>

        <div className="text-center mb-6">
          <div
            className={cn(
              'text-6xl font-mono font-bold tracking-wider',
              timerState.isFinished
                ? 'text-red-400 animate-pulse'
                : timerState.isRunning
                  ? 'text-green-400'
                  : 'text-blue-400',
            )}
          >
            {formatTime(timerState.timeLeft)}
          </div>
          {timerState.isFinished && (
            <div className="text-red-400 text-sm mt-2 animate-bounce">Time's up! 🎉</div>
          )}
        </div>

        <div className="flex justify-center gap-3 mb-4">
          <button
            onClick={startPause}
            disabled={timerState.isFinished}
            className={cn(
              'flex items-center gap-2 px-5 py-3 rounded-lg font-medium transition-all min-h-11',
              'focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-opacity-50',
              timerState.isRunning
                ? 'bg-yellow-600 hover:bg-yellow-700 text-white'
                : 'bg-green-600 hover:bg-green-700 text-white',
              timerState.isFinished && 'opacity-50 cursor-not-allowed',
            )}
            aria-label={timerState.isRunning ? 'Pause timer' : 'Start timer'}
          >
            {timerState.isRunning ? (
              <>
                <Pause className="w-4 h-4" />
                Pause
              </>
            ) : (
              <>
                <Play className="w-4 h-4" />
                Start
              </>
            )}
          </button>

          <button
            onClick={reset}
            className="flex items-center gap-2 px-4 py-3 rounded-lg font-medium bg-gray-600 hover:bg-gray-700 text-white transition-all focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-opacity-50 min-h-11"
            aria-label="Reset timer"
          >
            <RotateCcw className="w-4 h-4" />
            Reset
          </button>
        </div>

        {showPresets && (
          <div className="flex justify-center gap-2">
            {[5, 10, 20].map((minutes) => (
              <button
                key={minutes}
                onClick={() => setPresetTime(minutes)}
                className="px-4 py-2 text-sm rounded-md bg-gray-700 hover:bg-gray-600 text-gray-300 hover:text-white transition-all min-h-11"
                aria-label={`Set preset timer to ${minutes} minutes`}
              >
                {minutes}m
              </button>
            ))}
          </div>
        )}

        <div className="mt-4 text-center text-xs text-gray-500">
          Status: {timerState.isFinished ? 'Finished' : timerState.isRunning ? 'Running' : 'Stopped'}
          {timerState.isRunning && ' • AI can update while running'}
        </div>
      </div>
    </LoadingWrapper>
  );
}

export const retroTimerTestUtils = {
  toFiniteNumber,
  sanitizeDurationSeconds,
  sanitizeTimeLeftSeconds,
  deriveConfiguredDurationFromPatch,
  deriveTimeLeftFromPatch,
  buildNextSnapshot,
  parseRuntimeState,
  statesEqual,
};
