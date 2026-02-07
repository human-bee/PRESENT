jest.mock('livekit-server-sdk', () => ({
  RoomServiceClient: class {},
  DataPacket_Kind: { RELIABLE: 0 },
}));

import { awaitAck } from './wire';
import { clearAcks, recordAck } from '@/server/inboxes/ack';

describe('awaitAck', () => {
  const realDateNow = Date.now;

  beforeEach(() => {
    clearAcks();
  });

  afterEach(() => {
    // Ensure no other suites inherit fake timers.
    Date.now = realDateNow;
    try {
      jest.useRealTimers();
    } catch {}
  });

  it('resolves when ack arrives', async () => {
    // This helper is a polling loop; use real timers to avoid fake-timer deadlocks.
    await new Promise((resolve) => setTimeout(resolve, 20));
    recordAck('session-1', 1, 'client-A', Date.now());

    const ack = await awaitAck({ sessionId: 'session-1', seq: 1, deadlineMs: 300 });
    expect(ack).toBeTruthy();
    expect(ack?.clientId).toBe('client-A');
  });

  it('returns null when deadline passes without ack', async () => {
    // Make Date.now advance so the deadline expires quickly.
    const start = realDateNow();
    let offset = 0;
    Date.now = () => start + offset;
    const bump = setInterval(() => {
      offset += 50;
    }, 20);
    bump.unref?.();

    const ack = await awaitAck({ sessionId: 'session-2', seq: 5, deadlineMs: 150 });
    expect(ack).toBeNull();

    clearInterval(bump);
  });
});
