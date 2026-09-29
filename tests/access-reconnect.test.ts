import assert from 'node:assert/strict';
import test from 'node:test';
import { RoomAccessError, roomAccessClient } from '../src/access/client';
import { watchRoomAccess } from '../src/access/watch-access';

const settle = async () => { await new Promise(resolve => setImmediate(resolve)); };
function fixture(check: (roomId: string, signal: AbortSignal) => Promise<unknown>, expiresAt = 5000) {
  let ended = 0, closed = 0, time = 0;
  const listeners = new Map<string, () => void>();
  const timers: { run: () => void; ms: number }[] = [];
  const events = { onerror: null as (() => void) | null, addEventListener: (name: string, listener: () => void) => listeners.set(name, listener), close: () => { closed++; } };
  const dispose = watchRoomAccess({ roomId: 'room', userId: 'user', role: 'editor', expiresAt }, () => { ended++; }, {
    createEvents: () => events, check, now: () => time,
    schedule: (run, ms) => { timers.push({ run, ms }); return timers.length as unknown as ReturnType<typeof setTimeout>; }, cancel: () => {},
  });
  return { events, listeners, timers, dispose, advance: (ms: number) => { time += ms; }, ended: () => ended, closed: () => closed };
}
test('offline, timeout, proxy errors and 404 do not revoke an admitted room', async () => {
  for (const error of [new TypeError('Failed to fetch'), new DOMException('Timed out', 'TimeoutError'), new RoomAccessError(503, 'Restarting'), new RoomAccessError(404, 'Unavailable')]) {
    const f = fixture(async () => { throw error; });
    f.events.onerror!(); await settle(); assert.equal(f.ended(), 0); assert.equal(f.closed(), 0); f.dispose();
  }
});
test('confirmed unauthorized responses and explicit ended events fail closed once', async () => {
  for (const status of [401, 403]) {
    const f = fixture(async () => { throw new RoomAccessError(status, 'Denied'); });
    f.events.onerror!(); await settle(); f.listeners.get('ended')!();
    assert.equal(f.ended(), 1); assert.equal(f.closed(), 1);
  }
  const f = fixture(async () => ({})); f.listeners.get('ended')!(); assert.equal(f.ended(), 1);
});
test('only one access recheck is in flight, and a stale rejection cannot end a new room', async () => {
  let reject!: (error: Error) => void, calls = 0, signal!: AbortSignal;
  const f = fixture(async (_, value) => { calls++; signal = value; return new Promise((_, fail) => { reject = fail; }); });
  f.events.onerror!(); f.events.onerror!(); assert.equal(calls, 1);
  f.dispose(); assert.equal(signal.aborted, true);
  reject(new RoomAccessError(403, 'Old room denied')); await settle(); assert.equal(f.ended(), 0);
});
test('known expiry ends access even offline; long lifetimes use bounded timers', () => {
  const f = fixture(async () => ({}));
  assert.equal(f.timers[0].ms, 5000); f.advance(5000); f.timers[0].run(); assert.equal(f.ended(), 1);
  const long = fixture(async () => ({}), 90 * 86400_000);
  assert.equal(long.timers[0].ms, 86400_000); long.dispose();
});
test('access client retains HTTP status even for a proxy HTML error', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response('<html>Restarting</html>', { status: 503 }));
  await assert.rejects(roomAccessClient.get('room'), (error: unknown) => error instanceof RoomAccessError && error.status === 503);
});
