import { waitAtMost } from './lifecycle';
export const MAX_PENDING_CAPTIONS = 128;
/** Caption requests outlive transport teardown, but never outlive the bounded drain. */
export function createCaptionQueue(write: (signal: AbortSignal, id: string, role: 'user' | 'assistant', text: string) => Promise<void>, error: (cause: unknown) => void) {
  const abort = new AbortController();
  let tail = Promise.resolve(), pending = 0, accepting = true;
  return {
    append(id: string, role: 'user' | 'assistant', text: string) {
      if (!accepting || abort.signal.aborted) return;
      if (pending >= MAX_PENDING_CAPTIONS) { error(new Error('Final caption queue is full; some captions could not be saved.')); return; }
      pending++;
      tail = tail.then(async () => {
        abort.signal.throwIfAborted();
        await write(AbortSignal.any([abort.signal, AbortSignal.timeout(2000)]), id, role, text);
      }).catch(error).finally(() => { pending--; });
    },
    async drain() {
      accepting = false;
      try { await waitAtMost(tail, 2000); }
      finally {
        if (pending) error(new Error('Final caption saving timed out; some captions may not have been saved.'));
        abort.abort();
      }
    },
    snapshot: () => Object.freeze({ pending, accepting }),
  };
}
