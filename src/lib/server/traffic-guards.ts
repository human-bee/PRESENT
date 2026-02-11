type WindowCounter = {
  windowStart: number;
  count: number;
};

type BudgetCounter = {
  windowStart: number;
  used: number;
};

const windowCounters = new Map<string, WindowCounter>();
const budgetCounters = new Map<string, BudgetCounter>();
const concurrencyCounters = new Map<string, number>();

const MAX_WINDOW_COUNTERS = 20_000;
const MAX_BUDGET_COUNTERS = 20_000;

type WindowLimitResult = {
  ok: boolean;
  remaining: number;
  retryAfterSec: number;
  current: number;
  limit: number;
};

type BudgetLimitResult = {
  ok: boolean;
  retryAfterSec: number;
  used: number;
  limit: number;
};

function pruneWindowCounters(now: number) {
  if (windowCounters.size <= MAX_WINDOW_COUNTERS) return;
  for (const [key, value] of windowCounters) {
    if (now - value.windowStart > 5 * 60_000) {
      windowCounters.delete(key);
    }
  }
}

function pruneBudgetCounters(now: number) {
  if (budgetCounters.size <= MAX_BUDGET_COUNTERS) return;
  for (const [key, value] of budgetCounters) {
    if (now - value.windowStart > 5 * 60_000) {
      budgetCounters.delete(key);
    }
  }
}

export function consumeWindowedLimit(
  key: string,
  limit: number,
  windowMs: number,
  now = Date.now(),
): WindowLimitResult {
  const safeLimit = Math.max(1, Math.floor(limit));
  const safeWindowMs = Math.max(250, Math.floor(windowMs));
  const bucket = windowCounters.get(key);

  if (!bucket || now - bucket.windowStart >= safeWindowMs) {
    windowCounters.set(key, { windowStart: now, count: 1 });
    pruneWindowCounters(now);
    return {
      ok: true,
      remaining: Math.max(0, safeLimit - 1),
      retryAfterSec: 0,
      current: 1,
      limit: safeLimit,
    };
  }

  bucket.count += 1;
  const ok = bucket.count <= safeLimit;
  const remaining = Math.max(0, safeLimit - bucket.count);
  const retryAfterSec = ok
    ? 0
    : Math.max(1, Math.ceil((bucket.windowStart + safeWindowMs - now) / 1000));
  return {
    ok,
    remaining,
    retryAfterSec,
    current: bucket.count,
    limit: safeLimit,
  };
}

export function acquireConcurrencySlot(
  key: string,
  limit: number,
): { ok: true; release: () => void; inFlight: number } | { ok: false; inFlight: number; limit: number } {
  const safeLimit = Math.max(1, Math.floor(limit));
  const inFlight = concurrencyCounters.get(key) ?? 0;
  if (inFlight >= safeLimit) {
    return { ok: false, inFlight, limit: safeLimit };
  }
  const next = inFlight + 1;
  concurrencyCounters.set(key, next);
  let released = false;
  return {
    ok: true,
    inFlight: next,
    release: () => {
      if (released) return;
      released = true;
      const current = concurrencyCounters.get(key) ?? 0;
      if (current <= 1) {
        concurrencyCounters.delete(key);
      } else {
        concurrencyCounters.set(key, current - 1);
      }
    },
  };
}

export function consumeBudget(
  metric: string,
  amount: number,
  limit: number,
  windowMs = 60_000,
  now = Date.now(),
): BudgetLimitResult {
  const safeLimit = Math.max(1, Math.floor(limit));
  const safeWindowMs = Math.max(1_000, Math.floor(windowMs));
  const safeAmount = Math.max(0, Math.ceil(amount));
  const key = `${metric}:${Math.floor(now / safeWindowMs)}`;
  const bucket = budgetCounters.get(key);
  if (!bucket) {
    budgetCounters.set(key, { windowStart: now, used: safeAmount });
    pruneBudgetCounters(now);
    return {
      ok: safeAmount <= safeLimit,
      retryAfterSec: safeAmount <= safeLimit ? 0 : Math.max(1, Math.ceil(safeWindowMs / 1000)),
      used: safeAmount,
      limit: safeLimit,
    };
  }

  bucket.used += safeAmount;
  const ok = bucket.used <= safeLimit;
  return {
    ok,
    retryAfterSec: ok ? 0 : Math.max(1, Math.ceil((bucket.windowStart + safeWindowMs - now) / 1000)),
    used: bucket.used,
    limit: safeLimit,
  };
}

export function isCostCircuitBreakerEnabled(): boolean {
  return (process.env.COST_CIRCUIT_BREAKER_ENABLED ?? 'false').toLowerCase() === 'true';
}
