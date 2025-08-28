'use client';

/*
 * DEBUGGING ENHANCEMENT: Added comprehensive console logging throughout this component
 * to track LiveKit room connection issues. Look for these log prefixes:
 *
 * 🔧 Component lifecycle (mount/unmount)
 * 🔄 Component re-renders
 * 📊 State changes
 * 🤖 Auto-connect behavior
 * 🎯 Token fetch process
 * 🔑 Token API calls and responses
 * 🔌 Connection attempts and toggles
 * ✅ Successful connections
 * ❌ Disconnections and errors
 * 👥 Participant count changes
 * 🏠 LiveKitRoom component rendering
 * 💥 LiveKitRoom errors
 * ⏰ Timer-based actions
 * 🧹 Cleanup operations
 *
 * FIXES APPLIED:
 * 1. Fixed token parsing issue (API returns 'accessToken', not 'token')
 * 2. Added fallback environment variable support (NEXT_PUBLIC_LK_SERVER_URL)
 * 3. Added infinite render loop prevention with tokenFetchInProgress flag
 * 4. Added better error handling for missing environment variables
 *
 * SETUP REQUIRED:
 * Create a .env.local file in your project root with:
 * NEXT_PUBLIC_LK_SERVER_URL=wss://your-livekit-server.com
 * LIVEKIT_API_KEY=your-api-key
 * LIVEKIT_API_SECRET=your-api-secret
 * LIVEKIT_URL=wss://your-livekit-server.com
 */

import * as React from 'react';
import { cn } from '@/lib/utils';
import { z } from 'zod';
import { useRoomContext, AudioConference } from '@livekit/components-react';
import { ConnectionState, RoomEvent, DisconnectReason, Participant } from 'livekit-client';
import {
  Wifi,
  WifiOff,
  Loader2,
  CheckCircle,
  AlertCircle,
  Users,
  Copy,
  Bot,
  BotOff,
} from 'lucide-react';

// Define the component props schema with Zod
export const livekitRoomConnectorSchema = z.object({
  roomName: z.string().optional().describe("Name of the room to join (default: 'canvas-room')"),
  userName: z.string().optional().describe("User's display name (default: 'Canvas User')"),
  serverUrl: z
    .string()
    .optional()
    .describe('LiveKit server URL (uses environment variable if not provided)'),
  audioOnly: z.boolean().optional().describe('Whether to join in audio-only mode (default: false)'),
  autoConnect: z
    .boolean()
    .optional()
    .describe('Whether to automatically connect on mount (default: false)'),
});

// Define the props type based on the Zod schema
export type LivekitRoomConnectorProps = z.infer<typeof livekitRoomConnectorSchema>;

// Component state type
type LivekitRoomConnectorState = {
  connectionState: 'disconnected' | 'connecting' | 'connected' | 'error';
  isMinimized: boolean;
  participantCount: number;
  errorMessage: string | null;
  token: string | null;
  agentStatus: 'not-requested' | 'dispatching' | 'joined' | 'failed';
  agentIdentity: string | null;
};

// Context to provide LiveKit room to child components on canvas
export const CanvasLiveKitContext = React.createContext<{
  isConnected: boolean;
  roomName: string;
  participantCount: number;
} | null>(null);

/**
 * LivekitRoomConnector Component
 *
 * Manages LiveKit room connection using the external room context from canvas.
 * This allows all canvas components to access LiveKit functionality.
 */
