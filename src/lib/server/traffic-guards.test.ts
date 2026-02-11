import { acquireConcurrencySlot, consumeBudget, consumeWindowedLimit } from '@/lib/server/traffic-guards';

describe('traffic guards', () => {
  it('enforces windowed request limits and reports retry-after', () => {
    const start = 1_000_000;
    const k = 'test:window';
    const first = consumeWindowedLimit(k, 2, 1_000, start);
    const second = consumeWindowedLimit(k, 2, 1_000, start + 50);
    const third = consumeWindowedLimit(k, 2, 1_000, start + 100);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(third.ok).toBe(false);
    expect(third.retryAfterSec).toBeGreaterThan(0);

    const afterWindow = consumeWindowedLimit(k, 2, 1_000, start + 1_500);
    expect(afterWindow.ok).toBe(true);
    expect(afterWindow.current).toBe(1);
  });

  it('enforces concurrency slots with explicit release', () => {
    const key = 'test:concurrency';
    const slot1 = acquireConcurrencySlot(key, 2);
    const slot2 = acquireConcurrencySlot(key, 2);
    const slot3 = acquireConcurrencySlot(key, 2);

    expect(slot1.ok).toBe(true);
    expect(slot2.ok).toBe(true);
    expect(slot3.ok).toBe(false);

    if (slot1.ok) slot1.release();
    const slot4 = acquireConcurrencySlot(key, 2);
    expect(slot4.ok).toBe(true);

    if (slot2.ok) slot2.release();
    if (slot4.ok) slot4.release();
  });

  it('enforces budget ceilings per window', () => {
    const start = 5_000_000;
    const k = 'test:budget';
    const a = consumeBudget(k, 4, 10, 1_000, start);
    const b = consumeBudget(k, 5, 10, 1_000, start + 100);
    const c = consumeBudget(k, 3, 10, 1_000, start + 200);

    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    expect(c.ok).toBe(false);
    expect(c.retryAfterSec).toBeGreaterThan(0);
  });
});
