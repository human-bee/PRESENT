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
  // Track resolved canvas id and room name; do not render until resolved
  const [canvasId, setCanvasId] = useState<string | null>(null);
  const [roomName, setRoomName] = useState<string | null>(null);
  
  useEffect(() => {
    if (typeof window === 'undefined') return;
    // Resolve canvas id from URL, localStorage fallback, or create a new canvas row
    const resolveCanvasId = async () => {
      const url = new URL(window.location.href);
      const idParam = url.searchParams.get('id');
      if (idParam) {
        setCanvasId(idParam);
        setRoomName(`tambo-canvas-${idParam}`);
        try { localStorage.setItem('present:lastCanvasId', idParam); } catch {}
        try { window.dispatchEvent(new Event('present:canvas-id-changed')); } catch {}
        return;
      }

      // Try localStorage last used canvas id
      let lastId: string | null = null;
      try { lastId = localStorage.getItem('present:lastCanvasId'); } catch {}
      if (lastId) {
        url.searchParams.set('id', lastId);
        window.history.replaceState({}, '', url.toString());
        setCanvasId(lastId);
        setRoomName(`tambo-canvas-${lastId}`);
        try { window.dispatchEvent(new Event('present:canvas-id-changed')); } catch {}
        return;
      }

      // No id known: create a new canvas row immediately so URL + room are stable
      // Defer creation until user is authenticated
      if (!user) return;
      const now = new Date().toISOString();
      // Lazy import to avoid SSR issues
      const { supabase } = await import('@/lib/supabase');

      // Simple retry loop to avoid transient failures
      const MAX_TRIES = 2;
      let attempt = 0;
      let createdId: string | null = null;
      let lastErr: any = null;
      while (attempt < MAX_TRIES && !createdId) {
        attempt++;
        const { data, error } = await supabase
          .from('canvases')
          .insert({
            user_id: user.id,
            name: 'Untitled Canvas',
            description: null,
            document: {},
            conversation_key: null,
            is_public: false,
            last_modified: now,
          })
          .select('id')
          .single();
        if (error) {
          lastErr = error;
        } else if (data?.id) {
          createdId = data.id;
        }
      }

      if (!createdId) {
        console.error('❌ [Canvas] Could not create canvas row; staying on loading screen', lastErr);
        return; // Keep loading; user can refresh or try again
      }
      // Immediately set the canvas name to the id for clarity/stability
      try {
        await supabase
          .from('canvases')
          .update({ name: createdId, updated_at: now, last_modified: now })
          .eq('id', createdId);
        // Ensure creator is a member (editor) for RLS-friendly access
        try {
          await supabase
            .from('canvas_members')
            .upsert({ canvas_id: createdId, user_id: user.id, role: 'editor', created_at: now } as any,
                    { onConflict: 'canvas_id,user_id' } as any);
        } catch {}
      } catch (e) {
        console.warn('⚠️ [Canvas] Failed to set canvas name to id:', e);
      }

      url.searchParams.set('id', createdId);
      window.history.replaceState({}, '', url.toString());
      setCanvasId(createdId);
      setRoomName(`tambo-canvas-${createdId}`);
      try { localStorage.setItem('present:lastCanvasId', createdId); } catch {}
      try { window.dispatchEvent(new Event('present:canvas-id-changed')); } catch {}
    };

    resolveCanvasId();

    const handleCanvasIdChanged = () => {
      try {
        const current = new URL(window.location.href).searchParams.get('id');
        if (current) {
          setCanvasId(current);
          setRoomName(`tambo-canvas-${current}`);
          try { localStorage.setItem('present:lastCanvasId', current); } catch {}
        }
      } catch {}
    };
    window.addEventListener('present:canvas-id-changed', handleCanvasIdChanged);
    return () => window.removeEventListener('present:canvas-id-changed', handleCanvasIdChanged);
  }, [user]);
  
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
    roomName: "",
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
    if (roomName) {
      setRoomState((prev) => ({ ...prev, roomName }));
    }
  }, [roomName]);

  // Show loading state while checking authentication
  if (loading || !roomName) {
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
    <div className="ios-vh w-screen relative overflow-hidden safe-area-padded">
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
                  className="absolute inset-0 w-full h-full ios-vh"
                  onTranscriptToggle={toggleTranscript}
                />

                <SessionSync roomName={roomName} />

                {/* Optional LiveKit Room Connector (toggle via env NEXT_PUBLIC_SHOW_LIVEKIT_CONNECTOR) */}
                {process.env.NEXT_PUBLIC_SHOW_LIVEKIT_CONNECTOR === 'true' && (
                  <div className="absolute left-4 z-50 safe-bottom" style={{ bottom: 'calc(1rem + env(safe-area-inset-bottom))' }}>
                    <LivekitRoomConnector 
                      roomName={roomName}
                      userName={user.user_metadata?.full_name || "Canvas User"}
                      autoConnect={false}
                    />
                  </div>
                )}

                {/* Collapsible Message Thread - now slides from right and controlled by toolbar */}
                {isTranscriptOpen && (
                  <MessageThreadCollapsible
                    contextKey={contextKey}
                    className="fixed right-0 top-0 z-50 transform transition-transform duration-300 w-full max-w-sm sm:max-w-md md:max-w-lg ios-vh safe-area-padded bg-background"
                    variant="default"
                    onClose={toggleTranscript}
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
                  className="absolute inset-0 w-full h-full ios-vh"
                  onTranscriptToggle={toggleTranscript}
                />

                <SessionSync roomName={roomName} />

                {/* Optional LiveKit Room Connector (toggle via env NEXT_PUBLIC_SHOW_LIVEKIT_CONNECTOR) */}
                {process.env.NEXT_PUBLIC_SHOW_LIVEKIT_CONNECTOR === 'true' && (
                  <div className="absolute left-4 z-50 safe-bottom" style={{ bottom: 'calc(1rem + env(safe-area-inset-bottom))' }}>
                    <LivekitRoomConnector 
                      roomName={roomName}
                      userName={user.user_metadata?.full_name || "Canvas User"}
                      autoConnect={false}
                    />
                  </div>
                )}

                {/* Collapsible Message Thread - now slides from right and controlled by toolbar */}
                {isTranscriptOpen && (
                  <MessageThreadCollapsible
                    contextKey={contextKey}
                    className="fixed right-0 top-0 z-50 transform transition-transform duration-300 w-full max-w-sm sm:max-w-md md:max-w-lg ios-vh safe-area-padded bg-background"
                    variant="default"
                    onClose={toggleTranscript}
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
