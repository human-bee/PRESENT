"use client";

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

import * as React from "react";
import { cn } from "@/lib/utils";
import { useTamboComponentState } from "@tambo-ai/react";
import { z } from "zod";
import { useRoomContext, AudioConference } from "@livekit/components-react";
import { ConnectionState, RoomEvent, DisconnectReason, Participant } from "livekit-client";
import { 
  Wifi, 
  WifiOff, 
  Loader2, 
  CheckCircle, 
  AlertCircle,
  Users,
  Copy,
} from "lucide-react";

// Define the component props schema with Zod
export const livekitRoomConnectorSchema = z.object({
  roomName: z.string().optional().describe("Name of the room to join (default: 'tambo-canvas-room')"),
  userName: z.string().optional().describe("User's display name (default: 'Canvas User')"),
  serverUrl: z.string().optional().describe("LiveKit server URL (uses environment variable if not provided)"),
  audioOnly: z.boolean().optional().describe("Whether to join in audio-only mode (default: false)"),
  autoConnect: z.boolean().optional().describe("Whether to automatically connect on mount (default: false)"),
});

// Define the props type based on the Zod schema
export type LivekitRoomConnectorProps = z.infer<typeof livekitRoomConnectorSchema>;

// Component state type
type LivekitRoomConnectorState = {
  connectionState: "disconnected" | "connecting" | "connected" | "error";
  isMinimized: boolean;
  participantCount: number;
  errorMessage: string | null;
  token: string | null;
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
  roomName = "tambo-canvas-room",
  userName = "Canvas User",
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
        connectionState: "disconnected",
        isMinimized: false,
        participantCount: 0,
        errorMessage: null,
        token: null,
      };
    }
    
    const connectionState = room.state === ConnectionState.Connected ? "connected" :
                           room.state === ConnectionState.Connecting || room.state === ConnectionState.Reconnecting ? "connecting" :
                           "disconnected";
    
    return {
      connectionState,
      isMinimized: false,
      participantCount: room.numParticipants,
      errorMessage: null,
      token: null, // We don't know the token from room state
    };
  };
  
  // Initialize Tambo component state with actual room state
  const [state, setState] = useTamboComponentState<LivekitRoomConnectorState>(
    `livekit-room-${roomName}`,
    getInitialState()
  );

  // Keep a ref to the latest state for event handlers
  const stateRef = React.useRef<LivekitRoomConnectorState | null>(state);
  stateRef.current = state;

  // Get server URL from environment or props
  const wsUrl = serverUrl || process.env.NEXT_PUBLIC_LIVEKIT_URL || process.env.NEXT_PUBLIC_LK_SERVER_URL || "";
  
  // Component lifecycle tracking
  React.useEffect(() => {
    console.log(`🔧 [LiveKitConnector-${roomName}] Component mounted with external room`, {
      roomName,
      userName,
      serverUrl,
      wsUrlFromEnv: process.env.NEXT_PUBLIC_LIVEKIT_URL,
      lkServerUrlFromEnv: process.env.NEXT_PUBLIC_LK_SERVER_URL,
      finalWsUrl: wsUrl,
      audioOnly,
      autoConnect,
      hasRoom: !!room,
      roomState: room?.state,
      timestamp: new Date().toISOString()
    });

    // Check for missing environment variables
    if (!wsUrl) {
      console.error(`❌ [LiveKitConnector-${roomName}] Missing LiveKit server URL!`, {
        help: "Set NEXT_PUBLIC_LK_SERVER_URL in your .env.local file",
        example: "NEXT_PUBLIC_LK_SERVER_URL=wss://your-livekit-server.com"
      });
    }

    // Return cleanup function for unmount logging
    return () => {
      console.log(`🧹 [LiveKitConnector-${roomName}] Component unmounting`, {
        timestamp: new Date().toISOString()
      });
    };
  }, []); // Removed room, roomName, wsUrl from deps as they are stable after mount or derived

  // Track room connection state and attach/detach listeners
  React.useEffect(() => {
    if (!room) return;

    const handleConnected = () => {
      console.log(`✅ [LiveKitConnector-${roomName}] Room connected`);
      if (stateRef.current) {
        setState({ ...stateRef.current, connectionState: "connected" });
      }
    };

    const handleDisconnected = (reason?: DisconnectReason) => {
      console.log(`❌ [LiveKitConnector-${roomName}] Room disconnected:`, reason);
      if (stateRef.current) {
        setState({ ...stateRef.current, connectionState: "disconnected", token: null, participantCount: 0 });
      }
    };

    const handleReconnecting = () => {
      console.log(`🔄 [LiveKitConnector-${roomName}] Room reconnecting`);
      if (stateRef.current) {
        setState({ ...stateRef.current, connectionState: "connecting" });
      }
    };

    const handleReconnected = () => {
      console.log(`✅ [LiveKitConnector-${roomName}] Room reconnected`);
      if (stateRef.current) {
        setState({ ...stateRef.current, connectionState: "connected" });
      }
    };

    const handleParticipantConnected = (participant: Participant) => {
      const count = room.numParticipants;
      const participants = Array.from(room.remoteParticipants.values());
      console.log(`👥 [LiveKitConnector-${roomName}] Participant connected:`, {
        newParticipant: {
          identity: participant?.identity,
          sid: participant?.sid,
          name: participant?.name,
          metadata: participant?.metadata,
          isLocal: participant === room.localParticipant
        },
        totalCount: count,
        allParticipants: participants.map(p => ({
          identity: p.identity,
          name: p.name,
          isAgent: p.identity?.includes('agent') || p.metadata?.includes('agent')
        })),
        localParticipant: {
          identity: room.localParticipant?.identity,
          sid: room.localParticipant?.sid
        }
      });
      if (stateRef.current) {
        setState({ ...stateRef.current, participantCount: count });
      }
    };

    const handleParticipantDisconnected = (participant: Participant) => {
      const count = room.numParticipants;
      console.log(`👥 [LiveKitConnector-${roomName}] Participant disconnected:`, {
        disconnectedParticipant: {
          identity: participant?.identity,
          sid: participant?.sid,
          name: participant?.name
        },
        remainingCount: count
      });
      if (stateRef.current) {
        setState({ ...stateRef.current, participantCount: count });
      }
    };

    // Set initial connection state based on current room status, only if different
    const newConnState = room.state === ConnectionState.Connected ? "connected" :
                          room.state === ConnectionState.Connecting || room.state === ConnectionState.Reconnecting ? "connecting" :
                          "disconnected";
    const newParticipantCount = room.numParticipants;

    if (stateRef.current && (stateRef.current.connectionState !== newConnState || stateRef.current.participantCount !== newParticipantCount)) {
      console.log(`📊 [LiveKitConnector-${roomName}] Updating initial state in effect:`, { 
        prevConnectionState: stateRef.current?.connectionState, newConnectionState: newConnState,
        prevParticipantCount: stateRef.current?.participantCount, newParticipantCount 
      });
      setState({ ...stateRef.current, connectionState: newConnState, participantCount: newParticipantCount });
    } else {
      console.log(`📊 [LiveKitConnector-${roomName}] Initial state matches current room status, no update needed.`);
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
      console.log(`🧹 [LiveKitConnector-${roomName}] Cleaning up room event listeners`);
      room.off(RoomEvent.Connected, handleConnected);
      room.off(RoomEvent.Disconnected, handleDisconnected);
      room.off(RoomEvent.Reconnecting, handleReconnecting);
      room.off(RoomEvent.Reconnected, handleReconnected);
      room.off(RoomEvent.ParticipantConnected, handleParticipantConnected);
      room.off(RoomEvent.ParticipantDisconnected, handleParticipantDisconnected);
    };
  }, [room, roomName, setState]); // setState from Tambo should be stable

  // Track re-renders and token fetch state
  const renderCount = React.useRef(0);
  const tokenFetchInProgress = React.useRef(false);
  renderCount.current++;

  // Generate or fetch token
  React.useEffect(() => {
    console.log(`🎯 [LiveKitConnector-${roomName}] Token fetch effect triggered`, {
      connectionState: state?.connectionState,
      hasToken: !!state?.token,
      tokenFetchInProgress: tokenFetchInProgress.current,
      roomName,
      userName,
      timestamp: new Date().toISOString()
    });

    if (state?.connectionState !== "connecting" || state?.token || tokenFetchInProgress.current) {
      console.log(`🎯 [LiveKitConnector-${roomName}] Skipping token fetch`, {
        reason: state?.connectionState !== "connecting" ? "not connecting" : 
                state?.token ? "already have token" : "fetch in progress",
        connectionState: state?.connectionState,
        hasToken: !!state?.token,
        tokenFetchInProgress: tokenFetchInProgress.current
      });
      return; // Don't fetch if not connecting, already have token, or fetch in progress
    }

    let isActive = true; // Flag to prevent setting state if component unmounted

    const fetchToken = async () => {
      try {
        tokenFetchInProgress.current = true;
        console.log(`🔑 [LiveKitConnector-${roomName}] Starting token fetch`, {
          url: `/api/token?room=${roomName}&username=${userName}`,
          timestamp: new Date().toISOString()
        });

        const response = await fetch(`/api/token?room=${roomName}&username=${userName}`);
        
        console.log(`🔑 [LiveKitConnector-${roomName}] Token API response`, {
          status: response.status,
          statusText: response.statusText,
          ok: response.ok,
          url: response.url
        });
        
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const data = await response.json();
        
        console.log(`🔑 [LiveKitConnector-${roomName}] Token received successfully`, {
          hasToken: !!data.accessToken,
          tokenLength: data.accessToken?.length || 0,
          isActive,
          currentConnectionState: state?.connectionState, // Log state at time of receiving token
          responseData: data
        });
        
        // Only update state if component is still active and we're still connecting
        if (isActive) {
          if (stateRef.current && stateRef.current.connectionState === 'connecting') {
            const updated = { ...stateRef.current, token: data.accessToken };
            setState(updated);
            // Connect to room with token
            if (room && wsUrl && data.accessToken) {
              console.log(`🔌 [LiveKitConnector-${roomName}] Connecting to room with new token`);
              room.connect(wsUrl, data.accessToken, {
                autoSubscribe: true,
              }).then(async () => {
                // After connection, enable camera and microphone
                try {
                  console.log(`📹 [LiveKitConnector-${roomName}] Enabling camera and microphone`);
                  await room.localParticipant.setCameraEnabled(true);
                  await room.localParticipant.setMicrophoneEnabled(true);
                  console.log(`✅ [LiveKitConnector-${roomName}] Camera and microphone enabled`);
                  
                  // Request the LiveKit agent to join the room
                  console.log(`🤖 [LiveKitConnector-${roomName}] Requesting LiveKit agent to join`);
                  try {
                    // Send a data message to trigger agent join
                    const agentRequest = {
                      type: 'agent_request',
                      action: 'join',
                      timestamp: new Date().toISOString()
                    };
                    
                    // Publish data message to request agent
                    await room.localParticipant.publishData(
                      new TextEncoder().encode(JSON.stringify(agentRequest)),
                      { reliable: true }
                    );
                    
                    console.log(`✅ [LiveKitConnector-${roomName}] Agent join request sent via data channel`);
                  } catch (agentError) {
                    console.error(`⚠️ [LiveKitConnector-${roomName}] Failed to request agent:`, agentError);
                  }
                } catch (error) {
                  console.error(`⚠️ [LiveKitConnector-${roomName}] Failed to enable camera/mic:`, error);
                  // Non-fatal error - user might have denied permissions
                }
              }).catch(error => {
                console.error(`❌ [LiveKitConnector-${roomName}] Room connection failed:`, error);
                if (stateRef.current) {
                  setState({
                    ...stateRef.current, 
                    connectionState: "error",
                    errorMessage: `Failed to connect: ${error instanceof Error ? error.message : String(error)}`
                  });
                }
              });
            }
          } else {
            console.warn(`🔑 [LiveKitConnector-${roomName}] Token received but component inactive`);
          }
        } else {
          console.warn(`🔑 [LiveKitConnector-${roomName}] Token received but component inactive`);
        }
      } catch (error: unknown) {
        console.error(`❌ [LiveKitConnector-${roomName}] Token fetch failed:`, error);
        
        // Only update state if component is still active
        if (isActive) {
          console.log(`❌ [LiveKitConnector-${roomName}] Setting error state after fetch failure`);
          if (stateRef.current) {
            setState({
              ...stateRef.current, 
              connectionState: "error",
              errorMessage: `Failed to get access token: ${error instanceof Error ? error.message : String(error)}`
            });
          }
        }
      } finally {
        tokenFetchInProgress.current = false;
      }
    };

    // Add a small delay to prevent rapid requests
    const timer = setTimeout(() => {
      if (isActive) {
        console.log(`⏰ [LiveKitConnector-${roomName}] Token fetch timer triggered`);
        fetchToken();
      } else {
        console.log(`⏰ [LiveKitConnector-${roomName}] Token fetch timer cancelled (component inactive)`);
      }
    }, 500);

    // Cleanup function
    return () => {
      console.log(`🧹 [LiveKitConnector-${roomName}] Token fetch effect cleanup`);
      isActive = false;
      clearTimeout(timer);
    };
  }, [state?.connectionState, state?.token, roomName, userName, setState, room, wsUrl]); // Removed full 'state' from deps

  // Auto-connect on mount if requested - but only once
  React.useEffect(() => {
    console.log(`🤖 [LiveKitConnector-${roomName}] Auto-connect effect triggered`, {
      autoConnect,
      connectionState: state?.connectionState,
      timestamp: new Date().toISOString()
    });

    if (autoConnect && state?.connectionState === "disconnected") {
      console.log(`🤖 [LiveKitConnector-${roomName}] Setting up auto-connect timer`);
      // Add a delay to ensure component is fully mounted
      const timer = setTimeout(() => {
        console.log(`🤖 [LiveKitConnector-${roomName}] Auto-connect timer fired - calling handleConnect`);
        handleConnect();
      }, 1000);
      
      return () => {
        console.log(`🧹 [LiveKitConnector-${roomName}] Auto-connect timer cleanup`);
        clearTimeout(timer);
      };
    }
  }, [autoConnect]); // Ensure correct dependency for autoConnect

  // Handle connection toggle
  const handleConnect = () => {
    console.log(`🔌 [LiveKitConnector-${roomName}] handleConnect called`, {
      currentConnectionState: state?.connectionState,
      hasState: !!state,
      hasWsUrl: !!wsUrl,
      hasRoom: !!room,
      timestamp: new Date().toISOString()
    });

    if (!state || !room) {
      console.warn(`🔌 [LiveKitConnector-${roomName}] handleConnect: No state or room available`);
      return;
    }

    // Check for missing websocket URL
    if (!wsUrl && state.connectionState === "disconnected") {
      console.error(`🔌 [LiveKitConnector-${roomName}] Cannot connect: Missing LiveKit server URL`);
      if (stateRef.current) {
        setState({ 
          ...stateRef.current, 
          connectionState: "error", 
          errorMessage: "Missing LiveKit server URL. Check your environment variables." 
        });
      }
      return;
    }
    
    if (state.connectionState === "disconnected") {
      console.log(`🔌 [LiveKitConnector-${roomName}] Setting state to connecting`);
      if (stateRef.current) {
        setState({ ...stateRef.current, connectionState: "connecting", errorMessage: null });
      }
    } else if (state.connectionState === "connected") {
      console.log(`🔌 [LiveKitConnector-${roomName}] Disconnecting from room`);
      room.disconnect();
      // State update for disconnection is handled by the room event listener
    } else {
      console.log(`🔌 [LiveKitConnector-${roomName}] Connection attempt ignored - current state: ${state.connectionState}`);
    }
  };

  // Handle minimize toggle
  const handleMinimize = () => {
    if (stateRef.current) {
      setState({ ...stateRef.current, isMinimized: !stateRef.current.isMinimized });
    }
  };

  // Copy room link
  const handleCopyLink = () => {
    const link = `${window.location.origin}/canvas?room=${roomName}`;
    navigator.clipboard.writeText(link);
  };

  // Update canvas context when our state changes
  const canvasContext = React.useContext(CanvasLiveKitContext);
  React.useEffect(() => {
    // If we're inside a canvas context provider, we don't need to provide our own
    if (!canvasContext) {
      console.warn(`[LiveKitConnector-${roomName}] No canvas context found - participant tiles may not work`);
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
      {state?.connectionState === "connected" && (
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
  const connectionState = (state?.connectionState ?? 'disconnected') as LivekitRoomConnectorState['connectionState'];
  const isMinimized = state?.isMinimized || false;
  const participantCount = state?.participantCount || 0;
  const errorMessage = state?.errorMessage || null;

  return (
    <div
      className={cn(
        "bg-white border-2 rounded-lg shadow-lg transition-all duration-200",
        connectionState === "connected" && "border-green-500",
        connectionState === "connecting" && "border-blue-500",
        connectionState === "error" && "border-red-500",
        connectionState === "disconnected" && "border-gray-300",
        isMinimized ? "w-48 h-12" : "w-80"
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
          {connectionState === "connected" && <Wifi className="w-4 h-4 text-green-500" />}
          {connectionState === "connecting" && <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />}
          {connectionState === "error" && <AlertCircle className="w-4 h-4 text-red-500" />}
          {connectionState === "disconnected" && <WifiOff className="w-4 h-4 text-gray-500" />}
          
          <span className="font-medium text-sm select-none">
            {isMinimized ? "LiveKit" : "LiveKit Room Connector"}
          </span>
        </div>
        
        <button
          onClick={onMinimize}
          className="p-1 hover:bg-gray-100 rounded cursor-pointer select-none"
          style={{ pointerEvents: 'all' }}
        >
          {isMinimized ? "▲" : "▼"}
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
            
            {connectionState === "connected" && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-600 select-none">Participants:</span>
                <div className="flex items-center gap-1">
                  <Users className="w-3.5 h-3.5" />
                  <span className="select-none">{participantCount}</span>
                </div>
              </div>
            )}
          </div>

          {/* Status Message */}          
          {connectionState === "error" && errorMessage && (
            <div className="text-sm text-red-600 text-center select-none break-words">
              {errorMessage}
            </div>
          )}

          {connectionState === "connecting" && !errorMessage && (
            <div className="text-sm text-blue-600 text-center select-none">
              Connecting to room...
            </div>
          )}

          {connectionState === "connected" && !errorMessage && (
            <div className="text-sm text-green-600 text-center flex items-center justify-center gap-1 select-none">
              <CheckCircle className="w-3.5 h-3.5" />
              Connected successfully
            </div>
          )}

          {/* Action Buttons */} 
          <div className="flex gap-2">
            <button
              onClick={connectionState === "connected" ? onDisconnect : onConnect}
              disabled={connectionState === "connecting"}
              className={cn(
                "flex-1 px-3 py-2 rounded-md text-sm font-medium transition-colors cursor-pointer select-none",
                connectionState === "connected" 
                  ? "bg-red-500 text-white hover:bg-red-600"
                  : connectionState === "connecting"
                  ? "bg-gray-400 text-white cursor-not-allowed"
                  : "bg-blue-500 text-white hover:bg-blue-600"
              )}
              style={{ pointerEvents: connectionState === "connecting" ? 'none' : 'all' }}
            >
              {connectionState === "connected" ? "Disconnect" : 
               connectionState === "connecting" ? "Connecting..." :
               connectionState === "error" ? "Retry" : "Connect"}
            </button>
            
            {connectionState === "connected" && (
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

          {/* Instructions */} 
          {(connectionState === "disconnected" || (connectionState === "error" && !errorMessage?.includes("Missing LiveKit server URL"))) && (
            <div className="text-xs text-gray-500 text-center select-none">
              Connect to enable LiveKit features on the canvas
            </div>
          )}
          
          {connectionState === "connected" && (
            <div className="text-xs text-gray-500 text-center select-none">
              You can now spawn participant tiles and toolbars
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