import { normalizeComponentPatch, normalizeSpecInput } from '../tool-publishing';

describe('voice-agent normalize helpers', () => {
  it('normalizes JSON spec input', () => {
    expect(normalizeSpecInput('{"title":"Timer"}')).toEqual({ title: 'Timer' });
    expect(normalizeSpecInput('not-json')).toEqual({});
  });

  it('normalizes duration minutes into canonical timer fields', () => {
    const patch = normalizeComponentPatch({ durationMinutes: '7' as any }, 300);
    expect(patch.configuredDuration).toBe(420);
    expect(patch.initialMinutes).toBe(7);
    expect(patch.initialSeconds).toBe(0);
    expect(patch.timeLeft).toBe(420);
  });

  it('handles reset command', () => {
    const patch = normalizeComponentPatch({ command: 'reset', configuredDuration: 180 as any }, 300);
    expect(patch.isRunning).toBe(false);
    expect(patch.isFinished).toBe(false);
    expect(patch.timeLeft).toBe(180);
  });
});
