import { createHash } from 'crypto';

export type TranscriptDedupeInput = {
  eventId?: string;
  text: string;
  participantId?: string;
  speaker?: string;
  isManual: boolean;
  isFinal: boolean;
  timestamp?: number;
  serverGenerated?: boolean;
};

type SeenEntry = {
  at: number;
};

export class TranscriptDedupeGuard {
  private readonly seen = new Map<string, SeenEntry>();

  constructor(
    private readonly windowMs: number,
    private readonly maxEntries: number,
  ) {}

  shouldDrop(
    input: TranscriptDedupeInput,
    now = Date.now(),
  ): { drop: boolean; reason?: string; key: string } {
    const eventId = typeof input.eventId === 'string' ? input.eventId.trim() : '';
    const eventKey = eventId ? `event:${eventId}` : '';
    const manualEventOnly = input.isManual && Boolean(eventKey);
    const fingerprintKey = `fingerprint:${this.buildFingerprint(input, now)}`;

    this.prune(now);

    if (eventKey) {
      const seenEvent = this.seen.get(eventKey);
      if (seenEvent && now - seenEvent.at <= this.windowMs) {
        return { drop: true, reason: 'event_id', key: eventKey };
      }
    }

    if (manualEventOnly) {
      this.seen.set(eventKey, { at: now });
      this.prune(now);
      return { drop: false, key: eventKey };
    }

    const seenFingerprint = this.seen.get(fingerprintKey);
    if (seenFingerprint && now - seenFingerprint.at <= this.windowMs) {
      return { drop: true, reason: 'fingerprint', key: fingerprintKey };
    }

    if (eventKey) {
      this.seen.set(eventKey, { at: now });
    }
    this.seen.set(fingerprintKey, { at: now });

    this.prune(now);
    return { drop: false, key: fingerprintKey };
  }

  private buildFingerprint(input: TranscriptDedupeInput, now: number): string {
    const text = input.text.trim().toLowerCase();
    const speaker =
      (typeof input.participantId === 'string' && input.participantId.trim()) ||
      (typeof input.speaker === 'string' && input.speaker.trim()) ||
      'unknown';
    const ts = typeof input.timestamp === 'number' ? input.timestamp : now;
    const bucket = Math.floor(ts / Math.max(250, Math.floor(this.windowMs / 2)));
    const parts = [
      text,
      speaker,
      String(input.isManual),
      String(input.isFinal),
      String(Boolean(input.serverGenerated)),
      String(bucket),
    ];
    return createHash('sha1').update(parts.join('|')).digest('hex');
  }

  private prune(now: number) {
    const cutoff = now - this.windowMs;
    for (const [key, value] of this.seen.entries()) {
      if (value.at >= cutoff) continue;
      this.seen.delete(key);
    }
    while (this.seen.size > this.maxEntries) {
      const first = this.seen.keys().next().value;
      if (!first) break;
      this.seen.delete(first);
    }
  }
}

export class ActiveResponseRecoveryGuard {
  private attempts = 0;
  private windowOpenedAt = 0;

  constructor(
    private readonly maxAttempts: number,
    private readonly windowMs = 15_000,
  ) {}

  registerAttempt(now = Date.now()): { allowed: boolean; attempts: number; maxAttempts: number } {
    if (this.windowOpenedAt <= 0 || now - this.windowOpenedAt > this.windowMs) {
      this.windowOpenedAt = now;
      this.attempts = 0;
    }
    this.attempts += 1;
    return {
      allowed: this.attempts <= this.maxAttempts,
      attempts: this.attempts,
      maxAttempts: this.maxAttempts,
    };
  }

  clear() {
    this.windowOpenedAt = 0;
    this.attempts = 0;
  }
}

export const isActiveResponseError = (error: unknown): boolean => {
  if (!error) return false;
  const rawMessage =
    typeof (error as { message?: unknown })?.message === 'string'
      ? (error as { message: string }).message
      : '';
  const message = rawMessage.toLowerCase();
  const code =
    (error as { code?: string })?.code ||
    (error as { error?: { code?: string } })?.error?.code ||
    (error as { detail?: { code?: string } })?.detail?.code;
  return (
    code === 'conversation_already_has_active_response' ||
    message.includes('active response') ||
    message.includes('already has an active response')
  );
};
