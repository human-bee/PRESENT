const mockLivekitInstances: Array<{
  rest: string;
  apiKey: string;
  apiSecret: string;
  listRooms: jest.Mock<Promise<Array<{ name: string }>>, [string[]]>;
  createRoom: jest.Mock<Promise<unknown>, [unknown]>;
  sendData: jest.Mock<Promise<void>, [string, Uint8Array, number, { topic: string }]>;
}> = [];

jest.mock('livekit-server-sdk', () => {
  class MockRoomServiceClient {
    rest: string;
    apiKey: string;
    apiSecret: string;
    listRooms: jest.Mock<Promise<Array<{ name: string }>>, [string[]]>;
    createRoom: jest.Mock<Promise<unknown>, [unknown]>;
    sendData: jest.Mock<Promise<void>, [string, Uint8Array, number, { topic: string }]>;

    constructor(rest: string, apiKey: string, apiSecret: string) {
      this.rest = rest;
      this.apiKey = apiKey;
      this.apiSecret = apiSecret;
      this.listRooms = jest.fn(async (rooms: string[]) => rooms.map((name) => ({ name })));
      this.createRoom = jest.fn(async () => ({}));
      this.sendData = jest.fn(async () => {});
      mockLivekitInstances.push(this);
    }
  }
  return {
    RoomServiceClient: MockRoomServiceClient,
    DataPacket_Kind: { RELIABLE: 0 },
  };
});

import { awaitAck } from './wire';
import { clearAcks, recordAck } from '@/server/inboxes/ack';
import { sendStatus } from './wire';

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

describe('LiveKit client wiring', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    mockLivekitInstances.length = 0;
    process.env = {
      ...originalEnv,
      LIVEKIT_API_KEY: 'devkey',
      LIVEKIT_API_SECRET: 'secret',
    };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('uses NEXT_PUBLIC_LIVEKIT_URL and recreates client when rest URL changes', async () => {
    delete process.env.LIVEKIT_REST_URL;
    delete process.env.LIVEKIT_URL;
    delete process.env.NEXT_PUBLIC_LK_SERVER_URL;
    process.env.NEXT_PUBLIC_LIVEKIT_URL = 'ws://127.0.0.1:7880';

    await sendStatus('canvas-room-1', 'session-1', 'done');
    expect(mockLivekitInstances).toHaveLength(1);
    expect(mockLivekitInstances[0]?.rest).toBe('http://127.0.0.1:7880');

    process.env.NEXT_PUBLIC_LIVEKIT_URL = 'ws://127.0.0.1:7881';
    await sendStatus('canvas-room-1', 'session-1', 'done');
    expect(mockLivekitInstances).toHaveLength(2);
    expect(mockLivekitInstances[1]?.rest).toBe('http://127.0.0.1:7881');
  });
});
