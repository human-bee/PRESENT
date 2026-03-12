'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const GAME_WIDGET_STYLE_ID = 'present-game-widget-motion';
const GAME_WIDGET_STYLE_TEXT = `
@keyframes present-dice-bounce {
  0% { transform: rotateX(0deg) rotateY(0deg) rotateZ(0deg) translateY(0px) scale3d(1, 1, 1); }
  18% { transform: rotateX(18deg) rotateY(-26deg) rotateZ(-10deg) translateY(-18px) scale3d(1.02, 1.02, 1.02); }
  38% { transform: rotateX(-28deg) rotateY(42deg) rotateZ(16deg) translateY(8px) scale3d(0.98, 0.98, 0.98); }
  62% { transform: rotateX(24deg) rotateY(-44deg) rotateZ(-12deg) translateY(-10px) scale3d(1.03, 1.03, 1.03); }
  82% { transform: rotateX(-12deg) rotateY(18deg) rotateZ(6deg) translateY(4px) scale3d(0.99, 0.99, 0.99); }
  100% { transform: rotateX(0deg) rotateY(0deg) rotateZ(0deg) translateY(0px) scale3d(1, 1, 1); }
}

@keyframes present-dice-shadow {
  0% { transform: scaleX(1) scaleY(1); opacity: 0.28; }
  22% { transform: scaleX(0.82) scaleY(0.8); opacity: 0.16; }
  58% { transform: scaleX(1.14) scaleY(1.08); opacity: 0.3; }
  100% { transform: scaleX(1) scaleY(1); opacity: 0.24; }
}

@keyframes present-card-flip {
  0% { transform: rotateY(0deg) rotateZ(0deg) translateY(0px); }
  20% { transform: rotateY(88deg) rotateZ(-4deg) translateY(-14px); }
  48% { transform: rotateY(180deg) rotateZ(3deg) translateY(6px); }
  76% { transform: rotateY(292deg) rotateZ(-2deg) translateY(-8px); }
  100% { transform: rotateY(360deg) rotateZ(0deg) translateY(0px); }
}

@keyframes present-card-shadow {
  0% { transform: scale(1); opacity: 0.2; }
  30% { transform: scale(0.88); opacity: 0.1; }
  66% { transform: scale(1.08); opacity: 0.24; }
  100% { transform: scale(1); opacity: 0.18; }
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

const defaultIsEqual = <T extends Record<string, unknown>>(left: T, right: T) => {
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
