import type { OrchestrationEnvelope } from '@/lib/agents/shared/orchestration-envelope';

type LockState = {
  tail: Promise<void>;
  pending: number;
};

export type MutationArbiterResult<T> = {
  result: T;
  deduped: boolean;
};

const DEFAULT_IDEMPOTENCY_TTL_MS = 10 * 60 * 1000;

export class MutationArbiter {
  private readonly lockStates = new Map<string, LockState>();
  private readonly completedByLock = new Map<string, Map<string, number>>();

  constructor(private readonly idempotencyTtlMs: number = DEFAULT_IDEMPOTENCY_TTL_MS) {}

  private getLockState(lockKey: string): LockState {
    const existing = this.lockStates.get(lockKey);
    if (existing) return existing;
    const created: LockState = { tail: Promise.resolve(), pending: 0 };
    this.lockStates.set(lockKey, created);
    return created;
  }

  private cleanupCompleted(lockKey: string, now: number) {
    const lockMap = this.completedByLock.get(lockKey);
    if (!lockMap) return;
    for (const [idempotencyKey, completedAt] of lockMap.entries()) {
      if (now - completedAt > this.idempotencyTtlMs) {
        lockMap.delete(idempotencyKey);
      }
    }
    if (lockMap.size === 0) {
      this.completedByLock.delete(lockKey);
    }
  }

  private isDeduped(lockKey: string, idempotencyKey: string, now: number): boolean {
    this.cleanupCompleted(lockKey, now);
    return Boolean(this.completedByLock.get(lockKey)?.has(idempotencyKey));
  }

  private markCompleted(lockKey: string, idempotencyKey: string, now: number) {
    let lockMap = this.completedByLock.get(lockKey);
    if (!lockMap) {
      lockMap = new Map<string, number>();
      this.completedByLock.set(lockKey, lockMap);
    }
    lockMap.set(idempotencyKey, now);
  }

  async execute<T>(
    envelope: OrchestrationEnvelope,
    mutate: () => Promise<T>,
  ): Promise<MutationArbiterResult<T>> {
    const lockKey =
      typeof envelope.lockKey === 'string' && envelope.lockKey.trim().length > 0
        ? envelope.lockKey.trim()
        : '';
    const idempotencyKey =
      typeof envelope.idempotencyKey === 'string' && envelope.idempotencyKey.trim().length > 0
        ? envelope.idempotencyKey.trim()
        : '';

    if (!lockKey) {
      const result = await mutate();
      return { result, deduped: false };
    }

    const now = Date.now();
    const state = this.getLockState(lockKey);
    state.pending += 1;

    const runPromise = state.tail.then(async () => {
      if (idempotencyKey && this.isDeduped(lockKey, idempotencyKey, Date.now())) {
        return { result: ({ status: 'deduped' } as T), deduped: true };
      }
      const result = await mutate();
      if (idempotencyKey) {
        this.markCompleted(lockKey, idempotencyKey, Date.now());
      }
      return { result, deduped: false };
    });

    state.tail = runPromise.then(
      () => undefined,
      () => undefined,
    );

    try {
      return await runPromise;
    } finally {
      state.pending -= 1;
      this.cleanupCompleted(lockKey, now);
      if (state.pending <= 0) {
        this.lockStates.delete(lockKey);
      }
    }
  }
}

