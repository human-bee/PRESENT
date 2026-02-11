import { VoiceComponentLedger } from '../component-ledger';

describe('VoiceComponentLedger', () => {
  it('tracks per-room last component state independently', () => {
    let room = 'room-a';
    const ledger = new VoiceComponentLedger(() => room);

    ledger.setLastComponentForType('DebateScorecard', 'score-a');
    ledger.setLastCreatedComponentId('score-a');
    ledger.setRecentCreateFingerprint('DebateScorecard', {
      fingerprint: 'f-a',
      messageId: 'score-a',
      createdAt: 1,
      turnId: 1,
      intentId: 'intent-a',
    });

    room = 'room-b';
    expect(ledger.getLastComponentForType('DebateScorecard')).toBeUndefined();
    expect(ledger.getLastCreatedComponentId()).toBeNull();
    expect(ledger.getRecentCreateFingerprint('DebateScorecard')).toBeUndefined();

    ledger.setLastComponentForType('DebateScorecard', 'score-b');
    expect(ledger.getLastComponentForType('DebateScorecard')).toBe('score-b');

    room = 'room-a';
    expect(ledger.getLastComponentForType('DebateScorecard')).toBe('score-a');
    expect(ledger.getLastCreatedComponentId()).toBe('score-a');
    expect(ledger.getRecentCreateFingerprint('DebateScorecard')?.intentId).toBe('intent-a');
  });
});
