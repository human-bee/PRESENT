import type { DebateScorecardState } from '@/lib/agents/debate-scorecard-schema';
import { applyDebateScorecardOps, type DebateScorecardOperation } from './debate-scorecard-ops';

type ComponentOps =
  | { component: 'DebateScorecard'; ops: DebateScorecardOperation[] }
  | { component: string; ops: unknown[] };

export type ComponentOperation = ComponentOps['ops'][number];

type Reducer = (state: unknown, ops: unknown[]) => unknown;

const reducers = new Map<string, Reducer>([
  [
    'DebateScorecard',
    (state, ops) => applyDebateScorecardOps(state as DebateScorecardState, ops as DebateScorecardOperation[]),
  ],
]);

export function applyComponentOps(
  componentType: string,
  state: Record<string, unknown>,
  ops: unknown[],
): Record<string, unknown> {
  if (!Array.isArray(ops) || ops.length === 0) {
    return state;
  }
  const reducer = reducers.get(componentType);
  if (!reducer) {
    return state;
  }
  try {
    const next = reducer(state, ops);
    if (next && typeof next === 'object') {
      return next as Record<string, unknown>;
    }
    return state;
  } catch (error) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[ComponentReducers] failed to apply ops', { componentType, error });
    }
    return state;
  }
}

