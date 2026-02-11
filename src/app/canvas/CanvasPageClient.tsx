'use client';

// Route segment config is server-only in theory, but the client bootstrap depends on browser
// globals. Keep this component namespaced so the server entry can opt out of prerendering.

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { CanvasSpace } from '@/components/ui/canvas/canvas-space';
import { CanvasParityAutopilot } from '@/components/ui/canvas/CanvasParityAutopilot';
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
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/hooks/use-auth';
import { RoomScopedProviders } from '@/components/RoomScopedProviders';
import { ToolDispatcher } from '@/components/tool-dispatcher';
import { SystemRegistrySync } from '@/components/ui/diagnostics/system-registry-sync';
import { initializeMCPBridge } from '@/lib/mcp-bridge';
import { AgentCapabilitiesBridge } from '@/components/ui/integrations/agent-capabilities-bridge';
import { LiveKitStateBridge } from '@/lib/livekit/livekit-state-bridge';
import LiveKitDebugConsole from '@/components/LiveKitDebugConsole';
import {
  initJourneyLogger,
  persistJourneyRunId,
  resolveJourneyConfig,
  updateJourneyRoom,
  logJourneyEvent,
} from '@/lib/journey-logger';
import { fetchWithSupabaseAuth } from '@/lib/supabase/auth-headers';
import { getBooleanFlag } from '@/lib/feature-flags';

// Suppress development warnings for cleaner console
suppressDevelopmentWarnings();
suppressViolationWarnings();
// Initialize MCP bridge on client
if (typeof window !== 'undefined') {
  try {
    initializeMCPBridge();
  } catch { }
}

