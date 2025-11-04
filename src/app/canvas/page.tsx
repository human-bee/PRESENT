/**
 * CanvasPage
 *
 * Core collaborative workspace for authenticated users.
 * Handles authentication redirect, initializes LiveKit for real-time audio/video and data sync, loads MCP server configs, and composes the main canvas UI with chat, controls, and agent integrations.
 */

'use client';

// Route segment config is server-only; avoid exporting from a client component to keep TSX parse simple.
// If you need dynamic rendering, configure it in a server wrapper for this page or via middleware.
// export const dynamic = 'force-dynamic';

import React, { useState, useEffect, useCallback } from 'react';
import { CanvasSpace } from '@/components/ui/canvas/canvas-space';
import { MessageThreadCollapsible } from '@/components/ui/messaging/message-thread-collapsible';
import { CanvasLiveKitContext } from '@/components/ui/livekit/livekit-room-connector';
import SessionSync from '@/components/SessionSync';
import {
  loadMcpServers,
  suppressDevelopmentWarnings,
  suppressViolationWarnings,
} from '@/lib/mcp-utils';
import { EnhancedMcpProvider } from '@/components/ui/mcp/enhanced-mcp-provider';
import { Room, ConnectionState, RoomEvent, VideoPresets, RoomOptions } from 'livekit-client';
import { RoomContext } from '@livekit/components-react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/use-auth';
import { ToolDispatcher } from '@/components/tool-dispatcher';
import { SystemRegistrySync } from '@/components/ui/diagnostics/system-registry-sync';
import { initializeMCPBridge } from '@/lib/mcp-bridge';
import { AgentCapabilitiesBridge } from '@/components/ui/integrations/agent-capabilities-bridge';
import { LiveKitStateBridge } from '@/lib/livekit/livekit-state-bridge';
import LiveKitDebugConsole from '@/components/LiveKitDebugConsole';
// TODO: Investigate best way to "go back" to CanvasSpace once we have a better way to handle adding/updating/managing the state of multiple components on the canvas simultaneously

// Suppress development warnings for cleaner console
suppressDevelopmentWarnings();
suppressViolationWarnings();
// Initialize MCP bridge on client
if (typeof window !== 'undefined') {
  try { initializeMCPBridge(); } catch {}
}

