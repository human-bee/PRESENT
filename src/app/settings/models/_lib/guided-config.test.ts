import { resolveApplyModeForPath } from './guided-config';

describe('resolveApplyModeForPath', () => {
  it('treats voice runtime knobs as live by default', () => {
    expect(resolveApplyModeForPath('knobs.voice.replyTimeoutMs', undefined)).toBe('live');
    expect(resolveApplyModeForPath('knobs.voice.turnDetection', null)).toBe('live');
  });

  it('honors explicit apply mode metadata when present', () => {
    expect(
      resolveApplyModeForPath('knobs.voice.replyTimeoutMs', {
        'knobs.voice.replyTimeoutMs': 'restart_required',
      }),
    ).toBe('restart_required');
  });
});
