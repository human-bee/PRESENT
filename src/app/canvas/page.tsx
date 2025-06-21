/**
 * CanvasPage
 * 
 * Core collaborative workspace for authenticated users. 
 * Handles authentication redirect, initializes LiveKit for real-time audio/video and data sync, loads MCP server configs, and composes the main canvas UI with chat, controls, and agent integrations.
 */

"use client";

// Force dynamic rendering to prevent build errors
export const dynamic = 'force-dynamic';

// Force client-side rendering to prevent SSG issues with Tambo hooks
import React, { useState, useEffect, useCallback } from "react";
import { CanvasSpace } from "@/components/ui/canvas-space";
import { MessageThreadCollapsible } from "@/components/ui/message-thread-collapsible";
import { LivekitRoomConnector, CanvasLiveKitContext } from "@/components/ui/livekit-room-connector";
import { loadMcpServers, suppressDevelopmentWarnings, suppressViolationWarnings } from "@/lib/mcp-utils";
import { components } from "@/lib/tambo";
import { TamboProvider } from "@tambo-ai/react";
import { EnhancedMcpProvider } from "@/components/ui/enhanced-mcp-provider";
import { Room, ConnectionState, RoomEvent, VideoPresets, RoomOptions } from "livekit-client";
import { RoomContext } from "@livekit/components-react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/use-auth";
import { SpeechTranscription } from '@/components/ui/speech-transcription';
import { ToolDispatcher } from '@/components/tool-dispatcher';

// Suppress development warnings for cleaner console
suppressDevelopmentWarnings();
suppressViolationWarnings();

export default function Canvas() {
  // Authentication check
  const { user, loading } = useAuth();
  const router = useRouter();
  
  // Transcript panel state
  const [isTranscriptOpen, setIsTranscriptOpen] = useState(false);
  
  const toggleTranscript = useCallback(() => {
    setIsTranscriptOpen(prev => !prev);
  }, []);
  
  // Redirect to sign in if not authenticated
  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.push("/auth/signin");
    }
  }, [user, loading, router]);
  
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
        facingMode: 'user', // Prefer front-facing camera
      },
      audioCaptureDefaults: {
        echoCancellation: true,
        noiseSuppression: true,
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

  // Show loading state while checking authentication
  if (loading) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-gradient-to-br from-slate-50 via-blue-50/30 to-indigo-50/20">
        <div className="text-gray-500">Loading...</div>
      </div>
    );
  }

  // If not authenticated, don't render the canvas
  if (!user) {
    return null;
  }

  return (
    <div className="h-screen w-screen relative overflow-hidden">
      {/* User Navigation - positioned top right, canvas persistence is in tldraw toolbar */}
      {/* Removed - now in main menu */}

      {/* MCP Config Button - positioned at top left */}
      {/* Removed - now in main menu */}

      {/* Tambo Provider Setup */}
      <TamboProvider
        apiKey={process.env.NEXT_PUBLIC_TAMBO_API_KEY!}
        components={components}
      >
        <EnhancedMcpProvider mcpServers={mcpServers}>
          {/* LiveKit Room Context Provider - wraps everything! */}
          <RoomContext.Provider value={room}>
            {/* Tool Dispatcher - handles voice agent tool calls */}
            <ToolDispatcher contextKey={contextKey} enableLogging={true}>
              {/* Canvas LiveKit Context Provider - provides connection state to all canvas components */}
              <CanvasLiveKitContext.Provider value={roomState}>
              {/* Full-screen Canvas Space */}
              <CanvasSpace 
                className="absolute inset-0 w-full h-full" 
                onTranscriptToggle={toggleTranscript}
              />

              {/* Speech Transcription Component - Bottom Right */}
              {/* Temporarily disabled - moving to MessageThreadCollapsible tabs
              <div className="absolute bottom-20 right-8 z-[99999999999] pointer-events-auto">
                <SpeechTranscription />
              </div>
              */}

              {/* Direct LiveKit Room Connector - positioned bottom left to avoid overlap */}
              <div className="absolute bottom-4 left-4 z-50">
                <LivekitRoomConnector 
                  roomName="tambo-canvas-room"
                  userName={user.user_metadata?.full_name || "Canvas User"}
                  autoConnect={false}
                />
              </div>

              {/* Collapsible Message Thread - now slides from right and controlled by toolbar */}
              {isTranscriptOpen && (
              <MessageThreadCollapsible
                contextKey={contextKey}
                  defaultOpen={true}
                  className="fixed right-0 top-0 h-full z-50 transform transition-transform duration-300 w-full max-w-sm sm:max-w-md md:max-w-lg"
                variant="default"
              />
              )}
              </CanvasLiveKitContext.Provider>
            </ToolDispatcher>
          </RoomContext.Provider>
        </EnhancedMcpProvider>
      </TamboProvider>
    </div>
  );
}