export function CanvasPageClient() {
  // Authentication check
  const { user, loading } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const bypassAuth = getBooleanFlag(process.env.NEXT_PUBLIC_CANVAS_DEV_BYPASS, false);
  const demoMode = getBooleanFlag(process.env.NEXT_PUBLIC_CANVAS_DEMO_MODE, false);
  const searchParamsKey = searchParams?.toString() ?? '';
  // Track resolved canvas id and room name; do not render until resolved
  const [, setCanvasId] = useState<string | null>(null);
  const [roomName, setRoomName] = useState<string>('');
  const [demoNameDraft, setDemoNameDraft] = useState('');
  const [demoAuthAttempted, setDemoAuthAttempted] = useState(false);
  const [demoError, setDemoError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!demoMode || bypassAuth) return;
    if (loading || user) return;
    if (demoAuthAttempted) return;

    let storedName = '';
    try {
      storedName = window.localStorage.getItem('present:display_name')?.trim() || '';
    } catch { }

    if (!storedName) {
      return;
    }

    setDemoAuthAttempted(true);
    setDemoError(null);
    void (async () => {
      try {
        const { supabase } = await import('@/lib/supabase');
        const authAny = supabase.auth as any;
        if (typeof authAny?.signInAnonymously !== 'function') {
          throw new Error('Supabase anonymous auth not supported in this build');
        }
        const res = await authAny.signInAnonymously({ options: { data: { full_name: storedName } } });
        const error = res?.error;
        if (error) {
          setDemoError(error.message || 'Failed to start demo session');
          setDemoAuthAttempted(false);
        }
      } catch (err: any) {
        setDemoError(err?.message || 'Failed to start demo session');
        setDemoAuthAttempted(false);
      }
    })();
  }, [demoMode, bypassAuth, loading, user, demoAuthAttempted]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!roomName) return;
    try {
      const config = resolveJourneyConfig();
      if (!config?.enabled || !config.runId) {
        updateJourneyRoom(roomName);
        return;
      }
      persistJourneyRunId(config.runId);
      initJourneyLogger({
        runId: config.runId,
        roomName,
        enabled: config.enabled,
        endpoint: '/api/journey/log',
      });
    } catch { }
  }, [roomName]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const url = new URL(window.location.href);
      const shareParam = url.searchParams.get('share');
      if (!shareParam || shareParam === '0' || shareParam === 'false') return;

      const roomParam = url.searchParams.get('room');
      const roomMatch = roomParam?.match(/^canvas-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
      const idFromRoom = roomMatch?.[1] || null;
      const id = url.searchParams.get('id') || idFromRoom;
      const key = `present:share-opened:${id || 'unknown'}`;
      if (window.sessionStorage.getItem(key)) return;
      window.sessionStorage.setItem(key, '1');

      logJourneyEvent({
        eventType: 'share_link_opened',
        source: 'ui',
        payload: { canvasId: id || null },
      });

      url.searchParams.delete('share');
      window.history.replaceState({}, '', url.toString());
    } catch { }
  }, []);

  const isUuid = (value: string | null | undefined) =>
    !!value && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

  const joinParityCanvas = useCallback(async (canvasId: string, room: string) => {
    if (typeof window === 'undefined') return;
    if (!canvasId || !room || !room.startsWith('canvas-')) return;
    if (window.sessionStorage.getItem(`present:parity-joined:${room}`)) return;
    try {
      await fetchWithSupabaseAuth('/api/canvas/parity-join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ canvasId, room }),
      });
      window.sessionStorage.setItem(`present:parity-joined:${room}`, '1');
    } catch {
      // non-fatal; parity flow can continue without membership
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    // Resolve canvas id from URL, localStorage fallback, or create a new canvas row
    const resolveCanvasId = async () => {
      console.log('[CanvasPageClient] resolveCanvasId started');
      const url = new URL(window.location.href);
      const roomOverride = url.searchParams.get('room');
      const isFresh = url.searchParams.get('fresh') === '1';
      console.log('[CanvasPageClient] URL params:', { roomOverride, id: url.searchParams.get('id') });

      if (isFresh) {
        try {
          localStorage.removeItem('present:lastCanvasId');
        } catch { }
        // Clear UI state immediately so the old room doesn't keep running while we spin up a new canvas.
        setCanvasId(null);
        setRoomName('');
        url.searchParams.delete('id');
        url.searchParams.delete('room');
        url.searchParams.delete('fresh');
        window.history.replaceState({}, '', url.toString());
      }

      if (roomOverride && roomOverride.trim().length > 0) {
        const sanitized = roomOverride.trim();
        const roomMatch = sanitized.match(/^canvas-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
        if (roomMatch?.[1] && isUuid(roomMatch[1])) {
          const derivedCanvasId = roomMatch[1];
          setCanvasId(derivedCanvasId);
          setRoomName(sanitized);
          joinParityCanvas(derivedCanvasId, sanitized);
          if (url.searchParams.get('id') !== derivedCanvasId) {
            url.searchParams.set('id', derivedCanvasId);
            window.history.replaceState({}, '', url.toString());
          }
          try {
            localStorage.setItem('present:lastCanvasId', derivedCanvasId);
          } catch { }
        } else {
          setCanvasId(sanitized);
          setRoomName(sanitized);
        }
        try {
          window.dispatchEvent(new Event('present:canvas-id-changed'));
        } catch { }
        return;
      }
      const isSyntheticDevId = (value: string | null) => !!value && value.startsWith('dev-');

      let idParam = url.searchParams.get('id');
      if (isSyntheticDevId(idParam) && user) {
        url.searchParams.delete('id');
        window.history.replaceState({}, '', url.toString());
        setCanvasId(null);
        setRoomName('');
        try {
          localStorage.removeItem('present:lastCanvasId');
        } catch { }
        try {
          window.dispatchEvent(new Event('present:canvas-id-changed'));
        } catch { }
        idParam = null;
      }

      if (idParam) {
        setCanvasId(idParam);
        setRoomName(`canvas-${idParam}`);
        try {
          localStorage.setItem('present:lastCanvasId', idParam);
        } catch { }
        try {
          window.dispatchEvent(new Event('present:canvas-id-changed'));
        } catch { }
        return;
      }

      // Try localStorage last used canvas id
      let lastId: string | null = null;
      try {
        lastId = localStorage.getItem('present:lastCanvasId');
      } catch { }
      if (isSyntheticDevId(lastId) && user) {
        try {
          localStorage.removeItem('present:lastCanvasId');
        } catch { }
        lastId = null;
      }

      if (lastId) {
        url.searchParams.set('id', lastId);
        window.history.replaceState({}, '', url.toString());
        setCanvasId(lastId);
        setRoomName(`canvas-${lastId}`);
        try {
          window.dispatchEvent(new Event('present:canvas-id-changed'));
        } catch { }
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
            } catch { }
            try {
              w.__present = w.__present || {};
              w.__present.creatingCanvas = false;
            } catch { }
            try {
              window.dispatchEvent(new Event('present:canvas-id-changed'));
            } catch { }
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
      } catch { }
      const now = new Date().toISOString();
      // Lazy import to avoid SSR issues
      const { supabase } = await import('@/lib/supabase');
      console.log('[CanvasPageClient] Supabase imported, attempting to create canvas...');

      // Simple retry loop to avoid transient failures
      const MAX_TRIES = 2;
      let attempt = 0;
      let createdId: string | null = null;
      let lastErr: any = null;
      while (attempt < MAX_TRIES && !createdId) {
        attempt++;
        console.log(`[CanvasPageClient] Creation attempt ${attempt}`);
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
          console.error('[CanvasPageClient] Creation error:', error);
          lastErr = error;
        } else if (data?.id) {
          console.log('[CanvasPageClient] Created canvas:', data.id);
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
        } catch { }
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
      } catch { }
      try {
        (window as any).__present.creatingCanvas = false;
      } catch { }
      try {
        window.dispatchEvent(new Event('present:canvas-id-changed'));
      } catch { }
    };

    resolveCanvasId();

    const handleCanvasIdChanged = () => {
      try {
        const current = new URL(window.location.href).searchParams.get('id');
        if (current) {
          setCanvasId(current);
          setRoomName(`canvas-${current}`);
          console.log('setRoomName called with:', `canvas-${current}`);
          try {
            localStorage.setItem('present:lastCanvasId', current);
          } catch { }
        }
      } catch { }
    };
    window.addEventListener('present:canvas-id-changed', handleCanvasIdChanged);
    return () => window.removeEventListener('present:canvas-id-changed', handleCanvasIdChanged);
  }, [user, bypassAuth, joinParityCanvas, searchParamsKey]);

  // Transcript panel state
  const [isTranscriptOpen, setIsTranscriptOpen] = useState(false);

  const toggleTranscript = useCallback(() => {
    setIsTranscriptOpen((prev) => !prev);
  }, []);
  const transcriptPanelRef = useRef<HTMLDivElement>(null);
  const [transcriptOffset, setTranscriptOffset] = useState(0);

  useEffect(() => {
    if (!isTranscriptOpen) {
      setTranscriptOffset(0);
      return;
    }

    const panel = transcriptPanelRef.current;
    if (!panel) return;

    const updateOffset = () => {
      const width = panel.getBoundingClientRect().width;
      setTranscriptOffset(Math.max(0, Math.round(width)));
    };

    updateOffset();
    const observer = new ResizeObserver(updateOffset);
    observer.observe(panel);
    window.addEventListener('resize', updateOffset);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updateOffset);
    };
  }, [isTranscriptOpen]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const offsetValue = `${isTranscriptOpen ? transcriptOffset : 0}px`;
    document.documentElement.style.setProperty('--present-transcript-offset', offsetValue);
    document.body.style.setProperty('--present-transcript-offset', offsetValue);
    return () => {
      document.documentElement.style.setProperty('--present-transcript-offset', '0px');
      document.body.style.setProperty('--present-transcript-offset', '0px');
    };
  }, [isTranscriptOpen, transcriptOffset]);

  // Redirect to sign in if not authenticated
  useEffect(() => {
    if (loading) return;
    if (!user && !bypassAuth && !demoMode) {
      router.push('/auth/signin');
    }
  }, [user, loading, router, bypassAuth, demoMode]);

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
      const remoteIdentities = Array.from(room.remoteParticipants.values()).map((p) => p.identity);
      const next = {
        isConnected: room.state === ConnectionState.Connected,
        roomName,
        participantCount: room.numParticipants,
      };
      setRoomState(next);
      try {
        const w = window as any;
        w.__present = w.__present || {};
        w.__present.livekitRoomName = next.roomName;
        w.__present.livekitConnected = next.isConnected;
        w.__present.livekitParticipantCount = next.participantCount;
        w.__present.livekitRemoteParticipantIdentities = remoteIdentities;
        w.__present.livekitHasAgent = remoteIdentities.some((id: string) => {
          const s = String(id || '').toLowerCase();
          return s.startsWith('agent_') || s.includes('agent') || s.includes('bot') || s.includes('ai');
        });
      } catch {}
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
    } catch { }
  }, [room]);

  // Show loading state while checking authentication
  if (loading || (!roomName && !(demoMode && !user && !bypassAuth))) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-surface">
        <div className="text-secondary text-sm">Loading…</div>
      </div>
    );
  }

  if (!user && !bypassAuth && demoMode) {
    const submit = async () => {
      const name = demoNameDraft.trim();
      if (!name) return;
      try {
        window.localStorage.setItem('present:display_name', name);
      } catch { }
      setDemoAuthAttempted(true);
      setDemoError(null);
      try {
        const { supabase } = await import('@/lib/supabase');
        const authAny = supabase.auth as any;
        if (typeof authAny?.signInAnonymously !== 'function') {
          throw new Error('Supabase anonymous auth not supported in this build');
        }
        const res = await authAny.signInAnonymously({ options: { data: { full_name: name } } });
        const error = res?.error;
        if (error) {
          setDemoError(error.message || 'Failed to start demo session');
          setDemoAuthAttempted(false);
        }
      } catch (err: any) {
        setDemoError(err?.message || 'Failed to start demo session');
        setDemoAuthAttempted(false);
      }
    };

    return (
      <div className="h-screen w-screen flex items-center justify-center bg-surface p-6">
        <div className="w-full max-w-md rounded-2xl bg-surface-elevated shadow-lg border border-default p-6">
          <div className="heading-lg">Join the demo</div>
          <div className="text-secondary text-sm mt-1">
            Pick a display name. You will join the room automatically.
          </div>
          <div className="mt-4">
            <label className="text-xs text-secondary">Display name</label>
            <input
              value={demoNameDraft}
              onChange={(e) => setDemoNameDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void submit();
              }}
              autoFocus
              className="mt-1 w-full rounded-lg border border-default bg-surface px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--present-accent-ring)]"
              placeholder="Alex"
            />
          </div>
          {demoError ? (
            <div className="mt-3 text-sm text-danger">{demoError}</div>
          ) : null}
          <div className="mt-5 flex items-center gap-3">
            <button
              onClick={() => void submit()}
              disabled={!demoNameDraft.trim() || demoAuthAttempted}
              className={[
                'rounded-lg px-4 py-2 text-sm font-medium transition-colors',
                demoNameDraft.trim() && !demoAuthAttempted
                  ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                  : 'bg-muted text-muted-foreground cursor-not-allowed',
              ].join(' ')}
            >
              {demoAuthAttempted ? 'Connecting...' : 'Join'}
            </button>
            <div className="text-xs text-tertiary">
              Powered by Supabase anonymous auth
            </div>
          </div>
        </div>
      </div>
    );
  }

  // If not authenticated, don't render the canvas
  if (!user && !bypassAuth) {
    console.log('[CanvasPageClient] Not authenticated and bypassAuth is false. Returning null.');
    return null;
  }

  console.log('[CanvasPageClient] Rendering main UI', { user: user?.id, roomName });

  return (
    <div
      className="ios-vh w-screen relative overflow-hidden safe-area-padded"
      style={{
        ['--present-transcript-offset' as any]: `${isTranscriptOpen ? transcriptOffset : 0}px`,
      }}
    >
      {enableMcp ? (
        <EnhancedMcpProvider mcpServers={mcpServers}>
          <SystemRegistrySync />

          <RoomContext.Provider value={room}>
            <RoomScopedProviders>
              <LiveKitDebugConsole enabled={enableDebugConsole} />
              <ToolDispatcher contextKey={contextKey} enableLogging={enableDispatcherLogs}>
                <AgentCapabilitiesBridge />
                <CanvasLiveKitContext.Provider value={roomState}>
                  <CanvasSpace
                    className="absolute inset-0 w-full h-full ios-vh"
                    onTranscriptToggle={toggleTranscript}
                  />

                  <CanvasParityAutopilot />

                  <SessionSync roomName={roomName} />

                  <MessageThreadCollapsible
                    contextKey={contextKey}
                    className={[
                      'fixed right-0 top-0 z-50 transform transition-transform duration-300 w-full max-w-sm sm:max-w-md md:max-w-lg ios-vh safe-area-padded bg-background',
                      isTranscriptOpen ? 'translate-x-0' : 'translate-x-full pointer-events-none opacity-0',
                    ].join(' ')}
                    ref={transcriptPanelRef}
                    isOpen={isTranscriptOpen}
                    onClose={toggleTranscript}
                  />
                </CanvasLiveKitContext.Provider>
              </ToolDispatcher>
            </RoomScopedProviders>
          </RoomContext.Provider>
        </EnhancedMcpProvider>
      ) : (
        <RoomContext.Provider value={room}>
          <RoomScopedProviders>
            <ToolDispatcher contextKey={contextKey} enableLogging={enableDispatcherLogs}>
              <AgentCapabilitiesBridge />
              <CanvasLiveKitContext.Provider value={roomState}>
                <CanvasSpace
                  className="absolute inset-0 w-full h-full ios-vh"
                  onTranscriptToggle={toggleTranscript}
                />

                <CanvasParityAutopilot />

                <SessionSync roomName={roomName} />

                <MessageThreadCollapsible
                  contextKey={contextKey}
                  className={[
                    'fixed right-0 top-0 z-50 transform transition-transform duration-300 w-full max-w-sm sm:max-w-md md:max-w-lg ios-vh safe-area-padded bg-background',
                    isTranscriptOpen ? 'translate-x-0' : 'translate-x-full pointer-events-none opacity-0',
                  ].join(' ')}
                  ref={transcriptPanelRef}
                  isOpen={isTranscriptOpen}
                  onClose={toggleTranscript}
                />
              </CanvasLiveKitContext.Provider>
            </ToolDispatcher>
          </RoomScopedProviders>
        </RoomContext.Provider>
      )}
    </div>
  );
}

export default CanvasPageClient;
