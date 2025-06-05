import { LiveKitAgentBridge, createLiveKitAgentBridge } from '../livekit-agent-bridge';
import { Room, RoomEvent } from 'livekit-client';

// Mock livekit-client
jest.mock('livekit-client', () => ({
  Room: jest.fn().mockImplementation(() => ({
    state: 'disconnected',
    name: 'test-room',
    remoteParticipants: new Map(),
    localParticipant: {
      publishTrack: jest.fn().mockResolvedValue(undefined),
      unpublishTrack: jest.fn().mockResolvedValue(undefined),
      publishData: jest.fn().mockResolvedValue(undefined),
    },
    connect: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn().mockResolvedValue(undefined),
    on: jest.fn(),
    off: jest.fn(),
  })),
  RoomEvent: {
    ParticipantConnected: 'participant_connected',
    ParticipantDisconnected: 'participant_disconnected',
    TrackSubscribed: 'track_subscribed',
    TrackUnsubscribed: 'track_unsubscribed',
    Disconnected: 'disconnected',
  },
  createAudioTrack: jest.fn().mockResolvedValue({
    stop: jest.fn(),
  }),
  RemoteAudioTrack: jest.fn(),
}));

// Mock openai-agent
jest.mock('../openai-agent', () => ({
  TamboVoiceAgentManager: jest.fn().mockImplementation(() => ({
    initialize: jest.fn().mockResolvedValue(undefined),
    connect: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn().mockResolvedValue(undefined),
    getStatus: jest.fn().mockReturnValue({
      initialized: true,
      connected: true,
      agentName: 'Test Agent',
    }),
    getSession: jest.fn().mockReturnValue({}),
  })),
  tamboVoiceAgent: {},
}));

describe('LiveKitAgentBridge', () => {
  let bridge: LiveKitAgentBridge;
  const mockConfig = {
    roomUrl: 'wss://test.livekit.com',
    token: 'test-token',
    agentName: 'Test Agent',
    openaiApiKey: 'test-api-key',
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Connection', () => {
    it('should connect to LiveKit room and OpenAI', async () => {
      bridge = new LiveKitAgentBridge(mockConfig);
      await bridge.connect();

      // Verify Room.connect was called
      const roomInstance = (Room as jest.MockedClass<typeof Room>).mock.results[0].value;
      expect(roomInstance.connect).toHaveBeenCalledWith(mockConfig.roomUrl, mockConfig.token);

      // Verify agent was initialized and connected
      const agentInstance = bridge['agent'];
      expect(agentInstance.initialize).toHaveBeenCalled();
      expect(agentInstance.connect).toHaveBeenCalledWith(mockConfig.openaiApiKey);

      // Verify audio track was published
      expect(roomInstance.localParticipant.publishTrack).toHaveBeenCalled();
    });

    it('should handle connection errors gracefully', async () => {
      bridge = new LiveKitAgentBridge(mockConfig);
      const roomMock = (Room as jest.MockedClass<typeof Room>).mock.results[0].value;
      roomMock.connect = jest.fn().mockRejectedValue(new Error('Connection failed'));
      
      await expect(bridge.connect()).rejects.toThrow();
    });
  });

  describe('Disconnection', () => {
    it('should disconnect from both LiveKit and OpenAI', async () => {
      bridge = new LiveKitAgentBridge(mockConfig);
      await bridge.connect();
      await bridge.disconnect();

      const roomInstance = (Room as jest.MockedClass<typeof Room>).mock.results[0].value;
      const agentInstance = bridge['agent'];

      // Verify disconnections
      expect(roomInstance.disconnect).toHaveBeenCalled();
      expect(agentInstance.disconnect).toHaveBeenCalled();

      // Verify track was unpublished
      expect(roomInstance.localParticipant.unpublishTrack).toHaveBeenCalled();
    });

    it('should handle disconnection when not connected', async () => {
      bridge = new LiveKitAgentBridge(mockConfig);
      
      // Should not throw when disconnecting without connecting
      await expect(bridge.disconnect()).resolves.not.toThrow();
    });
  });

  describe('Status', () => {
    it('should return correct status when connected', async () => {
      bridge = new LiveKitAgentBridge(mockConfig);
      await bridge.connect();

      const status = bridge.getStatus();

      expect(status).toMatchObject({
        livekit: {
          connected: false, // Mock room state is 'disconnected'
          roomName: 'test-room',
          participantCount: 1,
        },
        openai: {
          initialized: true,
          connected: true,
          agentName: 'Test Agent',
        },
        bridge: {
          connected: true,
          audioTracksConnected: 0,
        },
      });
    });

    it('should return correct status when not connected', () => {
      bridge = new LiveKitAgentBridge(mockConfig);

      const status = bridge.getStatus();

      expect(status.bridge.connected).toBe(false);
    });
  });

  describe('Event Handling', () => {
    it('should set up room event handlers', () => {
      bridge = new LiveKitAgentBridge(mockConfig);
      const roomInstance = (Room as jest.MockedClass<typeof Room>).mock.results[0].value;

      // Verify event handlers were registered
      expect(roomInstance.on).toHaveBeenCalledWith(RoomEvent.ParticipantConnected, expect.any(Function));
      expect(roomInstance.on).toHaveBeenCalledWith(RoomEvent.ParticipantDisconnected, expect.any(Function));
      expect(roomInstance.on).toHaveBeenCalledWith(RoomEvent.TrackSubscribed, expect.any(Function));
      expect(roomInstance.on).toHaveBeenCalledWith(RoomEvent.TrackUnsubscribed, expect.any(Function));
      expect(roomInstance.on).toHaveBeenCalledWith(RoomEvent.Disconnected, expect.any(Function));
    });
  });

  describe('Factory Function', () => {
    it('should create and connect a bridge using factory function', async () => {
      const bridge = await createLiveKitAgentBridge(mockConfig);
      
      expect(bridge).toBeInstanceOf(LiveKitAgentBridge);
      expect(bridge.getStatus().bridge.connected).toBe(true);
    });
  });
}); 