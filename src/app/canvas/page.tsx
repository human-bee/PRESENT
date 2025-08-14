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
import SessionSync from "@/components/SessionSync";
import { loadMcpServers, suppressDevelopmentWarnings, suppressViolationWarnings } from "@/lib/mcp-utils";
import { components, tools } from "@/lib/tambo";
import { validateTamboTools } from "@/lib/tambo-tool-validator";
import { TamboProvider } from "@tambo-ai/react";
import { EnhancedMcpProvider } from "@/components/ui/enhanced-mcp-provider";
import { Room, ConnectionState, RoomEvent, VideoPresets, RoomOptions } from "livekit-client";
import { RoomContext } from "@livekit/components-react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/use-auth";
import { ToolDispatcher } from '@/components/tool-dispatcher';
import { SystemRegistrySync } from '@/components/ui/system-registry-sync';
// TODO: Investigate best way to "go back" to CanvasSpace once we have a better way to handle adding/updating/managing the state of multiple components on the canvas simultaneously


// Suppress development warnings for cleaner console
suppressDevelopmentWarnings();
suppressViolationWarnings();

export default function Canvas() {
  // Authentication check
  const { user, loading } = useAuth();
  const router = useRouter();
  
  // Create unique room name based on canvas ID or generate one
  const [roomName, setRoomName] = useState<string>('tambo-canvas-room');
  
  useEffect(() => {
    // Extract canvas ID from URL params
    const urlParams = new URLSearchParams(window.location.search);
    const canvasId = urlParams.get('id');
    const roomParam = urlParams.get('room');
    
    // Prefer explicit canvas id; fall back to room param for backward compatibility
    if (canvasId) {
      // Use canvas-specific room
      setRoomName(`tambo-canvas-${canvasId}`);
      console.log('🏠 [Canvas] Using canvas-specific room (id):', `tambo-canvas-${canvasId}`);
    } else if (roomParam) {
      // Support both raw ids and fully-qualified room names
      const computed = roomParam.startsWith('tambo-canvas-') ? roomParam : `tambo-canvas-${roomParam}`;
      setRoomName(computed);
      console.log('🏠 [Canvas] Using canvas-specific room (room):', computed);
    } else {
      // Generate unique room for new canvas
      // Use crypto UUID when available for stability
      const newId = (window.crypto?.randomUUID?.() || `new-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`);
      const computed = `tambo-canvas-${newId}`;
      setRoomName(computed);
      console.log('🏠 [Canvas] Generated new room:', computed);
      // Silently update URL with id so refreshes stay grounded
      const nextUrl = new URL(window.location.href);
      nextUrl.searchParams.set('id', newId);
      window.history.replaceState({}, '', nextUrl.toString());
    }
  }, []);
  
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
  // Feature flag to gate MCP in canvas to isolate invalid external tool names if needed
  const enableMcp = process.env.NEXT_PUBLIC_ENABLE_MCP_IN_CANVAS === 'true';
  
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
        roomName,
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
  }, [room, roomName]);

  // Keep context roomName in sync when the computed roomName changes
  useEffect(() => {
    setRoomState((prev) => ({ ...prev, roomName }));
  }, [roomName]);

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
        tools={validateTamboTools(tools as any)}
      >
        {enableMcp ? (
          <EnhancedMcpProvider mcpServers={mcpServers}>
            {/* System Registry Sync - syncs components and tools */}
            <SystemRegistrySync />
            
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

                <SessionSync roomName={roomName} />

                {/* Direct LiveKit Room Connector - positioned bottom left to avoid overlap */}
                <div className="absolute bottom-4 left-4 z-50">
                  <LivekitRoomConnector 
                    roomName={roomName}
                    userName={user.user_metadata?.full_name || "Canvas User"}
                    autoConnect={false}
                  />
                </div>

                {/* Collapsible Message Thread - now slides from right and controlled by toolbar */}
                {isTranscriptOpen && (
                  <MessageThreadCollapsible
                    contextKey={contextKey}
                    className="fixed right-0 top-0 h-full z-50 transform transition-transform duration-300 w-full max-w-sm sm:max-w-md md:max-w-lg"
                    variant="default"
                  />
                )}
                </CanvasLiveKitContext.Provider>
              </ToolDispatcher>
            </RoomContext.Provider>
          </EnhancedMcpProvider>
        ) : (
          <>
            {/* System Registry Sync - syncs components and tools */}
            <SystemRegistrySync />
            
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

                <SessionSync roomName={roomName} />

                {/* Direct LiveKit Room Connector - positioned bottom left to avoid overlap */}
                <div className="absolute bottom-4 left-4 z-50">
                  <LivekitRoomConnector 
                    roomName={roomName}
                    userName={user.user_metadata?.full_name || "Canvas User"}
                    autoConnect={false}
                  />
                </div>

                {/* Collapsible Message Thread - now slides from right and controlled by toolbar */}
                {isTranscriptOpen && (
                  <MessageThreadCollapsible
                    contextKey={contextKey}
                    className="fixed right-0 top-0 h-full z-50 transform transition-transform duration-300 w-full max-w-sm sm:max-w-md md:max-w-lg"
                    variant="default"
                  />
                )}
                </CanvasLiveKitContext.Provider>
              </ToolDispatcher>
            </RoomContext.Provider>
          </>
        )}
      </TamboProvider>
    </div>
  );
}
