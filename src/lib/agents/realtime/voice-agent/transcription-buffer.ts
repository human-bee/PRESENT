export type PendingTranscriptionMessage = {
  text: string;
  speaker?: string;
  participantId?: string;
  participantName?: string;
  isManual: boolean;
  isFinal: boolean;
  timestamp?: number;
  serverGenerated?: boolean;
  receivedAt: number;
};

export class TranscriptionBuffer {
  private readonly pending: PendingTranscriptionMessage[] = [];
  private draining = false;
  private enabled = false;

  constructor(
    private readonly maxItems = 64,
    private readonly ttlMs = 30_000,
  ) {}

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
  }

  enqueue(message: PendingTranscriptionMessage) {
    this.pending.push(message);
    this.prune();
  }

  private prune() {
    const now = Date.now();
    while (this.pending.length > 0) {
      const first = this.pending[0];
      if (now - first.receivedAt <= this.ttlMs) break;
      this.pending.shift();
    }
    if (this.pending.length > this.maxItems) {
      this.pending.splice(0, this.pending.length - this.maxItems);
    }
  }

  async drain(
    handler: (message: PendingTranscriptionMessage) => Promise<void>,
    onError?: (error: unknown) => void,
  ) {
    if (!this.enabled) return;
    if (this.draining) return;
    this.draining = true;
    try {
      this.prune();
      while (this.pending.length > 0) {
        const next = this.pending.shift();
        if (!next) continue;
        try {
          await handler(next);
        } catch (error) {
          onError?.(error);
        }
      }
    } finally {
      this.draining = false;
    }
  }

  size() {
    return this.pending.length;
  }
}
