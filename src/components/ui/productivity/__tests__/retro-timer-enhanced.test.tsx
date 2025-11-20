import { retroTimerTestUtils } from '../retro-timer-enhanced';

const { buildNextSnapshot } = retroTimerTestUtils;

function createSnapshot(overrides: Partial<ReturnType<typeof buildNextSnapshot>> = {}) {
  return {
    configuredDuration: 300,
    timeLeft: 300,
    isRunning: false,
    isFinished: false,
    updatedAt: 0,
    ...overrides,
  };
}

describe('RetroTimerEnhanced update sanitization', () => {
  it('coerces string minute patches into duration seconds', () => {
    const prev = createSnapshot();
    const patch = { initialMinutes: '7', updatedAt: 123 } as Record<string, unknown>;
    const next = buildNextSnapshot(prev, patch, prev.configuredDuration, Date.now());

    expect(next.configuredDuration).toBe(420);
    expect(next.timeLeft).toBe(420);
    expect(next.isRunning).toBe(false);
    expect(next.isFinished).toBe(false);
  });

  it('respects isRunning toggles when runtime patch sets it', () => {
    const prev = createSnapshot({ timeLeft: 0, isFinished: true });
    const patch = {
      isRunning: true,
      isFinished: false,
      configuredDuration: 420,
      timeLeft: 420,
      updatedAt: 456,
    } as Record<string, unknown>;

    const next = buildNextSnapshot(prev, patch, 300, Date.now());

    expect(next.isRunning).toBe(true);
    expect(next.isFinished).toBe(false);
    expect(next.timeLeft).toBe(420);
  });
});
