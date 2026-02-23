import {
  ActiveResponseRecoveryGuard,
  TranscriptDedupeGuard,
  isActiveResponseError,
} from '../runtime-guards';

describe('TranscriptDedupeGuard', () => {
  it('drops duplicate event ids inside the dedupe window', () => {
    const guard = new TranscriptDedupeGuard(2_000, 64);
    const first = guard.shouldDrop(
      {
        eventId: 'evt-1',
        text: 'hello world',
        participantId: 'p1',
        isManual: false,
        isFinal: true,
        timestamp: 1_000,
      },
      1_000,
    );
    const second = guard.shouldDrop(
      {
        eventId: 'evt-1',
        text: 'hello world',
        participantId: 'p1',
        isManual: false,
        isFinal: true,
        timestamp: 1_200,
      },
      1_200,
    );

    expect(first.drop).toBe(false);
    expect(second.drop).toBe(true);
    expect(second.reason).toBe('event_id');
  });

  it('drops duplicate fingerprints even when event id changes', () => {
    const guard = new TranscriptDedupeGuard(2_000, 64);
    const first = guard.shouldDrop(
      {
        eventId: 'evt-1',
        text: 'start 5 minute timer',
        participantId: 'p1',
        isManual: false,
        isFinal: true,
        timestamp: 1_000,
        serverGenerated: false,
      },
      1_000,
    );
    const second = guard.shouldDrop(
      {
        eventId: 'evt-2',
        text: 'start 5 minute timer',
        participantId: 'p1',
        isManual: false,
        isFinal: true,
        timestamp: 1_100,
        serverGenerated: false,
      },
      1_100,
    );

    expect(first.drop).toBe(false);
    expect(second.drop).toBe(true);
    expect(second.reason).toBe('fingerprint');
  });

  it('does not fingerprint-dedupe manual retries when event ids differ', () => {
    const guard = new TranscriptDedupeGuard(2_000, 64);
    const first = guard.shouldDrop(
      {
        eventId: 'evt-1',
        text: 'stop timer',
        participantId: 'p1',
        isManual: true,
        isFinal: true,
        timestamp: 1_000,
      },
      1_000,
    );
    const second = guard.shouldDrop(
      {
        eventId: 'evt-2',
        text: 'stop timer',
        participantId: 'p1',
        isManual: true,
        isFinal: true,
        timestamp: 1_050,
      },
      1_050,
    );

    expect(first.drop).toBe(false);
    expect(second.drop).toBe(false);
  });

  it('allows a repeated fingerprint after the dedupe window expires', () => {
    const guard = new TranscriptDedupeGuard(1_000, 64);
    guard.shouldDrop(
      {
        eventId: 'evt-1',
        text: 'hello world',
        participantId: 'p1',
        isManual: false,
        isFinal: true,
        timestamp: 1_000,
      },
      1_000,
    );

    const next = guard.shouldDrop(
      {
        eventId: 'evt-2',
        text: 'hello world',
        participantId: 'p1',
        isManual: false,
        isFinal: true,
        timestamp: 2_200,
      },
      2_200,
    );

    expect(next.drop).toBe(false);
  });
});

describe('ActiveResponseRecoveryGuard', () => {
  it('enforces bounded recovery attempts in the active window', () => {
    const guard = new ActiveResponseRecoveryGuard(2, 5_000);
    expect(guard.registerAttempt(1_000)).toMatchObject({
      allowed: true,
      attempts: 1,
      maxAttempts: 2,
    });
    expect(guard.registerAttempt(1_500)).toMatchObject({
      allowed: true,
      attempts: 2,
      maxAttempts: 2,
    });
    expect(guard.registerAttempt(2_000)).toMatchObject({
      allowed: false,
      attempts: 3,
      maxAttempts: 2,
    });
  });

  it('resets after clear', () => {
    const guard = new ActiveResponseRecoveryGuard(1, 5_000);
    expect(guard.registerAttempt(1_000).allowed).toBe(true);
    expect(guard.registerAttempt(1_500).allowed).toBe(false);
    guard.clear();
    expect(guard.registerAttempt(2_000).allowed).toBe(true);
  });
});

describe('isActiveResponseError', () => {
  it('matches canonical conversation active response code', () => {
    expect(
      isActiveResponseError({
        code: 'conversation_already_has_active_response',
      }),
    ).toBe(true);
  });

  it('matches active response wording in error message', () => {
    expect(
      isActiveResponseError(new Error('Conversation already has an active response in progress')),
    ).toBe(true);
  });

  it('does not match unrelated errors', () => {
    expect(isActiveResponseError(new Error('random failure'))).toBe(false);
  });
});
