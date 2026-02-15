'use client';

import type { messageVariants } from '@/components/ui/messaging/message';
import { ThreadDropdown } from '@/components/ui/messaging/thread-dropdown';
import { ScrollableMessageContainer } from '@/components/ui/messaging/scrollable-message-container';
import { cn } from '@/lib/utils';
import { FileText } from 'lucide-react';
import * as React from 'react';
import { type VariantProps } from 'class-variance-authority';
import { Button } from '@/components/ui/shared/button';
import { useRoomContext } from '@livekit/components-react';
import { RoomEvent } from 'livekit-client';
import { createLiveKitBus } from '../../../lib/livekit/livekit-bus';
import { useContextKey } from '@/components/RoomScopedProviders';
import { useRealtimeSessionTranscript } from '@/hooks/use-realtime-session-transcript';
import { supabase } from '@/lib/supabase';
import { fetchWithSupabaseAuth } from '@/lib/supabase/auth-headers';
import { CanvasLiveKitContext } from '../livekit/livekit-room-connector';
import { useAuth } from '@/hooks/use-auth';
import { useAllTranscripts, useTranscriptStore, type Transcript as StoreTranscript } from '@/lib/stores/transcript-store';
import { buildLivekitTokenHeaders } from '@/components/ui/livekit/hooks/utils/lk-token';
import { resolveEdgeIngressUrl } from '@/lib/edge-ingress';

/**
 * Props for the MessageThreadCollapsible component
 * @interface
 * @extends React.HTMLAttributes<HTMLDivElement>
 */
export interface MessageThreadCollapsibleProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Optional context key for the thread */
  contextKey?: string;
  /**
   * Controls the visual styling of messages in the thread.
   * Possible values include: "default", "compact", etc.
   * These values are defined in messageVariants from "@/components/ui/message".
   * @example variant="compact"
   */
  variant?: VariantProps<typeof messageVariants>['variant'];
  /** Callback when transcript data changes - for persistence */
  onTranscriptChange?: (
    transcripts: Array<{
      id: string;
      speaker: string;
      text: string;
      timestamp: number;
      isFinal: boolean;
      source: 'agent' | 'user' | 'system';
      type?: 'speech' | 'system_call';
    }>,
  ) => void;
  /** Optional close handler for mobile to minimize the panel */
  onClose?: () => void;
  /** Controls open/closed state for styling; not forwarded to the DOM */
  isOpen?: boolean;
}

const SUPPORTED_SLASH_COMMANDS = new Set(['canvas']);

type ParsedSlashCommand = {
  command: string;
  body: string;
};

type CanvasComponentEntry = {
  messageId: string;
  componentType: string;
  state: Record<string, unknown>;
  title: string;
  updatedAt?: number;
};

const parseSlashCommand = (input: string): ParsedSlashCommand | null => {
  if (!input) return null;
  const trimmed = input.trim();
  if (!trimmed.startsWith('/')) return null;
  const remainder = trimmed.slice(1).trim();
  if (!remainder) return null;
  const firstSpace = remainder.indexOf(' ');
  const command = (firstSpace === -1 ? remainder : remainder.slice(0, firstSpace)).toLowerCase();
  const body = (firstSpace === -1 ? '' : remainder.slice(firstSpace + 1)).trim();
  return { command, body };
};

/**
 * A collapsible chat thread component with keyboard shortcuts and thread management
 * @component
 * @example
 * ```tsx
 * <MessageThreadCollapsible
 *   contextKey="my-thread"
 *   className="left-4" // Position on the left instead of right
 *   variant="default"
 * />
 * ```
 */

export const MessageThreadCollapsible = React.forwardRef<
  HTMLDivElement,
  MessageThreadCollapsibleProps
