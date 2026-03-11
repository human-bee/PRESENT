import {
  createVoiceControlMessage,
  parseVoiceControlMessage,
  resolveVoiceTurnModeForParticipant,
  shouldSuppressAutomaticTurn,
} from './voice-control';

describe('voice control contract', () => {
  it('builds a turn-mode message with trimmed identifiers', () => {
    expect(
      createVoiceControlMessage({
        mode: 'manual',
        participantId: '  user-1  ',
        roomId: ' canvas-123 ',
        timestamp: 123,
      }),
    ).toEqual({
      type: 'turn_mode',
      mode: 'manual',
      participantId: 'user-1',
      roomId: 'canvas-123',
      timestamp: 123,
    });
  });

  it('parses valid control messages and rejects unrelated payloads', () => {
    expect(
      parseVoiceControlMessage({
        type: 'turn_mode',
        mode: 'auto',
        timestamp: 456,
      }),
    ).toEqual({
      type: 'turn_mode',
      mode: 'auto',
      timestamp: 456,
    });

    expect(parseVoiceControlMessage({ type: 'live_transcription', text: 'hello' })).toBeNull();
  });

  it('suppresses only automatic turns while manual mode is active', () => {
    expect(shouldSuppressAutomaticTurn('manual', false)).toBe(true);
    expect(shouldSuppressAutomaticTurn('manual', true)).toBe(false);
    expect(shouldSuppressAutomaticTurn('auto', false)).toBe(false);
  });

  it('resolves turn mode per participant without leaking across users', () => {
    const modes = new Map<string, 'auto' | 'manual'>([
      ['user-1', 'manual'],
      ['user-2', 'auto'],
    ]);

    expect(
      resolveVoiceTurnModeForParticipant(modes, {
        participantId: 'user-1',
      }),
    ).toBe('manual');

    expect(
      resolveVoiceTurnModeForParticipant(modes, {
        fallbackParticipantIds: ['user-1'],
      }),
    ).toBe('manual');

    expect(
      resolveVoiceTurnModeForParticipant(modes, {
        fallbackParticipantIds: ['user-1', 'user-2'],
      }),
    ).toBe('auto');
  });
});
