"use client";

import React, { useState } from "react";
import { CanvasSpace } from "@/components/ui/canvas-space";
import { McpConfigButton } from "@/components/ui/mcp-config-button";
import { MessageThreadCollapsible } from "@/components/ui/message-thread-collapsible";
import { LivekitRoomConnector, CanvasLiveKitContext } from "@/components/ui/livekit-room-connector";
import { loadMcpServers } from "@/lib/mcp-utils";
import { components } from "@/lib/tambo";
import { TamboProvider } from "@tambo-ai/react";
import { TamboMcpProvider } from "@tambo-ai/react/mcp";
import { Room, ConnectionState, RoomEvent, VideoPresets, RoomOptions } from "livekit-client";
import { RoomContext } from "@livekit/components-react";

export default function Canvas() {
  // Load MCP server configurations
  const mcpServers = loadMcpServers();
  const contextKey = "tambo-canvas";
  
  // Create LiveKit room instance for the canvas
  const [room] = useState(() => {
    const roomOptions: RoomOptions = {
      adaptiveStream: true,
      dynacast: true,
      videoCaptureDefaults: {
        resolution: VideoPresets.h720.resolution,
      },
      publishDefaults: {
        videoSimulcastLayers: [VideoPresets.h180, VideoPresets.h360, VideoPresets.h720],
        videoCodec: 'vp8',
      },
    };
    
    return new Room(roomOptions);
  });
  
  // Track room connection state for context
  const [roomState, setRoomState] = useState({
    isConnected: false,
    roomName: "tambo-canvas-room",
    participantCount: 0,
  });

  console.log(`🎨 [Canvas] Page component rendered`, {
    mcpServersCount: Object.keys(mcpServers).length,
    contextKey,
    hasRoom: !!room,
    timestamp: new Date().toISOString(),
    userAgent: typeof window !== 'undefined' ? window.navigator.userAgent : 'SSR'
  });

  // Track component lifecycle and cleanup room
  React.useEffect(() => {
    console.log(`🎨 [Canvas] Page mounted with LiveKit room`, {
      timestamp: new Date().toISOString()
    });
    
    // Update room state when room state changes
    const updateRoomState = () => {
      setRoomState({
        isConnected: room.state === ConnectionState.Connected,
        roomName: "tambo-canvas-room",
        participantCount: room.numParticipants,
      });
    };
    
    // Listen to room events
    room.on(RoomEvent.Connected, updateRoomState);
    room.on(RoomEvent.Disconnected, updateRoomState);
    room.on(RoomEvent.Reconnecting, updateRoomState);
    room.on(RoomEvent.Reconnected, updateRoomState);
    room.on(RoomEvent.ParticipantConnected, updateRoomState);
    room.on(RoomEvent.ParticipantDisconnected, updateRoomState);
    
    return () => {
      console.log(`🧹 [Canvas] Page unmounting, disconnecting room`, {
        timestamp: new Date().toISOString()
      });
      room.off(RoomEvent.Connected, updateRoomState);
      room.off(RoomEvent.Disconnected, updateRoomState);
      room.off(RoomEvent.Reconnecting, updateRoomState);
      room.off(RoomEvent.Reconnected, updateRoomState);
      room.off(RoomEvent.ParticipantConnected, updateRoomState);
      room.off(RoomEvent.ParticipantDisconnected, updateRoomState);
      room.disconnect();
    };
  }, [room]);

  return (
    <div className="h-screen w-screen relative overflow-hidden">
      {/* MCP Config Button - positioned at top left */}
      <McpConfigButton />

      {/* Tambo Provider Setup */}
      <TamboProvider
        apiKey={process.env.NEXT_PUBLIC_TAMBO_API_KEY!}
        components={components}
      >
        <TamboMcpProvider mcpServers={mcpServers}>
          {/* LiveKit Room Context Provider - wraps everything! */}
          <RoomContext.Provider value={room}>
            {/* Canvas LiveKit Context Provider - provides connection state to all canvas components */}
            <CanvasLiveKitContext.Provider value={roomState}>
              {/* Full-screen Canvas Space */}
              <CanvasSpace className="absolute inset-0 w-full h-full" />

              {/* Direct LiveKit Room Connector - positioned top right */}
              <div className="absolute top-4 right-4 z-50">
                <LivekitRoomConnector 
                  roomName="tambo-canvas-room"
                  userName="Canvas User"
                  autoConnect={false}
                />
              </div>

              {/* Collapsible Message Thread - positioned bottom right as overlay */}
              <MessageThreadCollapsible
                contextKey={contextKey}
                defaultOpen={false}
                className="absolute bottom-4 right-4 z-50"
                variant="default"
              />
            </CanvasLiveKitContext.Provider>
          </RoomContext.Provider>
        </TamboMcpProvider>
      </TamboProvider>
    </div>
  );
}
