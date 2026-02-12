export interface MutationEnvelope {
  idempotencyKey: string;
  lockKey: string;
}

export interface MutationArbiterResult<T> {
  deduped: boolean;
  value?: T;
}

/**
 * Single-writer mutation arbiter.
 * - Serializes writes per lockKey.
 * - Drops duplicates by idempotencyKey within TTL.
 */
export class MutationArbiter {
  private readonly lockChains = new Map<string, Promise<void>>();
  private readonly seenIds = new Map<string, number>();

  constructor(private readonly dedupeTtlMs: number = 30_000) {}

  private prune(now: number) {
    for (const [idempotencyKey, seenAt] of this.seenIds.entries()) {
      if (now - seenAt > this.dedupeTtlMs) {
        this.seenIds.delete(idempotencyKey);
      }
    }
  }

  async run<T>(
    envelope: MutationEnvelope,
    task: () => Promise<T>,
  ): Promise<MutationArbiterResult<T>> {
    const now = Date.now();
    this.prune(now);

    if (this.seenIds.has(envelope.idempotencyKey)) {
      return { deduped: true };
    }

    const previous = this.lockChains.get(envelope.lockKey) || Promise.resolve();
    let value: T | undefined;

    const next = previous
      .catch(() => {
        // Keep chain alive even if prior mutation failed.
      })
      .then(async () => {
        value = await task();
        this.seenIds.set(envelope.idempotencyKey, Date.now());
      });

    this.lockChains.set(envelope.lockKey, next);
    try {
      await next;
      return { deduped: false, value };
    } finally {
      if (this.lockChains.get(envelope.lockKey) === next) {
        this.lockChains.delete(envelope.lockKey);
      }
    }
  }
}