export function LivekitRoomConnector({
  roomName = 'canvas-room',
  userName = 'Canvas User',
  serverUrl,
  audioOnly = false,
  autoConnect = false,
}: LivekitRoomConnectorProps) {
  // Get the room instance from context
  const room = useRoomContext();

  // Determine initial state based on room state
  const getInitialState = (): LivekitRoomConnectorState => {
    if (!room) {
      return {
        connectionState: 'disconnected',
        isMinimized: false,
        participantCount: 0,
        errorMessage: null,
        token: null,
        agentStatus: 'not-requested',
        agentIdentity: null,
      };
    }

    const connectionState =
      room.state === ConnectionState.Connected
        ? 'connected'
        : room.state === ConnectionState.Connecting || room.state === ConnectionState.Reconnecting
          ? 'connecting'
          : 'disconnected';

    return {
      connectionState,
      isMinimized: false,
      participantCount: room.numParticipants,
      errorMessage: null,
      token: null, // We don't know the token from room state
      agentStatus: 'not-requested',
      agentIdentity: null,
    };
  };

  // Local component state initialized with actual room state
  const [state, setState] = React.useState<LivekitRoomConnectorState | null>(getInitialState());

  // Keep a ref to the latest state for event handlers
  const stateRef = React.useRef<LivekitRoomConnectorState | null>(state);
  stateRef.current = state;
  // Stable per-device identity for LiveKit (avoid kicking other clients with same identity)
  const identityRef = React.useRef<string | null>(null);

  // Get server URL from environment or props
  const wsUrl =
    serverUrl || process.env.NEXT_PUBLIC_LIVEKIT_URL || process.env.NEXT_PUBLIC_LK_SERVER_URL || '';

  // Component lifecycle tracking
  React.useEffect(() => {
    // Check for missing environment variables
    if (!wsUrl) {
      console.error(`❌ [LiveKitConnector-${roomName}] Missing LiveKit server URL!`, {
        help: 'Set NEXT_PUBLIC_LK_SERVER_URL in your .env.local file',
        example: 'NEXT_PUBLIC_LK_SERVER_URL=wss://your-livekit-server.com',
      });
    }

    // Return cleanup function for unmount logging
    return () => {
      // Cleanup without excessive logging
    };
  }, []);

  // Generate or load a stable identity for this device+room
  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const key = `present:lk:identity:${roomName}`;
      let id = window.localStorage.getItem(key);
      if (!id) {
        const base = (userName || 'user').replace(/\s+/g, '-').slice(0, 24);
        const rand = Math.random().toString(36).slice(2, 8);
        id = `${base}-${rand}`;
        window.localStorage.setItem(key, id);
      }
      identityRef.current = id;
    } catch {
      // Fallback if storage is unavailable
      const base = (userName || 'user').replace(/\s+/g, '-').slice(0, 24);
      const rand = Math.random().toString(36).slice(2, 8);
      identityRef.current = `${base}-${rand}`;
    }
  }, [roomName, userName]);

  // Add agent dispatch functionality
  const triggerAgentJoin = React.useCallback(async () => {
    try {
      console.log(`🤖 [LiveKitConnector-${roomName}] Triggering agent join...`);

      // Update state to show dispatching
      setState((prev: LivekitRoomConnectorState | null) =>
        prev
          ? ({
              ...prev,
              agentStatus: 'dispatching',
            } as LivekitRoomConnectorState)
          : { ...getInitialState(), agentStatus: 'dispatching' },
      );

      // Call API to trigger agent dispatch
      const response = await fetch('/api/agent/dispatch', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          roomName,
          trigger: 'participant_connected',
          timestamp: Date.now(),
        }),
      });

      if (response.ok) {
        const result = await response.json();
        console.log(`✅ [LiveKitConnector-${roomName}] Agent dispatch triggered:`, result);

        // If dispatch was successful, wait a bit to see if agent actually joins
        // Then timeout if no agent joins within reasonable time
        setTimeout(() => {
          if (stateRef.current?.agentStatus === 'dispatching') {
            console.warn(
              `⏰ [LiveKitConnector-${roomName}] Agent dispatch timeout - no agent joined within 30 seconds`,
            );
            setState((prev: LivekitRoomConnectorState | null) =>
              prev
                ? ({
                    ...prev,
                    agentStatus: 'failed',
                    errorMessage: 'Agent failed to join within timeout period',
                  } as LivekitRoomConnectorState)
                : {
                    ...getInitialState(),
                    agentStatus: 'failed',
                    errorMessage: 'Agent failed to join within timeout period',
                  },
            );
          }
        }, 30000); // 30 second timeout
      } else {
        const errorData = await response.json().catch(() => ({}));
        console.warn(
          `⚠️ [LiveKitConnector-${roomName}] Agent dispatch failed:`,
          response.status,
          errorData,
        );
        setState((prev: LivekitRoomConnectorState | null) =>
          prev
            ? ({
                ...prev,
                agentStatus: 'failed',
                errorMessage: `Dispatch failed: ${errorData.message || response.statusText}`,
              } as LivekitRoomConnectorState)
            : {
                ...getInitialState(),
                agentStatus: 'failed',
                errorMessage: `Dispatch failed: ${errorData.message || response.statusText}`,
              },
        );
      }
    } catch (error) {
      console.error(`❌ [LiveKitConnector-${roomName}] Agent dispatch error:`, error);
      setState((prev: LivekitRoomConnectorState | null) =>
        prev
          ? ({
              ...prev,
              agentStatus: 'failed',
              errorMessage: error instanceof Error ? error.message : 'Unknown dispatch error',
            } as LivekitRoomConnectorState)
          : {
              ...getInitialState(),
              agentStatus: 'failed',
              errorMessage: error instanceof Error ? error.message : 'Unknown dispatch error',
            },
      );
    }
  }, [roomName]);

  // Enhanced participant connection handler with agent triggering
  React.useEffect(() => {
    if (!room) {
      console.error(`❌ [LiveKitConnector-${roomName}] No room instance available`);
      return;
    }

    // Event handlers for room state changes
    const handleConnected = () => {
      if (stateRef.current?.connectionState !== 'connected') {
        console.log(`✅ [LiveKitConnector-${roomName}] User connected to room`);
        setState((prev: LivekitRoomConnectorState | null) =>
          prev
            ? ({
                ...prev,
                connectionState: 'connected',
                participantCount: room.numParticipants,
                errorMessage: null,
              } as LivekitRoomConnectorState)
            : getInitialState(),
        );

        // Trigger agent join when first user connects successfully
        // Only if we're the first real participant (excluding the agent)
        const isAgent = (p: Participant) =>
          p.identity.toLowerCase().includes('agent') ||
          p.identity.toLowerCase().includes('bot') ||
          p.identity.toLowerCase().includes('ai') ||
          p.identity.startsWith('voice-agent') ||
          p.metadata?.includes('agent') ||
          p.metadata?.includes('type":"agent');

        const nonAgentParticipants = Array.from(room.remoteParticipants.values()).filter(
          (p) => !isAgent(p),
        );
        const agentParticipants = Array.from(room.remoteParticipants.values()).filter((p) =>
          isAgent(p),
        );

        // Trigger agent join only if there are NO existing agents and this is the first human
        if (nonAgentParticipants.length === 0 && agentParticipants.length === 0) {
          console.log(
            `🤖 [LiveKitConnector-${roomName}] First participant connected, triggering agent...`,
          );
          // Small delay to ensure room is fully established
          setTimeout(() => {
            triggerAgentJoin();
          }, 2000);
        }
      }
    };

    const handleDisconnected = (reason?: DisconnectReason) => {
      if (stateRef.current?.connectionState !== 'disconnected') {
        setState((prev: LivekitRoomConnectorState | null) =>
          prev
            ? ({
                ...prev,
                connectionState: 'disconnected',
                participantCount: 0,
                errorMessage: reason ? `Disconnected: ${reason}` : null,
              } as LivekitRoomConnectorState)
            : getInitialState(),
        );
      }
      // Auto-retry reconnect with backoff if we didn't explicitly click Disconnect
      if (stateRef.current?.connectionState !== 'connecting') {
        let backoff = 1000;
        const maxBackoff = 8000;
        const retry = async () => {
          if (!stateRef.current) return;
          if (stateRef.current.connectionState === 'connected') return;
          try {
            setState((prev) =>
              prev
                ? ({
                    ...prev,
                    connectionState: 'connecting',
                    errorMessage: null,
                  } as LivekitRoomConnectorState)
                : getInitialState(),
            );
            // Trigger token fetch effect
          } finally {
            backoff = Math.min(maxBackoff, backoff * 2);
            if (stateRef.current?.connectionState !== 'connected') {
              setTimeout(retry, backoff);
            }
          }
        };
        setTimeout(retry, backoff);
      }
    };

    const handleReconnecting = () => {
      if (stateRef.current?.connectionState !== 'connecting') {
        setState((prev: LivekitRoomConnectorState | null) =>
          prev
            ? ({
                ...prev,
                connectionState: 'connecting',
                errorMessage: 'Reconnecting...',
              } as LivekitRoomConnectorState)
            : getInitialState(),
        );
      }
    };

    const handleReconnected = () => {
      if (stateRef.current?.connectionState !== 'connected') {
        setState((prev: LivekitRoomConnectorState | null) =>
          prev
            ? ({
                ...prev,
                connectionState: 'connected',
                participantCount: room.numParticipants,
                errorMessage: null,
              } as LivekitRoomConnectorState)
            : getInitialState(),
        );
      }
    };

    const handleParticipantConnected = (participant: Participant) => {
      console.log(`👥 [LiveKitConnector-${roomName}] Participant connected:`, {
        identity: participant.identity,
        name: participant.name,
        metadata: participant.metadata,
        isSpeaking: participant.isSpeaking,
        audioTrackCount: participant.audioTrackPublications.size,
        videoTrackCount: participant.videoTrackPublications.size,
        allParticipants: Array.from(room.remoteParticipants.values()).map((p) => ({
          identity: p.identity,
          name: p.name,
          metadata: p.metadata,
        })),
      });

      // Check if this is an agent joining and update state accordingly
      const isAgent =
        participant.identity.toLowerCase().includes('agent') ||
        participant.identity.toLowerCase().includes('bot') ||
        participant.identity.toLowerCase().includes('ai') ||
        participant.identity.startsWith('voice-agent') ||
        participant.metadata?.includes('agent') ||
        participant.metadata?.includes('type":"agent');

      if (isAgent) {
        console.log(
          `🎉 [LiveKitConnector-${roomName}] 🤖 AI AGENT SUCCESSFULLY JOINED THE ROOM! 🎉`,
          {
            identity: participant.identity,
            name: participant.name,
            metadata: participant.metadata,
            totalParticipants: room.numParticipants,
          },
        );
        setState((prev: LivekitRoomConnectorState | null) =>
          prev
            ? ({
                ...prev,
                participantCount: room.numParticipants,
                agentStatus: 'joined',
                agentIdentity: participant.identity,
              } as LivekitRoomConnectorState)
            : {
                ...getInitialState(),
                participantCount: room.numParticipants,
                agentStatus: 'joined',
                agentIdentity: participant.identity,
              },
        );
      } else {
        console.log(
          `👤 [LiveKitConnector-${roomName}] Human participant connected: ${participant.identity}`,
        );
        setState((prev: LivekitRoomConnectorState | null) =>
          prev
            ? ({
                ...prev,
                participantCount: room.numParticipants,
              } as LivekitRoomConnectorState)
            : getInitialState(),
        );
      }
    };

    const handleParticipantDisconnected = (participant: Participant) => {
      console.log(`👥 [LiveKitConnector-${roomName}] Participant disconnected:`, {
        identity: participant.identity,
        name: participant.name,
        metadata: participant.metadata,
        remainingParticipants: room.numParticipants - 1,
      });

      // Check if this was an agent leaving
      const isAgent =
        participant.identity.toLowerCase().includes('agent') ||
        participant.identity.toLowerCase().includes('bot') ||
        participant.identity.toLowerCase().includes('ai') ||
        participant.identity.startsWith('voice-agent') ||
        participant.metadata?.includes('agent') ||
        participant.metadata?.includes('type":"agent');

      if (isAgent && stateRef.current?.agentIdentity === participant.identity) {
        console.log(
          `😔 [LiveKitConnector-${roomName}] AI Agent left the room: ${participant.identity}`,
        );
        setState((prev: LivekitRoomConnectorState | null) =>
          prev
            ? ({
                ...prev,
                participantCount: room.numParticipants,
                agentStatus: 'not-requested',
                agentIdentity: null,
              } as LivekitRoomConnectorState)
            : getInitialState(),
        );
      } else {
        setState((prev: LivekitRoomConnectorState | null) =>
          prev
            ? ({
                ...prev,
                participantCount: room.numParticipants,
              } as LivekitRoomConnectorState)
            : getInitialState(),
        );
      }
    };

    // Check initial state
    const newConnState =
      room.state === ConnectionState.Connected
        ? 'connected'
        : room.state === ConnectionState.Connecting || room.state === ConnectionState.Reconnecting
          ? 'connecting'
          : 'disconnected';
    const newParticipantCount = room.numParticipants;

    if (
      stateRef.current &&
      (stateRef.current.connectionState !== newConnState ||
        stateRef.current.participantCount !== newParticipantCount)
    ) {
      setState({
        ...stateRef.current!,
        connectionState: newConnState,
        participantCount: newParticipantCount,
      } as LivekitRoomConnectorState);
    }

    // Listen to room events
    room.on(RoomEvent.Connected, handleConnected);
    room.on(RoomEvent.Disconnected, handleDisconnected);
    room.on(RoomEvent.Reconnecting, handleReconnecting);
    room.on(RoomEvent.Reconnected, handleReconnected);
    room.on(RoomEvent.ParticipantConnected, handleParticipantConnected);
    room.on(RoomEvent.ParticipantDisconnected, handleParticipantDisconnected);

    // Cleanup listeners
    return () => {
      room.off(RoomEvent.Connected, handleConnected);
      room.off(RoomEvent.Disconnected, handleDisconnected);
      room.off(RoomEvent.Reconnecting, handleReconnecting);
      room.off(RoomEvent.Reconnected, handleReconnected);
      room.off(RoomEvent.ParticipantConnected, handleParticipantConnected);
      room.off(RoomEvent.ParticipantDisconnected, handleParticipantDisconnected);
    };
  }, [room, roomName, triggerAgentJoin]); // Added triggerAgentJoin to dependencies

  // Track re-renders and token fetch state
  const renderCount = React.useRef(0);
  const tokenFetchInProgress = React.useRef(false);
  renderCount.current++;

  // Token fetch and room connection effect
  React.useEffect(() => {
    if (!stateRef.current || !room) return;

    const shouldFetchToken =
      stateRef.current.connectionState === 'connecting' &&
      !stateRef.current.token &&
      !tokenFetchInProgress.current;

    if (!shouldFetchToken) {
      return;
    }

    const fetchTokenAndConnect = async () => {
      tokenFetchInProgress.current = true;

      try {
        console.log(`🎯 [LiveKitConnector-${roomName}] Fetching token...`);
        const identity = encodeURIComponent(
          identityRef.current ||
            `${(userName || 'user').replace(/\s+/g, '-')}-${Math.random().toString(36).slice(2, 8)}`,
        );
        const response = await fetch(
          `/api/token?roomName=${encodeURIComponent(roomName)}&identity=${identity}&username=${encodeURIComponent(userName)}&name=${encodeURIComponent(userName)}`,
        );

        if (!response.ok) {
          throw new Error(`Token fetch failed: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        const token = data.accessToken || data.token;

        if (!token) {
          throw new Error('No token received from API');
        }

        console.log(`🔑 [LiveKitConnector-${roomName}] Token received, connecting to room...`);

        // Update state with token
        setState((prev: LivekitRoomConnectorState | null) =>
          prev
            ? ({
                ...prev,
                token,
                errorMessage: null,
              } as LivekitRoomConnectorState)
            : { ...getInitialState(), token },
        );

        // Connect to the room using the token
        if (wsUrl) {
          console.log(
            `🔌 [LiveKitConnector-${roomName}] Calling room.connect() with URL: ${wsUrl}`,
          );
          // Guard against hanging connects: timeout if we don't transition to connected fast enough
          const timeoutId = setTimeout(() => {
            if (stateRef.current?.connectionState !== 'connected') {
              try {
                room.disconnect();
              } catch {}
              setState((prev: LivekitRoomConnectorState | null) =>
                prev
                  ? ({
                      ...prev,
                      connectionState: 'error',
                      errorMessage: 'Connect timeout. Tap Connect to retry.',
                    } as LivekitRoomConnectorState)
                  : {
                      ...getInitialState(),
                      connectionState: 'error',
                      errorMessage: 'Connect timeout. Tap Connect to retry.',
                    },
              );
            }
          }, 15000);

          await room.connect(wsUrl, token);
          clearTimeout(timeoutId);
          console.log(`✅ [LiveKitConnector-${roomName}] Room.connect() called successfully`);

          // Enable camera and microphone after connecting (if not in audio-only mode)
          try {
            if (!audioOnly) {
              console.log(`🎥 [LiveKitConnector-${roomName}] Enabling camera...`);
              await room.localParticipant.enableCameraAndMicrophone();
              console.log(`✅ [LiveKitConnector-${roomName}] Camera and microphone enabled`);
            } else {
              console.log(
                `🎤 [LiveKitConnector-${roomName}] Enabling microphone only (audio-only mode)...`,
              );
              await room.localParticipant.setMicrophoneEnabled(true);
              console.log(`✅ [LiveKitConnector-${roomName}] Microphone enabled`);
            }
          } catch (mediaError) {
            console.warn(`⚠️ [LiveKitConnector-${roomName}] Media device error:`, mediaError);
            // Don't fail the connection, just log the media error
            setState((prev: LivekitRoomConnectorState | null) =>
              prev
                ? ({
                    ...prev,
                    errorMessage: `Connected but media device error: ${mediaError instanceof Error ? mediaError.message : 'Unknown error'}`,
                  } as LivekitRoomConnectorState)
                : getInitialState(),
            );
          }
        } else {
          throw new Error('Missing LiveKit server URL');
        }
      } catch (error) {
        console.error(`❌ [LiveKitConnector-${roomName}] Connection failed:`, error);
        setState((prev: LivekitRoomConnectorState | null) =>
          prev
            ? ({
                ...prev,
                connectionState: 'error',
                errorMessage: error instanceof Error ? error.message : 'Connection failed',
              } as LivekitRoomConnectorState)
            : {
                ...getInitialState(),
                connectionState: 'error',
                errorMessage: error instanceof Error ? error.message : 'Connection failed',
              },
        );
      } finally {
        tokenFetchInProgress.current = false;
      }
    };

    fetchTokenAndConnect();
  }, [stateRef.current?.connectionState, stateRef.current?.token, roomName, userName, room, wsUrl]);

  // Auto-connect effect (if enabled)
  React.useEffect(() => {
    if (!autoConnect || !stateRef.current || stateRef.current.connectionState !== 'disconnected') {
      return;
    }

    const connectTimer = setTimeout(() => {
      handleConnect();
    }, 1000);

    return () => clearTimeout(connectTimer);
  }, [autoConnect, stateRef.current?.connectionState]);

  // Listen for manual agent requests from UI
  React.useEffect(() => {
    const handleAgentRequest = (event: CustomEvent) => {
      const { roomName: requestedRoom } = event.detail;
      if (requestedRoom === roomName && stateRef.current?.connectionState === 'connected') {
        console.log(`🎯 [LiveKitConnector-${roomName}] Manual agent request received`);
        triggerAgentJoin();
      }
    };

    window.addEventListener('livekit:request-agent', handleAgentRequest as EventListener);

    return () => {
      window.removeEventListener('livekit:request-agent', handleAgentRequest as EventListener);
    };
  }, [roomName, triggerAgentJoin]);

  // Handle connection toggle
  const handleConnect = () => {
    console.log(`🔌 [LiveKitConnector-${roomName}] handleConnect called`, {
      currentConnectionState: state?.connectionState,
      hasState: !!state,
      hasWsUrl: !!wsUrl,
      hasRoom: !!room,
      timestamp: new Date().toISOString(),
    });

    if (!state || !room) {
      console.warn(`🔌 [LiveKitConnector-${roomName}] handleConnect: No state or room available`);
      return;
    }

    // Check for missing websocket URL
    if (!wsUrl && state.connectionState === 'disconnected') {
      console.error(`🔌 [LiveKitConnector-${roomName}] Cannot connect: Missing LiveKit server URL`);
      setState((prev: LivekitRoomConnectorState | null) =>
        prev
          ? ({
              ...prev,
              connectionState: 'error',
              errorMessage: 'Missing LiveKit server URL. Check your environment variables.',
            } as LivekitRoomConnectorState)
          : {
              ...getInitialState(),
              connectionState: 'error',
              errorMessage: 'Missing LiveKit server URL. Check your environment variables.',
            },
      );
      return;
    }

    if (state.connectionState === 'disconnected') {
      console.log(`🔌 [LiveKitConnector-${roomName}] Setting state to connecting`);
      // Reset agent status when starting a new connection
      setState((prev: LivekitRoomConnectorState | null) =>
        prev
          ? ({
              ...prev,
              connectionState: 'connecting',
              errorMessage: null,
              agentStatus: 'not-requested',
              agentIdentity: null,
            } as LivekitRoomConnectorState)
          : {
              ...getInitialState(),
              connectionState: 'connecting',
              agentStatus: 'not-requested',
              agentIdentity: null,
            },
      );
    } else if (state.connectionState === 'connected') {
      console.log(`🔌 [LiveKitConnector-${roomName}] Disconnecting from room`);

      // Clean disconnect with proper state cleanup
      try {
        room.disconnect();

        // Immediate state update for better UX
        setState((prev: LivekitRoomConnectorState | null) =>
          prev
            ? ({
                ...prev,
                connectionState: 'disconnected',
                participantCount: 0,
                agentStatus: 'not-requested',
                agentIdentity: null,
                errorMessage: null,
              } as LivekitRoomConnectorState)
            : getInitialState(),
        );

        console.log(`✅ [LiveKitConnector-${roomName}] Clean disconnect completed`);
      } catch (error) {
        console.error(`❌ [LiveKitConnector-${roomName}] Error during disconnect:`, error);
        setState((prev: LivekitRoomConnectorState | null) =>
          prev
            ? ({
                ...prev,
                connectionState: 'error',
                errorMessage: 'Error during disconnect',
              } as LivekitRoomConnectorState)
            : {
                ...getInitialState(),
                connectionState: 'error',
                errorMessage: 'Error during disconnect',
              },
        );
      }
    } else {
      console.log(
        `🔌 [LiveKitConnector-${roomName}] Connection attempt ignored - current state: ${state.connectionState}`,
      );
    }
  };

  // Handle minimize toggle
  const handleMinimize = () => {
    setState((prev: LivekitRoomConnectorState | null) =>
      prev
        ? ({
            ...prev,
            isMinimized: !prev.isMinimized,
          } as LivekitRoomConnectorState)
        : { ...getInitialState(), isMinimized: true },
    );
  };

  // Copy room link (prefer id param to keep URL stable; strip prefix if present)
  const handleCopyLink = () => {
    const id = roomName.startsWith('canvas-') ? roomName.substring('canvas-'.length) : roomName;
    const link = `${window.location.origin}/canvas?id=${encodeURIComponent(id)}`;
    navigator.clipboard.writeText(link);
  };

  // Update canvas context when our state changes
  const canvasContext = React.useContext(CanvasLiveKitContext);
  React.useEffect(() => {
    // If we're inside a canvas context provider, we don't need to provide our own
    if (!canvasContext) {
      console.warn(
        `[LiveKitConnector-${roomName}] No canvas context found - participant tiles may not work`,
      );
    }
  }, [canvasContext, roomName]);

  return (
    <>
      <RoomConnectorUI
        state={state || null} // Pass state or null if not yet initialized
        setState={setState as (s: LivekitRoomConnectorState) => void} // Cast for UI component if needed
        roomName={roomName}
        onMinimize={handleMinimize}
        onConnect={handleConnect}
        onDisconnect={handleConnect} // Disconnect also uses handleConnect logic now
        onCopyLink={handleCopyLink}
      />

      {/* Hidden audio conference for audio processing */}
      {state?.connectionState === 'connected' && (
        <div className="hidden">
          <AudioConference />
        </div>
      )}
    </>
  );
}

// Separate UI component for the room connector interface
function RoomConnectorUI({
  state,
  // setState, // setState is not directly used by UI, actions are passed via props
  roomName,
  onMinimize,
  onConnect,
  onDisconnect,
  onCopyLink,
}: {
  state: LivekitRoomConnectorState | null;
  setState: (state: LivekitRoomConnectorState) => void; // Keep for prop-type consistency, but actions are preferred
  roomName: string;
  onMinimize: () => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
  onCopyLink: () => void;
}) {
  const connectionState = (state?.connectionState ??
    'disconnected') as LivekitRoomConnectorState['connectionState'];
  const isMinimized = state?.isMinimized || false;
  const participantCount = state?.participantCount || 0;
  const errorMessage = state?.errorMessage || null;
  const agentStatus = state?.agentStatus || 'not-requested';
  const agentIdentity = state?.agentIdentity || null;

  return (
    <div
      className={cn(
        'bg-white border-2 rounded-lg shadow-lg transition-all duration-200',
        connectionState === 'connected' && 'border-green-500',
        connectionState === 'connecting' && 'border-blue-500',
        connectionState === 'error' && 'border-red-500',
        connectionState === 'disconnected' && 'border-gray-300',
        isMinimized ? 'w-48 h-12' : 'w-80',
      )}
      style={{
        // Ensure the component is interactive on canvas
        pointerEvents: 'all',
        position: 'relative',
        zIndex: 10,
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b">
        <div className="flex items-center gap-2">
          {connectionState === 'connected' && <Wifi className="w-4 h-4 text-green-500" />}
          {connectionState === 'connecting' && (
            <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />
          )}
          {connectionState === 'error' && <AlertCircle className="w-4 h-4 text-red-500" />}
          {connectionState === 'disconnected' && <WifiOff className="w-4 h-4 text-gray-500" />}

          <span className="font-medium text-sm select-none">
            {isMinimized ? 'LiveKit' : 'LiveKit Room Connector'}
          </span>
        </div>

        <button
          onClick={onMinimize}
          className="p-1 hover:bg-gray-100 rounded cursor-pointer select-none"
          style={{ pointerEvents: 'all' }}
        >
          {isMinimized ? '▲' : '▼'}
        </button>
      </div>

      {/* Content - only show when not minimized */}
      {!isMinimized && (
        <div className="p-4 space-y-4">
          {/* Room Info */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-600 select-none">Room:</span>
              <span className="font-mono text-xs bg-gray-100 px-2 py-1 rounded select-all">
                {roomName}
              </span>
            </div>

            {connectionState === 'connected' && (
              <>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-600 select-none">Participants:</span>
                  <div className="flex items-center gap-1">
                    <Users className="w-3.5 h-3.5" />
                    <span className="select-none">{participantCount}</span>
                  </div>
                </div>

                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-600 select-none">AI Agent:</span>
                  <div className="flex items-center gap-1.5">
                    {agentStatus === 'joined' && (
                      <>
                        <Bot className="w-3.5 h-3.5 text-green-500" />
                        <span className="text-green-600 text-xs select-none">Connected</span>
                      </>
                    )}
                    {agentStatus === 'dispatching' && (
                      <>
                        <Loader2 className="w-3.5 h-3.5 text-blue-500 animate-spin" />
                        <span className="text-blue-600 text-xs select-none">Joining...</span>
                      </>
                    )}
                    {agentStatus === 'failed' && (
                      <>
                        <BotOff className="w-3.5 h-3.5 text-red-500" />
                        <span className="text-red-600 text-xs select-none">Failed</span>
                      </>
                    )}
                    {agentStatus === 'not-requested' && (
                      <>
                        <BotOff className="w-3.5 h-3.5 text-gray-400" />
                        <span className="text-gray-500 text-xs select-none">Not active</span>
                      </>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Status Message */}
          {connectionState === 'error' && errorMessage && (
            <div className="text-sm text-red-600 text-center select-none break-words">
              {errorMessage}
            </div>
          )}

          {connectionState === 'connecting' && !errorMessage && (
            <div className="text-sm text-blue-600 text-center select-none">
              Connecting to room...
            </div>
          )}

          {connectionState === 'connected' && !errorMessage && (
            <div className="text-sm text-green-600 text-center flex items-center justify-center gap-1 select-none">
              <CheckCircle className="w-3.5 h-3.5" />
              Connected successfully
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex gap-2">
            <button
              onClick={connectionState === 'connected' ? onDisconnect : onConnect}
              disabled={connectionState === 'connecting'}
              className={cn(
                'flex-1 px-3 py-2 rounded-md text-sm font-medium transition-colors cursor-pointer select-none',
                connectionState === 'connected'
                  ? 'bg-red-500 text-white hover:bg-red-600'
                  : connectionState === 'connecting'
                    ? 'bg-gray-400 text-white cursor-not-allowed'
                    : 'bg-blue-500 text-white hover:bg-blue-600',
              )}
              style={{
                pointerEvents: connectionState === 'connecting' ? 'none' : 'all',
              }}
            >
              {connectionState === 'connected'
                ? 'Disconnect'
                : connectionState === 'connecting'
                  ? 'Connecting...'
                  : connectionState === 'error'
                    ? 'Retry'
                    : 'Connect'}
            </button>

            {connectionState === 'connected' && (
              <button
                onClick={onCopyLink}
                className="px-3 py-2 border border-gray-300 rounded-md text-sm hover:bg-gray-50 cursor-pointer select-none"
                title="Copy room link"
                style={{ pointerEvents: 'all' }}
              >
                <Copy className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* Agent Control Button */}
          {connectionState === 'connected' && agentStatus !== 'joined' && (
            <div className="flex gap-2">
              <button
                onClick={() => {
                  // Call the triggerAgentJoin function directly
                  if (typeof window !== 'undefined') {
                    // We'll add a custom event that the parent component can listen to
                    window.dispatchEvent(
                      new CustomEvent('livekit:request-agent', {
                        detail: { roomName },
                      }),
                    );
                  }
                }}
                disabled={agentStatus === 'dispatching'}
                className={cn(
                  'flex-1 px-3 py-2 rounded-md text-sm font-medium transition-colors cursor-pointer select-none flex items-center justify-center gap-2',
                  agentStatus === 'dispatching'
                    ? 'bg-gray-400 text-white cursor-not-allowed'
                    : agentStatus === 'failed'
                      ? 'bg-orange-500 text-white hover:bg-orange-600'
                      : 'bg-purple-500 text-white hover:bg-purple-600',
                )}
                style={{
                  pointerEvents: agentStatus === 'dispatching' ? 'none' : 'all',
                }}
              >
                {agentStatus === 'dispatching' ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Requesting Agent...
                  </>
                ) : agentStatus === 'failed' ? (
                  <>
                    <Bot className="w-4 h-4" />
                    Retry Agent
                  </>
                ) : (
                  <>
                    <Bot className="w-4 h-4" />
                    Invite AI Agent
                  </>
                )}
              </button>
            </div>
          )}

          {/* Instructions */}
          {(connectionState === 'disconnected' ||
            (connectionState === 'error' &&
              !errorMessage?.includes('Missing LiveKit server URL'))) && (
            <div className="text-xs text-gray-500 text-center select-none">
              Connect to enable LiveKit features on the canvas
            </div>
          )}

          {connectionState === 'connected' && (
            <div className="text-xs text-gray-500 text-center select-none">
              {agentStatus === 'joined'
                ? `AI Agent "${agentIdentity}" is ready to assist`
                : agentStatus === 'dispatching'
                  ? 'Requesting AI agent to join...'
                  : agentStatus === 'failed'
                    ? `Agent failed: ${state?.errorMessage || "Try the 'Retry Agent' button."}`
                    : 'You can spawn participant tiles and toolbars, or invite an AI agent'}
            </div>
          )}

          {/* Agent Error Details */}
          {connectionState === 'connected' && agentStatus === 'failed' && state?.errorMessage && (
            <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded p-2 select-none">
              <div className="font-medium mb-1">🔧 Agent Connection Issue:</div>
              <div>{state.errorMessage}</div>
              <div className="mt-2 text-red-500 border-t border-red-200 pt-2">
                <div className="font-medium">🚨 Make sure your agent worker is running:</div>
                <code className="block bg-red-100 border border-red-300 p-1 rounded mt-1 text-xs">
                  npm run agent:dev
                </code>
                <div className="mt-1">
                  Agent dispatch only creates tokens. The actual worker connects to the room.
                </div>
              </div>
            </div>
          )}

          {/* Agent Timeout Warning */}
          {connectionState === 'connected' && agentStatus === 'dispatching' && (
            <div className="text-xs text-blue-600 bg-blue-50 border border-blue-200 rounded p-2 select-none">
              <div className="font-medium mb-1">⏰ Agent Dispatching...</div>
              <div>Waiting for agent to join the room (timeout in 30s)</div>
              <div className="mt-2 text-blue-500 border-t border-blue-200 pt-2">
                <div className="font-medium">💡 If this takes too long:</div>
                <div>
                  1. Check if agent worker is running:{' '}
                  <code className="bg-blue-100 px-1 rounded">npm run agent:dev</code>
                </div>
                <div>2. Check the terminal for agent connection logs</div>
                <div>3. Verify your .env.local has all LiveKit credentials</div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Hook to check if we're inside a LiveKit room context on canvas
export function useCanvasLiveKit() {
  const context = React.useContext(CanvasLiveKitContext);
  return context;
}

// Default export
export default LivekitRoomConnector;
