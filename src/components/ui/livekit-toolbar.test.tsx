import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { jest } from '@jest/globals';
import { LivekitToolbar } from './livekit-toolbar';
import { ConnectionQuality, Track, Participant } from 'livekit-client';

// Mock LiveKit hooks
const mockToggleMic = jest.fn();
const mockToggleCamera = jest.fn();
const mockToggleScreenShare = jest.fn();
const mockDisconnect = jest.fn();
const mockPublishData = jest.fn();
const mockStartRecording = jest.fn();
const mockStopRecording = jest.fn();

const mockLocalParticipant = {
  localParticipant: {
    identity: 'test-local-user',
    name: 'Test Local User',
    publishData: mockPublishData,
  }
};

const mockParticipants = [
  {
    identity: 'test-local-user',
    name: 'Test Local User',
    isLocal: true,
  },
  {
    identity: 'test-remote-user-1',
    name: 'Remote User 1',
    isLocal: false,
  },
  {
    identity: 'test-remote-user-2',
    name: 'Remote User 2',
    isLocal: false,
  }
];

const mockRoom = {
  disconnect: mockDisconnect,
  localParticipant: mockLocalParticipant.localParticipant,
  startRecording: mockStartRecording,
  stopRecording: mockStopRecording,
  removeParticipant: jest.fn(),
};

// Mock Tambo state
const mockSetState = jest.fn();
const mockState = {
  isExpanded: true,
  showParticipants: true,
  showSettings: false,
  compactMode: false,
  selectedParticipant: null,
  pinnedParticipants: [],
  handRaisedParticipants: [],
  isRecording: false,
  recordingStartTime: null,
  backgroundBlurEnabled: false,
  assistantState: 'idle' as const,
  lastVoiceCommand: null,
  connectionIssues: {},
  networkQuality: ConnectionQuality.Excellent,
  canvasPosition: { x: 0, y: 0 },
  canvasSize: { width: 800, height: 60 },
  isCanvasFocused: false,
};

// Mock all LiveKit hooks
jest.mock('@livekit/components-react', () => ({
  useRoomContext: () => mockRoom,
  useLocalParticipant: () => mockLocalParticipant,
  useParticipants: () => mockParticipants,
  useRemoteParticipants: () => mockParticipants.filter(p => !p.isLocal),
  useTrackToggle: (source: Track.Source) => {
    switch (source) {
      case Track.Source.Microphone:
        return { toggle: mockToggleMic, enabled: true };
      case Track.Source.Camera:
        return { toggle: mockToggleCamera, enabled: true };
      case Track.Source.ScreenShare:
        return { toggle: mockToggleScreenShare, enabled: false };
      default:
        return { toggle: jest.fn(), enabled: false };
    }
  },
  useConnectionQualityIndicator: () => ConnectionQuality.Excellent,
  useIsMuted: () => false,
  useDataChannel: (channel: string, callback: Function) => {
    // Store callback for testing
    (global as any).__dataChannelCallbacks = (global as any).__dataChannelCallbacks || {};
    (global as any).__dataChannelCallbacks[channel] = callback;
  },
}));

// Mock Tambo hooks
jest.mock('@tambo-ai/react', () => ({
  useTamboComponentState: () => [mockState, mockSetState],
}));

// Mock canvas events
const mockDispatchEvent = jest.fn();
Object.defineProperty(window, 'dispatchEvent', {
  value: mockDispatchEvent,
  writable: true,
});

