import { resolveApplyModeForPath } from './apply-mode';

describe('resolveApplyModeForPath', () => {
  it('marks voice and realtime paths as next_session', () => {
    expect(resolveApplyModeForPath('knobs.voice.replyTimeoutMs')).toBe('next_session');
    expect(resolveApplyModeForPath('knobs.voice.turnDetection')).toBe('next_session');
    expect(resolveApplyModeForPath('models.voiceRealtime')).toBe('next_session');
  });

  it('marks conductor lease and retry settings as restart_required', () => {
    expect(resolveApplyModeForPath('knobs.conductor.taskLeaseTtlMs')).toBe('restart_required');
    expect(resolveApplyModeForPath('knobs.conductor.taskRetryBaseDelayMs')).toBe('restart_required');
  });

  it('defaults unrelated paths to live', () => {
    expect(resolveApplyModeForPath('models.canvasSteward')).toBe('live');
    expect(resolveApplyModeForPath('knobs.canvas.temperature')).toBe('live');
  });
});
