import { resolveApplyModeForPath } from './guided-config';

describe('resolveApplyModeForPath', () => {
  it('treats voice knob updates as next_session by default', () => {
    expect(resolveApplyModeForPath('knobs.voice.replyTimeoutMs', undefined)).toBe('next_session');
    expect(resolveApplyModeForPath('knobs.voice.turnDetection', null)).toBe('next_session');
  });

  it('honors explicit apply mode metadata when present', () => {
    expect(
      resolveApplyModeForPath('knobs.voice.replyTimeoutMs', {
        'knobs.voice.replyTimeoutMs': 'restart_required',
      }),
    ).toBe('restart_required');
  });
});
