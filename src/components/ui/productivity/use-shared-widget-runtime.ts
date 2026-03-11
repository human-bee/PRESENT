'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const GAME_WIDGET_STYLE_ID = 'present-game-widget-motion';
const GAME_WIDGET_STYLE_TEXT = `
@keyframes present-dice-bounce {
  0% { transform: rotate(0deg) translateY(0px) scale(1); }
  20% { transform: rotate(-8deg) translateY(-8px) scale(1.03); }
  50% { transform: rotate(10deg) translateY(6px) scale(0.98); }
  80% { transform: rotate(-4deg) translateY(-2px) scale(1.01); }
  100% { transform: rotate(0deg) translateY(0px) scale(1); }
}

@keyframes present-card-flip {
  0% { transform: rotateY(0deg) translateY(0px); }
  20% { transform: rotateY(75deg) translateY(-6px); }
  50% { transform: rotateY(180deg) translateY(4px); }
  100% { transform: rotateY(360deg) translateY(0px); }
}
`;

type UpdateStateFn = (
  patch:
    | Record<string, unknown>
    | ((prev: Record<string, unknown> | undefined) => Record<string, unknown>),
) => void;

type SharedRuntimeOptions<T extends Record<string, unknown>> = {
  injectedState: unknown;
  updateState?: UpdateStateFn;
  parseState: (raw: unknown) => T;
  reduceState: (prev: T, patch: Record<string, unknown>, timestamp: number) => T;
  isEqual?: (left: T, right: T) => boolean;
};

const defaultIsEqual = <T extends Record<string, unknown>,>(left: T, right: T) => {
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return Object.is(left, right);
  }
};

const toFiniteNumber = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
};

export function useSharedWidgetRuntime<T extends Record<string, unknown>>({
  injectedState,
  updateState,
  parseState,
  reduceState,
  isEqual = defaultIsEqual,
}: SharedRuntimeOptions<T>) {
  const runtimeFromShape = useMemo(() => parseState(injectedState), [injectedState, parseState]);
  const [runtime, setRuntime] = useState<T>(runtimeFromShape);
  const runtimeRef = useRef(runtime);
  const syncRef = useRef(false);

  useEffect(() => {
    runtimeRef.current = runtime;
  }, [runtime]);

  useEffect(() => {
    if (syncRef.current) {
      if (isEqual(runtime, runtimeFromShape)) {
        syncRef.current = false;
      }
      return;
    }
    if (!isEqual(runtime, runtimeFromShape)) {
      setRuntime(runtimeFromShape);
    }
  }, [isEqual, runtime, runtimeFromShape]);

  const pushRuntimePatch = useCallback(
    (patchInput: Record<string, unknown>) => {
      const timestamp = toFiniteNumber(patchInput.updatedAt) ?? Date.now();
      const nextState = reduceState(runtimeRef.current, patchInput, timestamp);
      if (isEqual(runtimeRef.current, nextState)) {
        syncRef.current = false;
        return nextState;
      }

      syncRef.current = true;
      setRuntime(nextState);
      runtimeRef.current = nextState;
      updateState?.(() => nextState);
      return nextState;
    },
    [isEqual, reduceState, updateState],
  );

  return {
    runtime,
    runtimeFromShape,
    pushRuntimePatch,
  };
}

export function useReplayWindow(
  actionId: string | number | null | undefined,
  startedAt: number | null | undefined,
  durationMs: number,
) {
  const [isActive, setIsActive] = useState(false);

  useEffect(() => {
    if (!actionId || !startedAt || !Number.isFinite(startedAt)) {
      setIsActive(false);
      return;
    }

    const elapsed = Date.now() - startedAt;
    const remaining = durationMs - elapsed;
    if (remaining <= 0) {
      setIsActive(false);
      return;
    }

    setIsActive(true);
    const timeout = window.setTimeout(() => setIsActive(false), remaining);
    return () => window.clearTimeout(timeout);
  }, [actionId, durationMs, startedAt]);

  return isActive;
}

export function useSharedGameAnimationStyles() {
  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (document.getElementById(GAME_WIDGET_STYLE_ID)) return;

    const style = document.createElement('style');
    style.id = GAME_WIDGET_STYLE_ID;
    style.textContent = GAME_WIDGET_STYLE_TEXT;
    document.head.appendChild(style);
  }, []);
}