>(({ className, contextKey, onTranscriptChange, onClose, isOpen, ...restProps }, ref) => {
  // Conversations tab removed; Transcript is the only view
  const [agentEvents, setAgentEvents] = React.useState<
    Array<{
      ts: number;
      kind?: 'action' | 'status' | 'trace';
      sessionId?: string;
      seq?: number;
      actionCount?: number;
      verbCounts?: Record<string, number>;
      status?: string;
      traceStep?: string;
      traceId?: string;
      intentId?: string;
      requestId?: string;
      raw?: any;
      firstAction?: { name?: string; preview?: string };
    }>
  >([]);
  const [canvasComponents, setCanvasComponents] = React.useState<CanvasComponentEntry[]>([]);
  // System call entries (component creation events) - kept local
  const [systemCalls, setSystemCalls] = React.useState<
    Array<{
      id: string;
      speaker: string;
      text: string;
      timestamp: number;
      isFinal: boolean;
      source: 'system';
      type: 'system_call';
    }>
  >([]);
  
  // Get transcripts from centralized store
  const storeTranscripts = useAllTranscripts();
  const { batchAddTranscripts, clearTranscripts: storeClearTranscripts } = useTranscriptStore();
  
  // Merge store transcripts with local system calls for display
  const transcriptions = React.useMemo(() => {
    const speechTranscripts = storeTranscripts.map((t): {
      id: string;
      speaker: string;
      text: string;
      timestamp: number;
      isFinal: boolean;
      source: 'agent' | 'user' | 'system';
      type?: 'speech' | 'system_call';
    } => ({
      id: t.id,
      speaker: t.speaker,
      text: t.text,
      timestamp: t.timestamp,
      isFinal: t.isFinal,
      source: t.source || (t.speaker === 'voice-agent' ? 'agent' : 'user'),
      type: 'speech',
    }));
    const merged = [...speechTranscripts, ...systemCalls];
    merged.sort((a, b) => a.timestamp - b.timestamp);
    return merged;
  }, [storeTranscripts, systemCalls]);

  // Ref for auto-scroll
  const transcriptContainerRef = React.useRef<HTMLDivElement>(null);

  // LiveKit room context and bus for transcript functionality
  const room = useRoomContext();
  const bus = React.useMemo(() => createLiveKitBus(room), [room]);
  const roomContextKey = useContextKey();
  const effectiveContextKey = contextKey || roomContextKey;
  const livekitCtx = React.useContext(CanvasLiveKitContext);
  const { transcript: sessionTranscript } = useRealtimeSessionTranscript(livekitCtx?.roomName);
  const { user } = useAuth();

  const refreshCanvasComponents = React.useCallback(() => {
    if (typeof window === 'undefined') return;
    try {
      const globalAny = window as any;
      const editor =
        globalAny?.__present?.tldrawEditor ??
        globalAny?.__present_tldrawEditor ??
        globalAny?.tldrawEditor ??
        globalAny?.__PRESENT_TLDRAW_EDITOR ??
        null;
      if (!editor || typeof editor.getCurrentPageShapes !== 'function') {
        return;
      }
      const shapes = editor.getCurrentPageShapes?.() ?? [];
      const nextEntries: CanvasComponentEntry[] = [];
      for (const shape of shapes as any[]) {
        if (!shape || shape.type !== 'custom') continue;
        const messageId =
          typeof shape?.props?.customComponent === 'string' ? shape.props.customComponent.trim() : '';
        if (!messageId) continue;
        const componentType =
          typeof shape?.props?.name === 'string' && shape.props.name.trim().length > 0
            ? shape.props.name
            : 'CustomComponent';
        const rawState = shape?.props?.state;
        const state =
          rawState && typeof rawState === 'object' ? (rawState as Record<string, unknown>) : {};
        const titleCandidate =
          typeof state.title === 'string' && state.title.trim().length > 0
            ? state.title
            : typeof state.label === 'string' && state.label.trim().length > 0
              ? state.label
              : componentType;
        const updatedAt =
          typeof state.updatedAt === 'number' && Number.isFinite(state.updatedAt)
            ? state.updatedAt
            : undefined;
        nextEntries.push({
          messageId,
          componentType,
          state,
          title: titleCandidate,
          updatedAt,
        });
      }
      setCanvasComponents(nextEntries);
    } catch (error) {
      if (process.env.NODE_ENV !== 'production') {
        if (process.env.NEXT_PUBLIC_TOOL_DISPATCHER_LOGS === 'true') {
          console.warn('[Transcript] Failed to refresh canvas components', error);
        }
      }
    }
  }, []);

  // Local text input state for sending manual messages to the agent from Transcript tab
  const [typedMessage, setTypedMessage] = React.useState<string>('');
  const [isSending, setIsSending] = React.useState<boolean>(false);
  const [connBusy, setConnBusy] = React.useState<boolean>(false);
  const slashCommand = React.useMemo(() => parseSlashCommand(typedMessage), [typedMessage]);
  const isRecognizedSlashCommand = Boolean(
    slashCommand && SUPPORTED_SLASH_COMMANDS.has(slashCommand.command),
  );
  const slashHasBody = Boolean(slashCommand?.body && slashCommand.body.trim().length > 0);
  const showAgentEvents = React.useMemo(() => {
    if (typeof window === 'undefined') return false;
    return (
      process.env.NEXT_PUBLIC_CANVAS_PARITY_DEV === 'true' &&
      new URLSearchParams(window.location.search).has('debugAgent')
    );
  }, []);
  const mentionMatchesCanvasAgent = React.useMemo(() => {
    if (isRecognizedSlashCommand) return false;
    if (!typedMessage) return false;
    return /@canvas-agent/gi.test(typedMessage);
  }, [isRecognizedSlashCommand, typedMessage]);
  const slashCommandBodyMissing = Boolean(isRecognizedSlashCommand && !slashHasBody);

  React.useEffect(() => {
    refreshCanvasComponents();
  }, [refreshCanvasComponents]);

  React.useEffect(() => {
    if (process.env.NODE_ENV !== 'production') {
      try {
        (window as any).__presentTypedMessage = typedMessage;
      } catch {
        // ignore
      }
    }
  }, [typedMessage]);

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleImmediate: EventListener = () => {
      refreshCanvasComponents();
    };
    const handleRaf: EventListener = () => {
      window.requestAnimationFrame(() => refreshCanvasComponents());
    };
    window.addEventListener('present:component-registered', handleImmediate);
    window.addEventListener('present:component-store-updated', handleImmediate);
    window.addEventListener('present:canvas-id-changed', handleImmediate);
    window.addEventListener('tldraw:merge_component_state', handleRaf);
    return () => {
      window.removeEventListener('present:component-registered', handleImmediate);
      window.removeEventListener('present:component-store-updated', handleImmediate);
      window.removeEventListener('present:canvas-id-changed', handleImmediate);
      window.removeEventListener('tldraw:merge_component_state', handleRaf);
    };
  }, [refreshCanvasComponents]);

  // Helper: detect if an agent participant is present in the room
  const isAgentPresent = React.useCallback(() => {
    try {
      if (!room) return false;
      const participants = Array.from(room.remoteParticipants.values());
      const isAgent = (id: string, meta?: string | null) => {
        const lower = (id || '').toLowerCase();
        const m = (meta || '').toLowerCase();
        return (
          lower.includes('agent') ||
          lower.includes('bot') ||
          lower.includes('ai') ||
          lower.startsWith('voice-agent') ||
          m.includes('agent') ||
          m.includes('type":"agent')
        );
      };
      return participants.some((p: any) => isAgent(p.identity, p.metadata));
    } catch {
      return false;
    }
  }, [room]);

  // Track agent presence reactively
  const [agentPresent, setAgentPresent] = React.useState<boolean>(() => isAgentPresent());
  const [agentJoining, setAgentJoining] = React.useState<boolean>(false);
  React.useEffect(() => {
    if (!room) return;
    const recompute = () => setAgentPresent(isAgentPresent());
    recompute();
    const handleJoin = () => recompute();
    const handleLeave = () => recompute();
    room.on(RoomEvent.ParticipantConnected, handleJoin as any);
    room.on(RoomEvent.ParticipantDisconnected, handleLeave as any);
    return () => {
      room.off(RoomEvent.ParticipantConnected, handleJoin as any);
      room.off(RoomEvent.ParticipantDisconnected, handleLeave as any);
    };
  }, [room, isAgentPresent]);

  type LiveTranscriptionPayload = {
    type: 'live_transcription';
    event_id: string;
    text: string;
    speaker: string;
    participantId: string;
    participantName?: string;
    timestamp: number;
    is_final: boolean;
    manual: boolean;
  };

  // Minimal connect/disconnect helpers (replaces canvas LivekitRoomConnector UI)
  const wsUrl =
    process.env.NEXT_PUBLIC_LIVEKIT_URL || process.env.NEXT_PUBLIC_LK_SERVER_URL || '';

  const connectRoom = React.useCallback(async () => {
    if (!room || !livekitCtx?.roomName || !wsUrl) return;
    if (room.state === 'connected' || connBusy) return;
    setConnBusy(true);
    try {
      // Stable identity per device+room
      const key = `present:lk:identity:${livekitCtx.roomName}`;
      let identity: string | null = null;
      try {
        identity = window.localStorage.getItem(key);
        if (!identity) {
          const base = (user?.user_metadata?.full_name || 'user').replace(/\s+/g, '-').slice(0, 24);
          const rand = Math.random().toString(36).slice(2, 8);
          identity = `${base}-${rand}`;
          window.localStorage.setItem(key, identity);
        }
      } catch {
        const base = (user?.user_metadata?.full_name || 'user').replace(/\s+/g, '-').slice(0, 24);
        const rand = Math.random().toString(36).slice(2, 8);
        identity = `${base}-${rand}`;
      }
      // Prefer configured token endpoint; fall back to /api/token
      const tokenEndpoint =
        process.env.NEXT_PUBLIC_LK_TOKEN_ENDPOINT || resolveEdgeIngressUrl('/api/token');
      // Build absolute URL to avoid basePath/iframe pitfalls
      const base = typeof window !== 'undefined' ? window.location.origin : '';
      const tokenUrl = new URL(tokenEndpoint, base);
      tokenUrl.searchParams.set('roomName', livekitCtx.roomName);
      tokenUrl.searchParams.set('identity', identity!);
      
      // Update name parameter to prioritize stored display name
      const storedDisplayName = window.localStorage.getItem('present:display_name');
      tokenUrl.searchParams.set('name', storedDisplayName || user?.user_metadata?.full_name || 'Canvas User');

      let data: any | null = null;
      try {
        const headers = await buildLivekitTokenHeaders({
          roomName: livekitCtx.roomName,
          identity: identity!,
          pathname: tokenUrl.pathname,
        });
        const res = await fetch(tokenUrl.toString(), { cache: 'no-store', headers });
        if (!res.ok) throw new Error(`Token fetch failed: ${res.status}`);
        data = await res.json();
      } catch (err) {
        console.error('[LiveKit] Token fetch error', {
          endpoint: tokenUrl.toString(),
          roomName: livekitCtx.roomName,
          identity,
          error: err,
        });
        throw err;
      }

      const token = data?.accessToken || data?.token;
      if (!token) throw new Error('No token received');

      await room.connect(wsUrl, token);
      try {
        console.log('[LiveKit] Connected, enabling camera and microphone');
        await room.localParticipant.setCameraEnabled(true);
      } catch { }
      try { await room.localParticipant.setMicrophoneEnabled(true); } catch { }
    } finally {
      setConnBusy(false);
    }
  }, [room, wsUrl, livekitCtx?.roomName, user, connBusy]);

  const disconnectRoom = React.useCallback(async () => {
    if (!room) return;
    try { await room.disconnect(); } catch { }
  }, [room]);

  const sendCanvasAgentPrompt = React.useCallback(
    async (message: string) => {
      const roomName = livekitCtx?.roomName || room?.name || '';
      if (!roomName) {
        throw new Error('Cannot dispatch to canvas steward without a LiveKit room name');
      }
      const requestId =
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : Math.random().toString(36).slice(2);
      try {
        console.debug('[Transcript] Canvas steward prompt', {
          room: roomName,
          requestId,
        });
        if (typeof window !== 'undefined') {
          const globalWindow = window as unknown as Record<string, unknown>;
          globalWindow.__lastCanvasAgentPrompt = {
            room: roomName,
            requestId,
            message,
            timestamp: Date.now(),
          };
        }
      } catch { }
      const res = await fetchWithSupabaseAuth('/api/steward/runCanvas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          room: roomName,
          task: 'canvas.agent_prompt',
          params: {
            room: roomName,
            message,
            requestId,
          },
        }),
      });
      if (!res.ok) {
        const detail = await res.text();
        throw new Error(`Canvas steward prompt failed (${res.status}): ${detail}`);
      }
    },
    [livekitCtx?.roomName, room],
  );

  const runSlashCommand = React.useCallback(
    async (command: string, body: string) => {
      switch (command) {
        case 'canvas':
          await sendCanvasAgentPrompt(body);
          return;
        default:
          throw new Error(`Unsupported slash command: /${command}`);
      }
    },
    [sendCanvasAgentPrompt],
  );

  // Track agent presence from store transcripts
  React.useEffect(() => {
    const hasAgent = storeTranscripts.some(t => t.speaker === 'voice-agent');
    if (hasAgent) {
      try { setAgentPresent(true); } catch { }
    }
  }, [storeTranscripts, setAgentPresent]);

  // NOTE: Transcription data channel listening is now handled by TranscriptProvider
  // Local manual messages are also handled by the store via the replay event

  // Dev-only inspector for agent tool events (parity debugging)
  React.useEffect(() => {
    if (!showAgentEvents) return;
    const handleActions = (event: Event) => {
      const detail = (event as CustomEvent).detail as any;
      if (!detail) return;
      const first =
        Array.isArray(detail.actions) && detail.actions.length > 0 ? detail.actions[0] : undefined;
      const summarizeAction = (action: any): { name?: string; preview?: string } | undefined => {
        if (!action) return undefined;
        const name = action.name || action._type || 'unknown';
        const params = action.params || action;
        const parts: string[] = [];
        if (params.id) parts.push(`id:${params.id}`);
        if (Array.isArray(params.ids)) parts.push(`ids:${params.ids.join(',')}`);
        if (params.text) parts.push(`text:${String(params.text).slice(0, 80)}`);
        if (params.axis) parts.push(`axis:${params.axis}`);
        if (params.direction) parts.push(`dir:${params.direction}`);
        return { name, preview: parts.join(' · ') };
      };
      const names: string[] =
        Array.isArray(detail.actions) && detail.actions.length > 0
          ? detail.actions.map((a: any) => String(a?.name || a?._type || 'unknown'))
          : [];
      const verbCounts = names.reduce((acc: Record<string, number>, name) => {
        acc[name] = (acc[name] || 0) + 1;
        return acc;
      }, {});
      setAgentEvents((prev) => {
        const next = [
          {
            ts: Date.now(),
            kind: 'action' as const,
            sessionId: detail.sessionId,
            seq: detail.seq,
            actionCount: Array.isArray(detail.actions) ? detail.actions.length : undefined,
            verbCounts,
            firstAction: summarizeAction(first),
            raw: detail,
          },
          ...prev,
        ].slice(0, 50);
        return next;
      });
    };
    const handleStatus = (event: Event) => {
      const detail = (event as CustomEvent).detail as any;
      if (!detail) return;
      setAgentEvents((prev) => [
        {
          ts: Date.now(),
          kind: 'status' as const,
          sessionId: detail.sessionId,
          status: typeof detail.state === 'string' ? detail.state : undefined,
          traceId: typeof detail.traceId === 'string' ? detail.traceId : undefined,
          intentId: typeof detail.intentId === 'string' ? detail.intentId : undefined,
          requestId: typeof detail.requestId === 'string' ? detail.requestId : undefined,
          raw: detail,
        },
        ...prev,
      ].slice(0, 50));
    };
    const handleTrace = (event: Event) => {
      const detail = (event as CustomEvent).detail as any;
      if (!detail) return;
      setAgentEvents((prev) => [
        {
          ts: Date.now(),
          kind: 'trace' as const,
          sessionId: detail.sessionId,
          seq: typeof detail.seq === 'number' ? detail.seq : undefined,
          actionCount: typeof detail.actionCount === 'number' ? detail.actionCount : undefined,
          traceStep: typeof detail.step === 'string' ? detail.step : undefined,
          traceId: typeof detail.traceId === 'string' ? detail.traceId : undefined,
          intentId: typeof detail.intentId === 'string' ? detail.intentId : undefined,
          requestId: typeof detail.requestId === 'string' ? detail.requestId : undefined,
          raw: detail,
        },
        ...prev,
      ].slice(0, 50));
    };
    window.addEventListener('present:agent_actions', handleActions as EventListener);
    window.addEventListener('present:agent_status', handleStatus as EventListener);
    window.addEventListener('present:agent_trace', handleTrace as EventListener);
    return () => {
      window.removeEventListener('present:agent_actions', handleActions as EventListener);
      window.removeEventListener('present:agent_status', handleStatus as EventListener);
      window.removeEventListener('present:agent_trace', handleTrace as EventListener);
    };
  }, [showAgentEvents]);

  // Hydrate transcript store from Supabase session
  React.useEffect(() => {
    if (!Array.isArray(sessionTranscript) || sessionTranscript.length === 0) return;
    const storeFormat: StoreTranscript[] = sessionTranscript.map((t, index) => ({
      id: (t as any).eventId || `${t.participantId || 'Unknown'}-${Number(t.timestamp)}-${index}`,
      speaker: (t as any).participantName || t.participantId || 'Unknown',
      text: t.text,
      timestamp: Number(t.timestamp),
      isFinal: true,
      source: (t.participantId === 'voice-agent' ? 'agent' : 'user') as 'agent' | 'user',
      type: 'speech' as const,
    }));
    batchAddTranscripts(storeFormat);
  }, [sessionTranscript, batchAddTranscripts]);

  // When canvas id changes, clear local transcript immediately to avoid showing stale lines
  React.useEffect(() => {
    const clearOnCanvasChange = () => clearTranscriptions();
    if (typeof window !== 'undefined') {
      window.addEventListener('present:canvas-id-changed', clearOnCanvasChange);
    }
    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('present:canvas-id-changed', clearOnCanvasChange);
      }
    };
  }, []);

  // Listen for custom component creation - register with new system
  const handlecustomComponent = React.useCallback(
    (event: CustomEvent) => {
      const detail = event.detail as {
        messageId?: string;
      };
      const messageId = typeof detail?.messageId === 'string' ? detail.messageId : 'unknown-component';
      const systemCall = {
        id: `system-${Date.now()}-${Math.random()}`,
        speaker: 'voice-agent',
        text: `Generated component: ${messageId || 'Unknown component'}`,
        timestamp: Date.now(),
        isFinal: true,
        source: 'system' as const,
        type: 'system_call' as const,
      };

      setSystemCalls((prev) => [...prev, systemCall]);
      window.requestAnimationFrame(() => refreshCanvasComponents());
    },
    [refreshCanvasComponents],
  );

  React.useEffect(() => {
    window.addEventListener('custom:showComponent', handlecustomComponent as EventListener);

    return () => {
      window.removeEventListener('custom:showComponent', handlecustomComponent as EventListener);
    };
  }, [handlecustomComponent]);

  // Auto-scroll transcript when new entries are added
  React.useEffect(() => {
    if (transcriptContainerRef.current) {
      transcriptContainerRef.current.scrollTop = transcriptContainerRef.current.scrollHeight;
    }
  }, [transcriptions]);

  // Clear transcriptions (both store and local system calls)
  const clearTranscriptions = React.useCallback(() => {
    storeClearTranscripts();
    setSystemCalls([]);
  }, [storeClearTranscripts]);

  const handleThreadChange = React.useCallback((newThreadId?: string) => {
    // Keep canvases and transcript in sync with selected thread
    try {
      if (!newThreadId) return;
      // Update URL param id to match the canvas associated with this thread (if any)
      // We store conversation_key on canvases; look it up and navigate.
      (async () => {
        try {
          const { data, error } = await supabase
            .from('canvases')
            .select('id')
            .eq('conversation_key', newThreadId)
            .limit(1)
            .maybeSingle();
          if (!error && data?.id) {
            const url = new URL(window.location.href);
            url.searchParams.set('id', data.id);
            window.history.replaceState({}, '', url.toString());
            try {
              localStorage.setItem('present:lastCanvasId', data.id);
            } catch { }
            // Trigger a lightweight refresh for transcript hook by dispatching an event
            window.dispatchEvent(new Event('present:canvas-id-changed'));
          } else {
            // Create a new canvas pre-linked to this thread to avoid overwriting current canvas
            const snapshot = (window as any)?.__present?.tldrawEditor?.getSnapshot?.() || null;
            const name = `Canvas ${new Date().toLocaleString()}`;
            const payload: any = {
              name,
              description: null,
              document: snapshot,
              conversationKey: newThreadId,
            };
            const res = await fetch('/api/canvas', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
            });
            if (res.ok) {
              const { canvas } = await res.json();
              if (canvas?.id) {
                const url = new URL(window.location.href);
                url.searchParams.set('id', canvas.id);
                window.history.replaceState({}, '', url.toString());
                try {
                  localStorage.setItem('present:lastCanvasId', canvas.id);
                } catch { }
                window.dispatchEvent(new Event('present:canvas-id-changed'));
              }
            }
          }
        } catch { }
      })();
    } catch { }
  }, []);

  // Conversations and suggestions removed; this panel focuses on Transcript only

  // Format timestamp for display
  const formatTime = (timestamp: number) => {
    return new Date(timestamp).toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  const formatDurationLabel = React.useCallback((seconds: number) => {
    if (!Number.isFinite(seconds)) return 'n/a';
    const clamped = Math.max(0, Math.round(seconds));
    const minutes = Math.floor(clamped / 60);
    const secs = clamped % 60;
    if (minutes && secs) return `${minutes}m ${secs}s`;
    if (minutes) return `${minutes}m`;
    return `${secs}s`;
  }, []);

  const renderComponentPreview = React.useCallback(
    (entry: CanvasComponentEntry) => {
      const state = entry.state || {};
      const coerceNumber = (value: unknown): number | undefined =>
        typeof value === 'number' && Number.isFinite(value) ? value : undefined;
      const configuredDuration =
        coerceNumber((state as any).configuredDuration) ??
        coerceNumber((state as any).durationSeconds) ??
        (() => {
          const minutes = coerceNumber((state as any).initialMinutes) ?? 5;
          const seconds = coerceNumber((state as any).initialSeconds) ?? 0;
          return Math.max(1, Math.round(minutes * 60 + seconds));
        })();
      const timeLeft =
        coerceNumber((state as any).timeLeft) ??
        coerceNumber((state as any).remainingSeconds) ??
        configuredDuration;
      const clamped = Math.max(0, Math.round(timeLeft));
      const minutes = Math.floor(clamped / 60);
      const secs = clamped % 60;
      const formattedTime = `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
      const statusLabel =
        (state as any).isRunning === true
          ? 'Running'
          : (state as any).isFinished === true
            ? 'Finished'
            : 'Paused';

      switch (entry.componentType) {
        case 'RetroTimerEnhanced': {
          return (
            <div className="p-3 space-y-2">
              <div className="text-sm font-semibold">{entry.title}</div>
              <div className="text-3xl font-mono tracking-tight">{formattedTime}</div>
              <div className="text-xs text-muted-foreground">
                {statusLabel} · Configured {formatDurationLabel(configuredDuration)}
              </div>
            </div>
          );
        }
        default:
          return (
            <pre className="p-3 text-[11px] leading-snug whitespace-pre-wrap break-words bg-muted/40 rounded">
              {JSON.stringify(state, null, 2)}
            </pre>
          );
      }
    },
    [formatDurationLabel],
  );

  React.useEffect(() => {
    if (onTranscriptChange && transcriptions.length > 0) {
      onTranscriptChange(transcriptions);
    }
  }, [transcriptions, onTranscriptChange]);

  // Note: Component list requests are now handled directly by ComponentRegistry
  // Old bus-based system removed in favor of direct tool access

  return (
    <div
      ref={ref}
      data-present-transcript-panel="true"
      data-state={typeof isOpen === 'boolean' ? (isOpen ? 'open' : 'closed') : undefined}
      className={cn(
        'bg-surface-elevated border-l border-default shadow-lg h-full overflow-hidden flex flex-col',
        className,
      )}
      {...restProps}
    >
      <div className="h-full flex flex-col overscroll-contain">
        {/* Header with title and close button */}
        <div className="flex items-center justify-between p-4 border-b border-default safe-top">
          <div className="flex items-center gap-2">
            <span className="font-medium text-primary">Transcript</span>
            <ThreadDropdown contextKey={effectiveContextKey} onThreadChange={handleThreadChange} />
          </div>
          <Button aria-label="Close" variant="secondary" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>

        {/* Transcript Content */}
        <>
          {/* Transcript Content */}
          <ScrollableMessageContainer className="flex-1 p-4" ref={transcriptContainerRef}>
            <div className="space-y-2">
              {(() => {
                const noActivity = canvasComponents.length === 0 && transcriptions.length === 0;
                if (noActivity) {
                  return (
                    <div className="text-center text-muted-foreground py-8">
                      <FileText className="h-8 w-8 mx-auto mb-2 opacity-50" />
                      <p>No activity yet</p>
                      <p className="text-sm mt-1">
                        Voice conversations and components will appear here
                      </p>
                    </div>
                  );
                }
                return (
                  <>
                    {showAgentEvents && agentEvents.length > 0 && (
                      <div className="mb-3 rounded border bg-amber-50 border-amber-200 px-3 py-2 text-xs text-amber-900">
                        <div className="font-semibold mb-1">Agent Console (dev · debugAgent=1)</div>
                        <div className="space-y-1 max-h-60 overflow-auto">
                          {agentEvents.map((e, idx) => (
                            <details
                              key={`${e.ts}-${idx}`}
                              className="border-b border-amber-100 pb-1 last:border-b-0"
                            >
                              <summary className="flex items-center justify-between cursor-pointer">
                                <span className="font-mono">
                                  {new Date(e.ts).toLocaleTimeString('en-US', { hour12: false })}
                                </span>
                                <span className="flex items-center gap-2">
                                  {e.kind && <span className="uppercase tracking-wide text-[10px]">{e.kind}</span>}
                                  {e.status && <span>{e.status}</span>}
                                  {e.traceStep && <span>{e.traceStep}</span>}
                                  {typeof e.seq === 'number' && <span>seq {e.seq}</span>}
                                  {e.actionCount !== undefined && <span>{e.actionCount} actions</span>}
                                </span>
                              </summary>
                              {e.firstAction && (
                                <div className="text-[11px] mt-0.5">
                                  {e.firstAction.name} · {e.firstAction.preview || 'preview n/a'}
                                </div>
                              )}
                              {e.verbCounts && (
                                <div className="text-[11px] mt-0.5">
                                  {Object.entries(e.verbCounts)
                                    .map(([k, v]) => `${k}:${v}`)
                                    .join(', ')}
                                </div>
                              )}
                              {(e.traceId || e.intentId || e.requestId) && (
                                <div className="text-[11px] mt-0.5">
                                  {e.traceId ? `trace:${e.traceId}` : ''}
                                  {e.traceId && e.intentId ? ' · ' : ''}
                                  {e.intentId ? `intent:${e.intentId}` : ''}
                                  {(e.traceId || e.intentId) && e.requestId ? ' · ' : ''}
                                  {e.requestId ? `request:${e.requestId}` : ''}
                                </div>
                              )}
                              {e.raw && (
                                <pre className="mt-1 whitespace-pre-wrap break-words bg-white/70 rounded p-2 text-[11px] text-amber-900 border border-amber-100">
                                  {JSON.stringify(e.raw, null, 2)}
                                </pre>
                              )}
                            </details>
                          ))}
                        </div>
                      </div>
                    )}
                    {showAgentEvents && agentEvents.length === 0 && (
                      <div className="mb-3 rounded border bg-amber-50 border-amber-200 px-3 py-2 text-xs text-amber-900">
                        <div className="font-semibold">Agent Console (dev · debugAgent=1)</div>
                        <div className="text-[11px] mt-1">Waiting for agent actions/status…</div>
                      </div>
                    )}
                    {canvasComponents.map((entry) => (
                      <div
                        key={entry.messageId}
                        className="mb-4 p-3 rounded-lg border bg-discovery-surface border-discovery-surface"
                      >
                        <div className="text-xs text-discovery mb-2">
                          Component: {entry.messageId} · {entry.componentType}
                        </div>
                        <div className="bg-surface rounded-lg border border-default overflow-hidden">
                          {renderComponentPreview(entry)}
                          {typeof entry.updatedAt === 'number' && Number.isFinite(entry.updatedAt) && (
                            <div className="px-3 pb-3 text-[10px] text-muted-foreground">
                              Updated {formatTime(entry.updatedAt)}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                    {transcriptions.map((transcription) => (
                      <div
                        key={transcription.id}
                        className={cn(
                          'p-3 rounded-lg border transition-opacity',
                          transcription.source === 'agent'
                            ? 'bg-info-surface border-info-surface'
                            : transcription.source === 'system'
                              ? 'bg-discovery-surface border-discovery-surface'
                              : 'bg-surface-secondary border-default',
                          !transcription.isFinal && 'opacity-60 italic',
                        )}
                      >
                        <div className="flex items-center justify-between text-xs mb-1">
                          <span className="font-medium">
                            {transcription.speaker}
                            {transcription.type === 'system_call' && ' → custom System'}
                          </span>
                          <div className="flex items-center gap-2 text-muted-foreground">
                            {!transcription.isFinal && <span>(interim)</span>}
                            <span>{formatTime(transcription.timestamp)}</span>
                          </div>
                        </div>
                        <div className="text-sm">{transcription.text}</div>
                      </div>
                    ))}
                  </>
                );
              })()}
            </div>
          </ScrollableMessageContainer>

          {/* Manual text input for sending messages to the LiveKit agent */}
          <div className="p-4 border-t border-default">
            {(() => {
              const isRoomConnected = room?.state === 'connected';
              const trimmedMessage = typedMessage.trim();
              const inputDisabled = isSending;
              const sendDisabled =
                isSending ||
                !trimmedMessage ||
                (isRecognizedSlashCommand ? slashCommandBodyMissing : !isRoomConnected && !mentionMatchesCanvasAgent);
              return (
                <form
                  data-debug-source="messaging-message-form"
                  onSubmit={async (event) => {
                    event.preventDefault();
                    const trimmed = typedMessage.trim();
                    if (!trimmed || isSending) return;
                    const parsedCommand = parseSlashCommand(trimmed);
                    const slashActive = Boolean(
                      parsedCommand && SUPPORTED_SLASH_COMMANDS.has(parsedCommand.command),
                    );
                    const mentionActive = Boolean(!slashActive && mentionMatchesCanvasAgent);
                    if (slashActive && !parsedCommand?.body) {
                      try {
                        console.warn('[Transcript] Slash command requires a message body', parsedCommand);
                      } catch { }
                      return;
                    }
                    setIsSending(true);

                    const speaker =
                      user?.user_metadata?.full_name ||
                      user?.user_metadata?.name ||
                      user?.email ||
                      room?.localParticipant?.identity ||
                      'Canvas-User';
                    const participantId =
                      room?.localParticipant?.identity || user?.id || speaker || 'unknown';
                    const eventId =
                      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
                        ? crypto.randomUUID()
                        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

                    const mentionBody = mentionActive
                      ? trimmed.replace(/@canvas-agent/gi, '').trim() || trimmed
                      : trimmed;
                    const textForDispatch = slashActive && parsedCommand ? parsedCommand.body : mentionBody;

                    const payload = {
                      type: 'live_transcription',
                      event_id: eventId,
                      text: textForDispatch,
                      speaker,
                      participantId,
                      participantName: speaker,
                      timestamp: Date.now(),
                      is_final: true,
                      manual: true,
                    } satisfies LiveTranscriptionPayload;

                    let completed = false;

                    try {
                      if (slashActive && parsedCommand) {
                        await runSlashCommand(parsedCommand.command, parsedCommand.body);
                      } else if (mentionActive) {
                        await sendCanvasAgentPrompt(textForDispatch);
                      } else {
                        bus.send('transcription', payload);
                      }

                      try {
                        window.dispatchEvent(
                          new CustomEvent('livekit:transcription-replay', {
                            detail: {
                              speaker,
                              text: textForDispatch,
                              timestamp: Date.now(),
                            },
                          }),
                        );
                      } catch { }

                      try {
                        window.dispatchEvent(
                          new CustomEvent('custom:transcription-local', {
                            detail: payload,
                          }),
                        );
                      } catch { }

                      completed = true;
                    } catch (error) {
                      console.error('[Transcript] Failed to send agent prompt', error);
                    } finally {
                      if (completed) {
                        setTypedMessage('');
                        setTimeout(() => {
                          if (transcriptContainerRef.current) {
                            transcriptContainerRef.current.scrollTop =
                              transcriptContainerRef.current.scrollHeight;
                          }
                        }, 10);
                      }
                      setIsSending(false);
                    }
                  }}
                  className="flex items-center gap-2"
                >
                  <input
                    type="text"
                    value={typedMessage}
                    onChange={(e) => setTypedMessage(e.target.value)}
                    placeholder={
                      isRecognizedSlashCommand
                        ? 'Dispatching directly to the Canvas steward…'
                        : room?.state === 'connected'
                          ? 'Type a message for the agent…'
                          : 'Connecting to LiveKit…'
                    }
                    className="flex-1 px-3 py-2 rounded-lg border border-default bg-surface text-primary outline-none focus-visible:ring-2 focus-visible:ring-[var(--present-accent-ring)]"
                    aria-label="Type a message for the agent"
                    disabled={inputDisabled}
                  />
                  <Button
                    type="submit"
                    disabled={sendDisabled}
                    size="sm"
                    loading={isSending}
                  >
                    Send
                  </Button>
                </form>
              );
            })()}
            <div className="text-[11px] text-muted-foreground mt-1 flex items-center gap-2 flex-wrap">
              <span>
                {isRecognizedSlashCommand
                  ? 'Slash command active — prompt dispatches directly to the Canvas steward.'
                  : mentionMatchesCanvasAgent
                    ? '“@canvas-agent” detected — prompt dispatches directly to the Canvas steward.'
                    : agentPresent
                      ? 'Sends as “you” over LiveKit to the voice agent.'
                      : 'Agent not joined'}
              </span>
              {!agentPresent && !isRecognizedSlashCommand && (
                <button
                  className="underline disabled:opacity-50"
                  disabled={agentJoining || room?.state !== 'connected'}
                  onClick={async () => {
                    if (!livekitCtx?.roomName || room?.state !== 'connected') return;
                    setAgentJoining(true);
                    try {
                      await fetch('/api/agent/dispatch', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ roomName: livekitCtx.roomName }),
                      });
                    } finally {
                      // We'll flip to enabled when presence updates via room events
                      setTimeout(() => setAgentJoining(false), 1500);
                    }
                  }}
                >
                  {agentJoining ? 'Requesting agent…' : 'Request agent'}
                </button>
              )}
              {!isRecognizedSlashCommand && (
                <span className="opacity-80">Use `/canvas …` to message the Canvas steward directly.</span>
              )}
            </div>
          </div>

          {/* Transcript Footer: connection + tools */}
          <div className="p-3 border-t border-default">
            <div className="flex items-center justify-between text-[11px] text-muted-foreground gap-2">
              <div className="flex items-center gap-2 overflow-hidden">
                <span
                  className={cn(
                    'inline-block h-2 w-2 rounded-full',
                    room?.state === 'connected'
                      ? 'bg-success-solid'
                      : room?.state === 'connecting'
                        ? 'bg-warning-solid'
                        : 'bg-border',
                  )}
                />
                <span className="truncate">{room?.state === 'connected' ? 'Connected' : room?.state === 'connecting' ? 'Connecting…' : 'Disconnected'}</span>
                {livekitCtx?.roomName && (
                  <span className="font-mono truncate max-w-[140px]">{livekitCtx.roomName}</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  onClick={room?.state === 'connected' ? disconnectRoom : connectRoom}
                  disabled={connBusy}
                  variant="outline"
                  size="sm"
                >
                  {room?.state === 'connected' ? 'Disconnect' : 'Connect'}
                </Button>
                <Button
                  onClick={() => {
                    try {
                      const id = new URL(window.location.href).searchParams.get('id');
                      const link = `${window.location.origin}/canvas${id ? `?id=${encodeURIComponent(id)}` : ''}`;
                      navigator.clipboard.writeText(link);
                    } catch { }
                  }}
                  variant="outline"
                  size="sm"
                >
                  Copy Link
                </Button>
                {transcriptions.length > 0 && (
                  <Button onClick={clearTranscriptions} variant="ghost" size="sm">
                    Clear
                  </Button>
                )}
              </div>
            </div>
          </div>
        </>
      </div>
    </div>
  );
});
MessageThreadCollapsible.displayName = 'MessageThreadCollapsible';