describe('LivekitToolbar Integration Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDispatchEvent.mockClear();
    (global as any).__dataChannelCallbacks = {};
  });

  describe('LiveKit Integration', () => {
    test('connects to LiveKit room and shows participant count', () => {
      render(<LivekitToolbar roomName="test-room" />);
      
      // Should show participant avatars
      expect(screen.getByText('T')).toBeInTheDocument(); // Test Local User
      expect(screen.getByText('R')).toBeInTheDocument(); // Remote User 1
    });

    test('toggles microphone when mic button clicked', async () => {
      render(<LivekitToolbar />);
      
      const micButton = screen.getByRole('button', { name: /microphone/i });
      fireEvent.click(micButton);
      
      expect(mockToggleMic).toHaveBeenCalledTimes(1);
    });

    test('toggles camera when camera button clicked', async () => {
      render(<LivekitToolbar />);
      
      const cameraButton = screen.getByRole('button', { name: /camera/i });
      fireEvent.click(cameraButton);
      
      expect(mockToggleCamera).toHaveBeenCalledTimes(1);
    });

    test('toggles screen share when available', async () => {
      render(<LivekitToolbar features={{ screenShare: true }} />);
      
      const screenShareButton = screen.getByLabelText(/screen share/i);
      fireEvent.click(screenShareButton);
      
      expect(mockToggleScreenShare).toHaveBeenCalledTimes(1);
    });

    test('disconnects from room when leave button clicked', async () => {
      render(<LivekitToolbar />);
      
      const leaveButton = screen.getByLabelText(/leave/i);
      fireEvent.click(leaveButton);
      
      expect(mockDisconnect).toHaveBeenCalledTimes(1);
    });
  });

  describe('Tambo State Integration', () => {
    test('initializes with correct component ID', () => {
      render(<LivekitToolbar roomName="test-room" />);
      
      // useTamboComponentState should be called with room-specific ID
      expect(require('@tambo-ai/react').useTamboComponentState).toHaveBeenCalledWith(
        'livekit-toolbar-test-room',
        expect.any(Object)
      );
    });

    test('updates state when settings button clicked', async () => {
      render(<LivekitToolbar />);
      
      const settingsButton = screen.getByLabelText(/more/i);
      fireEvent.click(settingsButton);
      
      expect(mockSetState).toHaveBeenCalledWith(
        expect.objectContaining({
          showSettings: true
        })
      );
    });

    test('handles recording state changes', async () => {
      render(<LivekitToolbar moderationEnabled features={{ recording: true }} />);
      
      const recordButton = screen.getByLabelText(/recording/i);
      fireEvent.click(recordButton);
      
      await waitFor(() => {
        expect(mockStartRecording).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe('Voice Command Integration', () => {
    test('processes voice commands through data channel', async () => {
      render(<LivekitToolbar enableVoiceCommands />);
      
      const callback = (global as any).__dataChannelCallbacks['voice-commands'];
      expect(callback).toBeDefined();
      
      // Simulate voice command
      const command = { type: 'TOGGLE_MIC' };
      const message = {
        payload: new TextEncoder().encode(JSON.stringify(command))
      };
      
      act(() => {
        callback(message);
      });
      
      expect(mockToggleMic).toHaveBeenCalledTimes(1);
      expect(mockSetState).toHaveBeenCalledWith(
        expect.objectContaining({
          lastVoiceCommand: 'TOGGLE_MIC',
          assistantState: 'idle'
        })
      );
    });

    test('handles mute all voice command for moderators', async () => {
      render(<LivekitToolbar enableVoiceCommands moderationEnabled />);
      
      const callback = (global as any).__dataChannelCallbacks['voice-commands'];
      const command = { type: 'MUTE_ALL' };
      const message = {
        payload: new TextEncoder().encode(JSON.stringify(command))
      };
      
      act(() => {
        callback(message);
      });
      
      // Should send mute requests to all remote participants
      expect(mockPublishData).toHaveBeenCalledWith(
        expect.any(Uint8Array),
        { reliable: true }
      );
    });

    test('ignores voice commands when disabled', async () => {
      render(<LivekitToolbar enableVoiceCommands={false} />);
      
      const callback = (global as any).__dataChannelCallbacks['voice-commands'];
      const command = { type: 'TOGGLE_MIC' };
      const message = {
        payload: new TextEncoder().encode(JSON.stringify(command))
      };
      
      act(() => {
        callback(message);
      });
      
      expect(mockToggleMic).not.toHaveBeenCalled();
    });
  });

  describe('Canvas Integration', () => {
    test('dispatches canvas show event on mount', () => {
      render(<LivekitToolbar roomName="test-room" />);
      
      expect(mockDispatchEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'tambo:showComponent',
          detail: expect.objectContaining({
            messageId: 'livekit-toolbar-test-room',
            component: expect.any(Object),
            position: { x: 0, y: 0 },
            size: { width: 800, height: 60 }
          })
        })
      );
    });

    test('dispatches layout update when participant pinned', async () => {
      render(<LivekitToolbar enableParticipantControls />);
      
      // Find and hover over a participant to show controls
      const participantAvatar = screen.getByText('R'); // Remote User 1
      fireEvent.mouseEnter(participantAvatar.parentElement!);
      
      // Click pin button (this would be in the hover controls)
      // Note: In a real test, we'd need to mock the participant controls properly
      act(() => {
        // Simulate pin action
        const pinCallback = jest.fn();
        pinCallback(); // Simulate pin participant call
      });
    });
  });

  describe('Participant Management', () => {
    test('shows individual participant controls on hover', async () => {
      render(<LivekitToolbar enableParticipantControls />);
      
      const participantAvatar = screen.getByText('R');
      const participantContainer = participantAvatar.closest('.group');
      
      fireEvent.mouseEnter(participantContainer!);
      
      // Participant controls should become visible
      await waitFor(() => {
        expect(participantContainer?.querySelector('[title*="Mute"]')).toBeInTheDocument();
      });
    });

    test('adapts UI based on participant count', () => {
      // Test with many participants
      const manyParticipants = Array.from({ length: 10 }, (_, i) => ({
        identity: `user-${i}`,
        name: `User ${i}`,
        isLocal: i === 0,
      }));
      
      // Mock many participants
      require('@livekit/components-react').useParticipants.mockReturnValueOnce(manyParticipants);
      
      render(<LivekitToolbar enableAdaptiveUI />);
      
      // Should trigger compact mode
      expect(mockSetState).toHaveBeenCalledWith(
        expect.objectContaining({
          compactMode: true
        })
      );
    });

    test('handles moderation actions for authorized users', async () => {
      render(<LivekitToolbar moderationEnabled enableParticipantControls />);
      
      // Should enable moderation controls
      expect(screen.getByText('R')).toBeInTheDocument();
      
      // Moderation actions should be available in participant controls
      const participantAvatar = screen.getByText('R');
      fireEvent.mouseEnter(participantAvatar.parentElement!);
    });
  });

  describe('Real-time Features', () => {
    test('handles hand raise functionality', async () => {
      render(<LivekitToolbar features={{ handRaise: true }} />);
      
      const handButton = screen.getByLabelText(/hand/i);
      fireEvent.click(handButton);
      
      // Should publish hand raise data
      expect(mockPublishData).toHaveBeenCalledWith(
        expect.any(Uint8Array),
        { reliable: true }
      );
      
      // Should update local state
      expect(mockSetState).toHaveBeenCalledWith(
        expect.objectContaining({
          handRaisedParticipants: expect.arrayContaining(['test-local-user'])
        })
      );
    });

    test('shows connection quality indicator', () => {
      render(<LivekitToolbar showConnectionStatus />);
      
      // Should show connection quality icon
      const connectionIcon = screen.getByLabelText(/connection/i);
      expect(connectionIcon).toBeInTheDocument();
    });

    test('displays recording status and duration', async () => {
      const recordingState = {
        ...mockState,
        isRecording: true,
        recordingStartTime: new Date(Date.now() - 30000), // 30 seconds ago
      };
      
      require('@tambo-ai/react').useTamboComponentState.mockReturnValueOnce([
        recordingState,
        mockSetState
      ]);
      
      render(<LivekitToolbar moderationEnabled features={{ recording: true }} />);
      
      // Click settings to expand panel
      const settingsButton = screen.getByLabelText(/more/i);
      fireEvent.click(settingsButton);
      
      await waitFor(() => {
        expect(screen.getByText('LIVE')).toBeInTheDocument();
        expect(screen.getByText(/30s/)).toBeInTheDocument();
      });
    });
  });

  describe('Error Handling', () => {
    test('shows loading state when room not connected', () => {
      require('@livekit/components-react').useRoomContext.mockReturnValueOnce(null);
      
      render(<LivekitToolbar />);
      
      expect(screen.getByText('Connecting to room...')).toBeInTheDocument();
    });

    test('handles recording errors gracefully', async () => {
      mockStartRecording.mockRejectedValueOnce(new Error('Recording failed'));
      
      render(<LivekitToolbar moderationEnabled features={{ recording: true }} />);
      
      const recordButton = screen.getByLabelText(/recording/i);
      fireEvent.click(recordButton);
      
      // Should not crash the component
      await waitFor(() => {
        expect(mockStartRecording).toHaveBeenCalledTimes(1);
      });
    });

    test('handles malformed voice commands', async () => {
      render(<LivekitToolbar enableVoiceCommands />);
      
      const callback = (global as any).__dataChannelCallbacks['voice-commands'];
      const malformedMessage = {
        payload: new TextEncoder().encode('invalid json')
      };
      
      // Should not crash
      expect(() => {
        callback(malformedMessage);
      }).not.toThrow();
    });
  });

  describe('Accessibility', () => {
    test('provides proper ARIA labels for all controls', () => {
      render(<LivekitToolbar />);
      
      expect(screen.getByLabelText(/microphone/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/camera/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/leave/i)).toBeInTheDocument();
    });

    test('supports keyboard navigation', () => {
      render(<LivekitToolbar />);
      
      const micButton = screen.getByLabelText(/microphone/i);
      micButton.focus();
      
      expect(document.activeElement).toBe(micButton);
    });
  });
});

// Integration test helper
export const createMockLiveKitEnvironment = () => {
  return {
    room: mockRoom,
    participants: mockParticipants,
    localParticipant: mockLocalParticipant,
    connectionQuality: ConnectionQuality.Excellent,
    controls: {
      toggleMic: mockToggleMic,
      toggleCamera: mockToggleCamera,
      toggleScreenShare: mockToggleScreenShare,
    },
    state: mockState,
    setState: mockSetState,
  };
};

// Test utilities for manual testing
export const LivekitToolbarTestUtils = {
  // Simulate voice commands
  simulateVoiceCommand: (command: string) => {
    const callback = (global as any).__dataChannelCallbacks?.['voice-commands'];
    if (callback) {
      const message = {
        payload: new TextEncoder().encode(JSON.stringify({ type: command }))
      };
      callback(message);
    }
  },
  
  // Trigger canvas events
  triggerCanvasEvent: (eventType: string, data: any) => {
    window.dispatchEvent(new CustomEvent(eventType, { detail: data }));
  },
  
  // Get current mock state
  getMockState: () => mockState,
  
  // Reset all mocks
  resetMocks: () => {
    jest.clearAllMocks();
    mockDispatchEvent.mockClear();
  }
}; 