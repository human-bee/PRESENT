import { AccessError } from './store';
/** Fixed-window, bounded memory. Socket peer only; never trust X-Forwarded-For. */
export class AccessRateLimit {
  private buckets = new Map<string, { count: number; reset: number }>();
  constructor(private limit = 20, private windowMs = 60_000, private capacity = 2048, private now = Date.now) {}
  take(key: string) {
    const now = this.now();
    for (const [id, bucket] of this.buckets) if (bucket.reset <= now) this.buckets.delete(id);
    let bucket = this.buckets.get(key);
    if (!bucket) {
      if (this.buckets.size >= this.capacity) throw new AccessError('Please wait before trying again.', 429);
      bucket = { count: 0, reset: now + this.windowMs }; this.buckets.set(key, bucket);
    }
    if (++bucket.count > this.limit) throw new AccessError('Please wait a minute before trying again.', 429);
  }
}
