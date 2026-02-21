import { TEACHER_ACTIONS_BY_PROFILE } from './teacher';
import { FAIRY_PARITY_ACTIONS, getFairyParityEntry, getFairyParitySummary } from './fairy-parity-matrix';

describe('fairy parity matrix', () => {
  it('covers every fairy48 action exactly once', () => {
    expect(FAIRY_PARITY_ACTIONS).toHaveLength(48);
    expect(new Set(FAIRY_PARITY_ACTIONS)).toEqual(new Set(TEACHER_ACTIONS_BY_PROFILE.fairy48));
  });

  it('marks every fairy48 action as ready with explicit executor class', () => {
    for (const actionName of FAIRY_PARITY_ACTIONS) {
      const entry = getFairyParityEntry(actionName);
      expect(entry.ready).toBe(true);
      expect(entry.executor).toMatch(/canvas-dispatch|server-orchestration|server-meta/);
      expect(entry.sideEffect.length).toBeGreaterThan(8);
    }
  });

  it('summarizes coverage for cli capability output', () => {
    expect(getFairyParitySummary()).toMatchObject({
      total: 48,
      ready: 48,
      notReady: 0,
    });
  });
});
