"use client";

import { useCallback, useMemo, useReducer } from 'react';
import {
  createQueueJob,
  initialQueueState,
  queueReducer,
  type QueueAction,
} from '../utils/queueReducer';
import type { ToolJob, ToolQueueState } from '../utils/toolTypes';

export interface ToolQueueApi {
  state: ToolQueueState;
  enqueue: (id: string, tool: string) => ToolJob;
  markStarted: (id: string) => void;
  markComplete: (id: string, message?: string) => void;
  markError: (id: string, error: string) => void;
  reset: () => void;
}

export function useToolQueue(): ToolQueueApi {
  const [state, dispatch] = useReducer(queueReducer, initialQueueState);

  const enqueue = useCallback(
    (id: string, tool: string) => {
      const job = createQueueJob(id, tool, Date.now());
      dispatch({ type: 'ENQUEUE', job } satisfies QueueAction);
      return job;
    },
    [],
  );

  const markStarted = useCallback((id: string) => {
    dispatch({ type: 'START', id, startedAt: Date.now() } satisfies QueueAction);
  }, []);

  const markComplete = useCallback((id: string, message?: string) => {
    dispatch({ type: 'COMPLETE', id, finishedAt: Date.now(), message } satisfies QueueAction);
  }, []);

  const markError = useCallback((id: string, error: string) => {
    dispatch({ type: 'ERROR', id, finishedAt: Date.now(), error } satisfies QueueAction);
  }, []);

  const reset = useCallback(() => {
    dispatch({ type: 'RESET' } satisfies QueueAction);
  }, []);

  return useMemo(
    () => ({ state, enqueue, markStarted, markComplete, markError, reset }),
    [state, enqueue, markStarted, markComplete, markError, reset],
  );
}
