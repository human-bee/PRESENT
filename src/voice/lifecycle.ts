/** Session ownership and retry scheduling, independent of React and browser media. */
export const VOICE_RETRY_DELAYS = [500, 1500, 3500] as const;
export class VoiceFailure extends Error {
  constructor(message: string, readonly retryable = false) { super(message); }
}
type Clock = { set: (fn: () => void, ms: number) => unknown; clear: (timer: unknown) => void };
export function createVoiceLifecycle<S>(options: {
  create: () => S; connect: (session: S) => Promise<void>;
  quiesce: (session: S) => void; drain: (session: S, graceful: boolean) => Promise<void>;
  release: (session: S) => Promise<void>; status: (status: 'idle' | 'connecting' | 'error') => void;
  error: (message: string | null) => void; clock?: Clock;
}) {
  const clock = options.clock ?? { set: (fn, ms) => setTimeout(fn, ms), clear: timer => clearTimeout(timer as ReturnType<typeof setTimeout>) };
  let active: S | null = null, wanted = false, epoch = 0, attempts = 0, timer: unknown;
  let retiring: Promise<void> = Promise.resolve();
  const cancelTimer = () => { if (timer !== undefined) clock.clear(timer); timer = undefined; };
  const current = (session: S) => active === session;
  const retire = (session: S, graceful: boolean) => {
    if (!current(session)) return retiring;
    active = null; // Detach before any await; an old shutdown cannot touch its successor.
    options.quiesce(session);
    retiring = (async () => {
      try { await options.drain(session, graceful); }
      finally { await options.release(session); }
    })().catch(() => { /* Cleanup is best effort; the server lease also expires. */ });
    return retiring;
  };
  const launch = async (generation: number) => {
    await retiring;
    if (!wanted || epoch !== generation || active) return;
    const session = options.create(); active = session;
    try { await options.connect(session); }
    catch (cause) { fail(session, cause); }
  };
  const fail = (session: S, cause: unknown) => {
    if (!current(session)) return;
    const message = cause instanceof Error ? cause.message : 'Voice connection failed.';
    const recovery = cause instanceof VoiceFailure && cause.retryable && wanted && attempts < VOICE_RETRY_DELAYS.length;
    const generation = epoch;
    void retire(session, false);
    if (!recovery) { wanted = false; options.error(message); options.status('error'); return; }
    const delay = VOICE_RETRY_DELAYS[attempts++];
    options.error(`${message} Reconnecting (${attempts}/${VOICE_RETRY_DELAYS.length})…`);
    options.status('connecting');
    timer = clock.set(() => { timer = undefined; if (wanted && epoch === generation) void launch(generation); }, delay);
  };
  return {
    current, fail, get active() { return active; },
    start() {
      if (wanted || active) return;
      wanted = true; attempts = 0; cancelTimer(); options.error(null); options.status('connecting');
      void launch(++epoch);
    },
    stop(graceful = true) {
      wanted = false; ++epoch; cancelTimer();
      const done = active ? retire(active, graceful) : retiring;
      options.status('idle'); return done;
    },
    snapshot: () => Object.freeze({ active: active !== null, wanted, attempts, retryPending: timer !== undefined }),
  };
}

/** A bounded wait that always clears its timer, including the fast path. */
export async function waitAtMost<T>(pending: Promise<T>, ms: number): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([pending, new Promise<undefined>(resolve => { timer = setTimeout(() => resolve(undefined), ms); })]); }
  finally { clearTimeout(timer); }
}

export function pauseVoice(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(signal.reason); return; }
    const finish = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); resolve(); };
    const abort = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); reject(signal.reason); };
    const timer = setTimeout(finish, ms);
    signal.addEventListener('abort', abort, { once: true });
  });
}