export default function Canvas() {
  // Authentication check
  const { user, loading } = useAuth();
  const router = useRouter();
  const bypassAuth = process.env.NEXT_PUBLIC_CANVAS_DEV_BYPASS === 'true';
  // Track resolved canvas id and room name; do not render until resolved
  const [, setCanvasId] = useState<string | null>(null);
  const [roomName, setRoomName] = useState<string>('');

  useEffect(() => {
    if (typeof window === 'undefined') return;
    // Resolve canvas id from URL, localStorage fallback, or create a new canvas row
    const resolveCanvasId = async () => {
      const url = new URL(window.location.href);
      const isSyntheticDevId = (value: string | null) => !!value && value.startsWith('dev-');

      let idParam = url.searchParams.get('id');
      if (isSyntheticDevId(idParam) && user) {
        url.searchParams.delete('id');
        window.history.replaceState({}, '', url.toString());
        setCanvasId(null);
        setRoomName('');
        try {
          localStorage.removeItem('present:lastCanvasId');
        } catch {}
        try {
          window.dispatchEvent(new Event('present:canvas-id-changed'));
        } catch {}
        idParam = null;
      }

      if (idParam) {
        setCanvasId(idParam);
        setRoomName(`canvas-${idParam}`);
        try {
          localStorage.setItem('present:lastCanvasId', idParam);
        } catch {}
        try {
          window.dispatchEvent(new Event('present:canvas-id-changed'));
        } catch {}
        return;
      }

      // Try localStorage last used canvas id
      let lastId: string | null = null;
      try {
        lastId = localStorage.getItem('present:lastCanvasId');
      } catch {}
      if (isSyntheticDevId(lastId) && user) {
        try {
          localStorage.removeItem('present:lastCanvasId');
        } catch {}
        lastId = null;
      }

      if (lastId) {
        url.searchParams.set('id', lastId);
        window.history.replaceState({}, '', url.toString());
        setCanvasId(lastId);
        setRoomName(`canvas-${lastId}`);
        try {
          window.dispatchEvent(new Event('present:canvas-id-changed'));
        } catch {}
        return;
      }

      // No id known: create a new canvas row immediately so URL + room are stable
      // In dev bypass mode, synthesize a stable local canvas id even without auth.
      if (!user) {
        if (bypassAuth) {
          try {
            const devKey = 'present:lastCanvasId';
            const w = window as any;
            const existingDevId = localStorage.getItem(devKey);
            let generatedId = existingDevId;
            if (!generatedId) {
              const randomSuffix = typeof crypto !== 'undefined' && crypto.randomUUID
                ? crypto.randomUUID()
                : Math.random().toString(36).slice(2, 10);
              generatedId = `dev-${randomSuffix}`;
            }

            url.searchParams.set('id', generatedId);
            window.history.replaceState({}, '', url.toString());
            setCanvasId(generatedId);
            setRoomName(`canvas-${generatedId}`);
            try {
              localStorage.setItem(devKey, generatedId);
            } catch {}
            try {
              w.__present = w.__present || {};
              w.__present.creatingCanvas = false;
            } catch {}
            try {
              window.dispatchEvent(new Event('present:canvas-id-changed'));
            } catch {}
          } catch (err) {
            console.warn('⚠️ [Canvas] Failed to synthesize dev canvas id:', err);
          }
        }
        return;
      }

      // Guard against duplicate inserts (React StrictMode / fast refresh / rapid re-entry)
      try {
        (window as any).__present = (window as any).__present || {};
        if ((window as any).__present.creatingCanvas) {
          console.warn('⚠️ [Canvas] Creation in progress; skipping duplicate create attempt');
          return;
        }
        (window as any).__present.creatingCanvas = true;
      } catch {}
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
        console.error(
          '❌ [Canvas] Could not create canvas row; staying on loading screen',
          lastErr,
        );
        try {
          (window as any).__present.creatingCanvas = false;
        } catch {}
        return; // Keep loading; user can refresh or try again
      }
      // Immediately set the canvas name to the id for clarity/stability
      try {
        await supabase
          .from('canvases')
          .update({ name: createdId, updated_at: now, last_modified: now })
          .eq('id', createdId);
        // Do NOT upsert owner into canvas_members to avoid duplicate rows in views
      } catch (e) {
        console.warn('⚠️ [Canvas] Failed to set canvas name to id:', e);
      }

      url.searchParams.set('id', createdId);
      window.history.replaceState({}, '', url.toString());
      setCanvasId(createdId);
      setRoomName(`canvas-${createdId}`);
      try {
        localStorage.setItem('present:lastCanvasId', createdId);
      } catch {}
      try {
        (window as any).__present.creatingCanvas = false;
      } catch {}
      try {
        window.dispatchEvent(new Event('present:canvas-id-changed'));
      } catch {}
    };

    resolveCanvasId();

    const handleCanvasIdChanged = () => {
      try {
        const current = new URL(window.location.href).searchParams.get('id');
        if (current) {
          setCanvasId(current);
          setRoomName(`canvas-${current}`);
          try {
            localStorage.setItem('present:lastCanvasId', current);
          } catch {}
        }
      } catch {}
    };
    window.addEventListener('present:canvas-id-changed', handleCanvasIdChanged);
    return () => window.removeEventListener('present:canvas-id-changed', handleCanvasIdChanged);
  }, [user, bypassAuth]);

  // Transcript panel state
  const [isTranscriptOpen, setIsTranscriptOpen] = useState(false);

  const toggleTranscript = useCallback(() => {
    setIsTranscriptOpen((prev) => !prev);
  }, []);

  // Redirect to sign in if not authenticated
  useEffect(() => {
    if (loading) return;
    if (!user && !bypassAuth) {
      router.push('/auth/signin');
    }
  }, [user, loading, router, bypassAuth]);

  // Load MCP server configurations
  const mcpServers = loadMcpServers();
  const contextKey = 'canvas';
  // Feature flag to gate MCP in canvas to isolate invalid external tool names if needed
  const enableMcp = process.env.NEXT_PUBLIC_ENABLE_MCP_IN_CANVAS === 'true';
  // Local flags for logs / debug console
  const enableDispatcherLogs = process.env.NEXT_PUBLIC_TOOL_DISPATCHER_LOGS === 'true';
  const enableDebugConsole = process.env.NODE_ENV !== 'production';

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
    roomName: '',
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

  // Bridge SystemRegistry state <-> LiveKit data channel so the agent can see canvas components
  useEffect(() => {
    if (!room) return;
    try {
      // Avoid double-start in dev/StrictMode by using a per-room guard
      const key = `present:state-bridge:${room.name || 'default'}`;
      const w = window as any;
      if (typeof window !== 'undefined' && w[key]) return;
      if (typeof window !== 'undefined') w[key] = true;

      const bridge = new LiveKitStateBridge(room);
      bridge.start();
    } catch {}
  }, [room]);

  // Show loading state while checking authentication
  if (loading || !roomName) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-gradient-to-br from-slate-50 via-blue-50/30 to-indigo-50/20">
        <div className="text-gray-500">Loading...</div>
      </div>
    );
  }

  // If not authenticated, don't render the canvas
  if (!user && !bypassAuth) {
    return null;
  }

  return (
    <div className="ios-vh w-screen relative overflow-hidden safe-area-padded">
      {/* User Navigation - positioned top right, canvas persistence is in tldraw toolbar */}
      {/* Removed - now in main menu */}

      {/* MCP Config Button - positioned at top left */}
      {/* Removed - now in main menu */}

      {enableMcp ? (
        <EnhancedMcpProvider mcpServers={mcpServers}>
          {/* System Registry Sync - syncs components and tools */}
          <SystemRegistrySync />

          {/* LiveKit Room Context Provider - wraps everything! */}
          <RoomContext.Provider value={room}>
            {/* Dev traces for data-channel (decision/tool_call/tool_result/editor_action) */}
            <LiveKitDebugConsole enabled={enableDebugConsole} />
            {/* Tool Dispatcher - handles voice agent tool calls */}
            <ToolDispatcher contextKey={contextKey} enableLogging={enableDispatcherLogs}>
              {/* Respond to agent capability queries */}
              <AgentCapabilitiesBridge />
              {/* Canvas LiveKit Context Provider - provides connection state to all canvas components */}
              <CanvasLiveKitContext.Provider value={roomState}>
                {/* Full-screen Canvas Space */}
                <CanvasSpace
                  className="absolute inset-0 w-full h-full ios-vh"
                  onTranscriptToggle={toggleTranscript}
                />

                <SessionSync roomName={roomName} />

                {/* LiveKit connection is now controlled from the Transcript sidebar */}

                {/* Collapsible Message Thread - keep mounted; hide via transform to preserve state */}
                <MessageThreadCollapsible
                  contextKey={contextKey}
                  className={[
                    'fixed right-0 top-0 z-50 transform transition-transform duration-300 w-full max-w-sm sm:max-w-md md:max-w-lg ios-vh safe-area-padded bg-background',
                    isTranscriptOpen ? 'translate-x-0' : 'translate-x-full pointer-events-none opacity-0',
                  ].join(' ')}
                  variant="default"
                  onClose={toggleTranscript}
                />
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
            {/* Dev traces for data-channel (decision/tool_call/tool_result/editor_action) */}
            <LiveKitDebugConsole enabled={enableDebugConsole} />
            {/* Tool Dispatcher - handles voice agent tool calls */}
            <ToolDispatcher contextKey={contextKey} enableLogging={enableDispatcherLogs}>
              {/* Respond to agent capability queries */}
              <AgentCapabilitiesBridge />
              {/* Canvas LiveKit Context Provider - provides connection state to all canvas components */}
              <CanvasLiveKitContext.Provider value={roomState}>
                {/* Full-screen Canvas Space */}
                <CanvasSpace
                  className="absolute inset-0 w-full h-full ios-vh"
                  onTranscriptToggle={toggleTranscript}
                />

                <SessionSync roomName={roomName} />

                {/* LiveKit connection is now controlled from the Transcript sidebar */}

                {/* Collapsible Message Thread - keep mounted; hide via transform to preserve state */}
                <MessageThreadCollapsible
                  contextKey={contextKey}
                  className={[
                    'fixed right-0 top-0 z-50 transform transition-transform duration-300 w-full max-w-sm sm:max-w-md md:max-w-lg ios-vh safe-area-padded bg-background',
                    isTranscriptOpen ? 'translate-x-0' : 'translate-x-full pointer-events-none opacity-0',
                  ].join(' ')}
                  variant="default"
                  onClose={toggleTranscript}
                />
              </CanvasLiveKitContext.Provider>
            </ToolDispatcher>
          </RoomContext.Provider>
        </>
      )}
    </div>
  );
}
