export function shouldExecuteIncomingToolCall(args: {
  isExecutor: boolean;
  processed: Map<string, number>;
  roomKey: string;
  callId: string;
  now: number;
  ttlMs?: number;
}): { execute: boolean; key: string; reason?: 'not_executor' | 'deduped' } {
  const { isExecutor, processed, roomKey, callId, now, ttlMs = 120_000 } = args;
  for (const [key, ts] of processed.entries()) {
    if (now - ts > ttlMs) {
      processed.delete(key);
    }
  }
  if (!isExecutor) {
    return { execute: false, key: `${roomKey}:${callId}`, reason: 'not_executor' };
  }
  const key = `${roomKey}:${callId}`;
  if (processed.has(key)) {
    return { execute: false, key, reason: 'deduped' };
  }
  processed.set(key, now);
  return { execute: true, key };
}

export function shouldDeferToolCallWhenNotExecutor(args: {
  reason?: 'not_executor' | 'deduped';
  executorIdentity?: string | null;
  localIdentity?: string | null;
}): boolean {
  if (args.reason !== 'not_executor') return false;
  const executorIdentity = typeof args.executorIdentity === 'string' ? args.executorIdentity.trim() : '';
  const localIdentity = typeof args.localIdentity === 'string' ? args.localIdentity.trim() : '';
  if (!executorIdentity) return true;
  return Boolean(localIdentity) && executorIdentity === localIdentity;
}
