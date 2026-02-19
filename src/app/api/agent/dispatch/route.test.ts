/**
 * @jest-environment node
 */
import { NextRequest } from 'next/server';

const mockCreateDispatch = jest.fn();
const mockListDispatch = jest.fn();
const mockListParticipants = jest.fn();

jest.mock('livekit-server-sdk', () => ({
  AgentDispatchClient: jest.fn().mockImplementation(() => ({
    createDispatch: mockCreateDispatch,
    listDispatch: mockListDispatch,
  })),
  RoomServiceClient: jest.fn().mockImplementation(() => ({
    listParticipants: mockListParticipants,
  })),
}));

jest.mock('@/lib/logging', () => ({
  createLogger: () => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }),
}));

import { POST } from './route';

const makeRequest = (roomName: string) =>
  new NextRequest('http://localhost/api/agent/dispatch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ roomName }),
  });

describe('/api/agent/dispatch', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.LIVEKIT_API_KEY = 'test-key';
    process.env.LIVEKIT_API_SECRET = 'test-secret';
    process.env.LIVEKIT_URL = 'ws://127.0.0.1:7880';
    process.env.LIVEKIT_VOICE_AGENT_NAME = 'voice-agent';
    delete (globalThis as Record<string, unknown>).__present_recent_agent_dispatch__;
  });

  it('dedupes when an agent participant is already in the room', async () => {
    mockListParticipants.mockResolvedValue([{ identity: 'voice-agent-abc123' }]);
    mockListDispatch.mockResolvedValue([]);

    const response = await POST(makeRequest('canvas-test-room'));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.deduped).toBe(true);
    expect(json.reason).toBe('agent_already_joined');
    expect(mockCreateDispatch).not.toHaveBeenCalled();
  });

  it('dedupes when there is already an active dispatch for the room', async () => {
    mockListParticipants.mockResolvedValue([]);
    mockListDispatch.mockResolvedValue([{ id: 'disp-1', agentName: 'voice-agent' }]);

    const response = await POST(makeRequest('canvas-test-room'));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.deduped).toBe(true);
    expect(json.reason).toBe('existing_dispatch');
    expect(mockCreateDispatch).not.toHaveBeenCalled();
  });

  it('creates a dispatch when no active agent or dispatch exists', async () => {
    mockListParticipants.mockResolvedValue([]);
    mockListDispatch.mockResolvedValue([]);
    mockCreateDispatch.mockResolvedValue({ id: 'disp-2', agentName: 'voice-agent' });

    const response = await POST(makeRequest('canvas-test-room'));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.deduped).toBeUndefined();
    expect(json.dispatch).toEqual({ id: 'disp-2', agentName: 'voice-agent' });
    expect(mockCreateDispatch).toHaveBeenCalledTimes(1);
  });
});
