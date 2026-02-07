jest.mock('livekit-server-sdk', () => ({
  RoomServiceClient: class {},
  DataPacket_Kind: { RELIABLE: 0 },
}));

import { awaitAck } from './wire';
import { clearAcks, recordAck } from '@/server/inboxes/ack';

describe('awaitAck', () => {
  beforeEach(() => {
    clearAcks();
  });

  it('resolves when ack arrives', async () => {
    setTimeout(() => {
      recordAck('session-1', 1, 'client-A', Date.now());
    }, 20);
    // Allow extra slack to avoid flaking under load (the production poll interval starts at 150ms).
    const ack = await awaitAck({ sessionId: 'session-1', seq: 1, deadlineMs: 2000 });
    expect(ack).toBeTruthy();
    expect(ack?.clientId).toBe('client-A');
  });

  it('returns null when deadline passes without ack', async () => {
    const ack = await awaitAck({ sessionId: 'session-2', seq: 5, deadlineMs: 150 });
    expect(ack).toBeNull();
  });
});
