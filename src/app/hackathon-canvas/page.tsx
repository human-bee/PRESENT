/**
 * CanvasPage
 *
 * Core collaborative workspace for authenticated users.
 * Handles authentication redirect, initializes LiveKit for real-time audio/video and data sync, loads MCP server configs, and composes the main canvas UI with chat, controls, and agent integrations.
 */

"use client";

// Force dynamic rendering to prevent build errors
export const dynamic = "force-dynamic";

// Force client-side rendering to prevent SSG issues with Tambo hooks
import { ToolDispatcher } from "@/components/tool-dispatcher";
import CanvasSpaceSingleComponent from "@/components/ui/hackathon/canvas-space-single-component";
import { CanvasLiveKitContext } from "@/components/ui/livekit-room-connector";
import { MessageThreadCollapsible } from "@/components/ui/message-thread-collapsible";
import {
  loadMcpServers,
  suppressDevelopmentWarnings,
  suppressViolationWarnings,
} from "@/lib/mcp-utils";
import { RoomContext } from "@livekit/components-react";
import { TamboProvider } from "@tambo-ai/react";
import {
  ConnectionState,
  Room,
  RoomEvent,
  RoomOptions,
  VideoPresets,
} from "livekit-client";
import React, { useCallback, useState } from "react";
import { tamboTools, testComponents } from "../milsttest/test-tambo-setup";

// Suppress development warnings for cleaner console
suppressDevelopmentWarnings();
suppressViolationWarnings();

export default function Canvas() {
  // Transcript panel state
  const [isTranscriptOpen, setIsTranscriptOpen] = useState(false);

  const toggleTranscript = useCallback(() => {
    setIsTranscriptOpen((prev) => !prev);
  }, []);

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
        facingMode: "user", // Prefer front-facing camera
      },
      audioCaptureDefaults: {
        echoCancellation: true,
        noiseSuppression: true,
      },
      publishDefaults: {
        videoSimulcastLayers: [
          VideoPresets.h180,
          VideoPresets.h360,
          VideoPresets.h720,
        ],
        videoCodec: "vp8",
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

  // Track component lifecycle and cleanup room
  React.useEffect(() => {
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
      {/* User Navigation - positioned top right, canvas persistence is in tldraw toolbar */}
      {/* Removed - now in main menu */}

      {/* MCP Config Button - positioned at top left */}
      {/* Removed - now in main menu */}

      {/* Tambo Provider Setup */}
      <TamboProvider
        apiKey={process.env.NEXT_PUBLIC_TAMBO_API_KEY!}
        components={testComponents}
        tools={tamboTools}
        tamboUrl={process.env.NEXT_PUBLIC_TAMBO_URL}
      >
        {/* <EnhancedMcpProvider mcpServers={mcpServers}> */}
        {/* LiveKit Room Context Provider - wraps everything! */}
        <RoomContext.Provider value={room}>
          {/* Tool Dispatcher - handles voice agent tool calls */}
          <ToolDispatcher contextKey={contextKey} enableLogging={true}>
            {/* Canvas LiveKit Context Provider - provides connection state to all canvas components */}
            <CanvasLiveKitContext.Provider value={roomState}>
              {/* Full-screen Canvas Space */}
              <CanvasSpaceSingleComponent
                className="absolute inset-0 w-full h-full"
                onTranscriptToggle={toggleTranscript}
              />
              {/* Collapsible Message Thread - now slides from right and controlled by toolbar */}
              {/* {isTranscriptOpen && ( */}
              <MessageThreadCollapsible
                contextKey={contextKey}
                className="fixed right-0 top-0 h-full z-50 transform transition-transform duration-300 w-full max-w-sm sm:max-w-md md:max-w-lg"
                variant="default"
              />
              {/* )} */}
            </CanvasLiveKitContext.Provider>
          </ToolDispatcher>
        </RoomContext.Provider>
        {/* </EnhancedMcpProvider> */}
      </TamboProvider>
    </div>
  );
}
