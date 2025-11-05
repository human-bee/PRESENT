'use client';

import type { messageVariants } from '@/components/ui/messaging/message';
import { ThreadDropdown } from '@/components/ui/messaging/thread-dropdown';
import { ScrollableMessageContainer } from '@/components/ui/messaging/scrollable-message-container';
import { cn } from '@/lib/utils';
import { FileText } from 'lucide-react';
import * as React from 'react';
import { components as customComponents } from '@/lib/custom';
import { type VariantProps } from 'class-variance-authority';
import { useRoomContext } from '@livekit/components-react';
import { RoomEvent } from 'livekit-client';
import { createLiveKitBus } from '../../lib/livekit/livekit-bus';
import { useContextKey } from '@/components/RoomScopedProviders';
import { useRealtimeSessionTranscript } from '@/hooks/use-realtime-session-transcript';
import { supabase } from '@/lib/supabase';
import { CanvasLiveKitContext } from './livekit/livekit-room-connector';
import { useAuth } from '@/hooks/use-auth';

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
}

const SUPPORTED_SLASH_COMMANDS = new Set(['canvas']);

type ParsedSlashCommand = {
  command: string;
  body: string;
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
>(({ className, contextKey, onTranscriptChange, onClose, ...props }, ref) => {
  // Conversations tab removed; Transcript is the only view
  const [componentStore, setComponentStore] = React.useState(
    new Map<string, { component: React.ReactNode; contextKey: string }>(),
  );
  const [transcriptions, setTranscriptions] = React.useState<
    Array<{
      id: string;
      speaker: string;
      text: string;
      timestamp: number;
      isFinal: boolean;
      source: 'agent' | 'user' | 'system';
      type?: 'speech' | 'system_call';
    }>
  >([]);

  // Ref for auto-scroll
  const transcriptContainerRef = React.useRef<HTMLDivElement>(null);

  // LiveKit room context and bus for transcript functionality
  const room = useRoomContext();
  const bus = createLiveKitBus(room);
  const roomContextKey = useContextKey();
  const effectiveContextKey = contextKey || roomContextKey;
  const livekitCtx = React.useContext(CanvasLiveKitContext);
  const { transcript: sessionTranscript } = useRealtimeSessionTranscript(livekitCtx?.roomName);
  const { user } = useAuth();

  // Local text input state for sending manual messages to the agent from Transcript tab
  const [typedMessage, setTypedMessage] = React.useState<string>('');
  const [isSending, setIsSending] = React.useState<boolean>(false);
  const [connBusy, setConnBusy] = React.useState<boolean>(false);
  const slashCommand = React.useMemo(() => parseSlashCommand(typedMessage), [typedMessage]);
  const isRecognizedSlashCommand = Boolean(
    slashCommand && SUPPORTED_SLASH_COMMANDS.has(slashCommand.command),
  );
  const slashCommandBodyMissing = Boolean(isRecognizedSlashCommand && !slashCommand?.body);
  const trimmedTypedMessage = typedMessage.trim();
  const isRoomConnected = room?.state === 'connected';
  const inputDisabled = isSending || (!isRecognizedSlashCommand && !isRoomConnected);
  const sendDisabled =
    isSending ||
    !trimmedTypedMessage ||
    (!isRecognizedSlashCommand && !isRoomConnected) ||
    (isRecognizedSlashCommand && slashCommandBodyMissing);

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
        process.env.NEXT_PUBLIC_LK_TOKEN_ENDPOINT || '/api/token';
      // Build absolute URL to avoid basePath/iframe pitfalls
      const base = typeof window !== 'undefined' ? window.location.origin : '';
      const tokenUrl = new URL(tokenEndpoint, base);
      tokenUrl.searchParams.set('roomName', livekitCtx.roomName);
      tokenUrl.searchParams.set('identity', identity!);
      tokenUrl.searchParams.set('name', user?.user_metadata?.full_name || 'Canvas User');

      let data: any | null = null;
      try {
        const res = await fetch(tokenUrl.toString(), { cache: 'no-store' });
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
      } catch {}
      try { await room.localParticipant.setMicrophoneEnabled(true); } catch {}
    } finally {
      setConnBusy(false);
    }
  }, [room, wsUrl, livekitCtx?.roomName, user, connBusy]);

  const disconnectRoom = React.useCallback(async () => {
    if (!room) return;
    try { await room.disconnect(); } catch {}
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
        if (process.env.NEXT_PUBLIC_TOOL_DISPATCHER_LOGS === 'true') console.debug('[Transcript] Canvas steward prompt', {
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
      } catch {}
      const res = await fetch('/api/steward/runCanvas', {
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

  const ingestTranscription = React.useCallback(
    (transcriptionData: {
      speaker?: string;
      text?: string;
      timestamp?: number;
      is_final?: boolean;
    }) => {
      if (!transcriptionData.text) return;
      if (transcriptionData.speaker === 'voice-agent') {
        try { setAgentPresent(true); } catch {}
      }
      const transcription = {
        id: `${Date.now()}-${Math.random()}`,
        speaker: transcriptionData.speaker || 'Unknown',
        text: transcriptionData.text,
        timestamp: transcriptionData.timestamp || Date.now(),
        isFinal: transcriptionData.is_final || false,
        source: (transcriptionData.speaker === 'voice-agent' ? 'agent' : 'user') as 'agent' | 'user',
        type: 'speech' as const,
      };

      setTranscriptions((prev) => {
        if (transcription.isFinal) {
          const filtered = prev.filter(
            (t) => !(t.speaker === transcription.speaker && !t.isFinal && t.type === 'speech'),
          );
          return [...filtered, transcription];
        }
        const filtered = prev.filter(
          (t) => !(t.speaker === transcription.speaker && !t.isFinal && t.type === 'speech'),
        );
        return [...filtered, transcription];
      });

      try {
        window.dispatchEvent(
          new CustomEvent('livekit:transcription-replay', {
            detail: {
              speaker: transcription.speaker,
              text: transcription.text,
              timestamp: transcription.timestamp,
            },
          }),
        );
      } catch {}
    },
    [setAgentPresent, setTranscriptions],
  );

  // Listen for transcription data via bus
  React.useEffect(() => {
    const off = bus.on('transcription', (data: unknown) => {
      const transcriptionData = data as {
        type?: string;
        speaker?: string;
        text?: string;
        timestamp?: number;
        is_final?: boolean;
      };
      if (transcriptionData.type === 'live_transcription') {
        ingestTranscription(transcriptionData);
      }
    });
    return off;
  }, [bus, ingestTranscription]);

  // Local manual messages do not echo back over LiveKit; mirror them here
  React.useEffect(() => {
    const handler = (event: Event) => {
      const payload = (event as CustomEvent).detail;
      if (!payload || typeof payload.text !== 'string') return;
      const transcriptionData = {
        type: 'live_transcription',
        speaker: payload.participantId || payload.speaker || 'Canvas-User',
        text: payload.text,
        timestamp: typeof payload.timestamp === 'number' ? payload.timestamp : Date.now(),
        is_final: true,
        manual: true,
      } as const;
      ingestTranscription(transcriptionData);
    };
    window.addEventListener('custom:transcription-local', handler as EventListener);
    return () => window.removeEventListener('custom:transcription-local', handler as EventListener);
  }, [ingestTranscription]);

  // Keep transcript tab mirrored to Supabase session
  React.useEffect(() => {
    if (!Array.isArray(sessionTranscript)) return;
    const nextList = sessionTranscript.map((t) => ({
      id: `${t.participantId}-${Number(t.timestamp)}`,
      speaker: t.participantId || 'Unknown',
      text: t.text,
      timestamp: Number(t.timestamp),
      isFinal: true,
      source: t.participantId === 'voice-agent' ? 'agent' : 'user',
      type: 'speech' as const,
    }));
    setTranscriptions((prev) => {
      if (
        prev.length === nextList.length &&
        prev.length > 0 &&
        prev[prev.length - 1]?.id === nextList[nextList.length - 1]?.id
      ) {
        return prev;
      }
      return nextList;
    });
  }, [sessionTranscript]);

  // When canvas id changes, clear local transcript immediately to avoid showing stale lines
  React.useEffect(() => {
    const clearOnCanvasChange = () => setTranscriptions([]);
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
      const { messageId, component } = event.detail as {
        messageId: string;
        component: unknown;
      };

      // Normalize component: ensure it's a valid React element if possible
      let normalized: React.ReactNode = component as React.ReactNode;
      if (!React.isValidElement(normalized)) {
        const maybe = component as {
          type?: string;
          props?: Record<string, unknown>;
        };
        if (maybe && typeof maybe === 'object' && typeof maybe.type === 'string') {
          const compDef = customComponents.find((c) => c.name === maybe.type);
          if (compDef) {
            try {
              normalized = React.createElement(compDef.component as any, {
                __custom_message_id: messageId,
                ...(maybe.props || {}),
              });
            } catch {
              // keep fallback
            }
          }
        }
      }

      // If still not a valid element, use a safe fallback instead of crashing
      if (!React.isValidElement(normalized)) {
        normalized = (
          <div className="p-3 text-xs bg-red-50 border border-red-200 text-red-700 rounded">
            Unsupported component payload. Please check registry and event format.
          </div>
        );
      }

      // Store the component for this thread/context (for transcript display)
      setComponentStore((prev) => {
        const updated = new Map(prev);
        updated.set(messageId, {
          component: normalized,
          contextKey: effectiveContextKey || 'default',
        });
        return updated;
      });

      // Also add system call to transcript
      const systemCall = {
        id: `system-${Date.now()}-${Math.random()}`,
        speaker: 'voice-agent',
        text: `Generated component: ${messageId || 'Unknown component'}`,
        timestamp: Date.now(),
        isFinal: true,
        source: 'system' as const,
        type: 'system_call' as const,
      };

      setTranscriptions((prev) => [...prev, systemCall]);
    },
    [effectiveContextKey],
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

  // Clear transcriptions
  const clearTranscriptions = React.useCallback(() => {
    setTranscriptions([]);
  }, []);

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
      className={cn(
        'bg-background border-l border-gray-200 shadow-lg h-full overflow-hidden flex flex-col',
        className,
      )}
      {...props}
    >
      <div className="h-full flex flex-col overscroll-contain">
        {/* Header with title and close button */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200 safe-top">
          <div className="flex items-center gap-2">
            <span className="font-medium">Transcript</span>
            <ThreadDropdown contextKey={effectiveContextKey} onThreadChange={handleThreadChange} />
          </div>
          <button
            aria-label="Close"
            className="px-2 py-1 rounded bg-accent hover:bg-muted text-foreground"
            onClick={onClose}
          >
            Close
          </button>
        </div>

        {/* Transcript Content */}
        <>
            {/* Transcript Content */}
            <ScrollableMessageContainer className="flex-1 p-4" ref={transcriptContainerRef}>
              <div className="space-y-2">
                {/* Filter components for current context */}
                {(() => {
                  const contextComponents = Array.from(componentStore.entries()).filter(
                    ([, data]) => data.contextKey === effectiveContextKey,
                  );

                  return contextComponents.length === 0 && transcriptions.length === 0 ? (
                    <div className="text-center text-muted-foreground py-8">
                      <FileText className="h-8 w-8 mx-auto mb-2 opacity-50" />
                      <p>No activity yet</p>
                      <p className="text-sm mt-1">
                        Voice conversations and components will appear here
                      </p>
                    </div>
                  ) : (
                    <>
                      {/* Show generated components first */}
                      {contextComponents.map(([messageId, data]) => (
                        <div
                          key={messageId}
                          className="mb-4 p-3 rounded-lg border bg-purple-50 dark:bg-purple-900/20 border-purple-200 dark:border-purple-800"
                        >
                          <div className="text-xs text-purple-600 dark:text-purple-400 mb-2">
                            Component: {messageId}
                          </div>
                          <div className="bg-white dark:bg-gray-800 rounded border">
                            {React.isValidElement(data.component) ? (
                              data.component
                            ) : (
                              <div className="p-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded">
                                Invalid component payload
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                      {/* Then show transcriptions */}
                      {transcriptions.map((transcription) => (
                        <div
                          key={transcription.id}
                          className={cn(
                            'p-3 rounded-lg border transition-opacity',
                            transcription.source === 'agent'
                              ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800'
                              : transcription.source === 'system'
                                ? 'bg-purple-50 dark:bg-purple-900/20 border-purple-200 dark:border-purple-800'
                                : 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800',
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
            <div className="p-4 border-t border-gray-200">
              <form
                data-debug-source="ui-message-form"
                onSubmit={async (event) => {
                  event.preventDefault();
                  const trimmed = typedMessage.trim();
                  if (!trimmed || isSending) return;
                  const parsedCommand = parseSlashCommand(trimmed);
                  const slashActive = Boolean(
                    parsedCommand && SUPPORTED_SLASH_COMMANDS.has(parsedCommand.command),
                  );
                  if (slashActive && !parsedCommand?.body) {
                    if (process.env.NEXT_PUBLIC_TOOL_DISPATCHER_LOGS === 'true') console.warn('[Transcript] Slash command requires a message body', parsedCommand);
                    return;
                  }
                  setIsSending(true);

                  const speaker =
                    room?.localParticipant?.identity ||
                    user?.user_metadata?.full_name ||
                    user?.user_metadata?.name ||
                    user?.email ||
                    'Canvas-User';

                  const textForDispatch = slashActive && parsedCommand ? parsedCommand.body : trimmed;

                  const payload = {
                    type: 'live_transcription',
                    text: textForDispatch,
                    speaker,
                    timestamp: Date.now(),
                    is_final: true,
                    manual: true,
                  } as const;

                  let completed = false;

                  try {
                    if (slashActive && parsedCommand) {
                      await runSlashCommand(parsedCommand.command, parsedCommand.body);
                    } else if (room?.state === 'connected') {
                      bus.send('transcription', payload);
                    } else {
                      if (process.env.NEXT_PUBLIC_TOOL_DISPATCHER_LOGS === 'true') console.warn('[Transcript] Room not connected; skipping send');
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
                    } catch {}

                    try {
                      window.dispatchEvent(
                        new CustomEvent('custom:transcription-local', {
                          detail: payload,
                        }),
                      );
                    } catch {}

                    completed = true;
                  } catch (error) {
                    if (process.env.NEXT_PUBLIC_TOOL_DISPATCHER_LOGS === 'true') console.error('[Transcript] Failed to send agent prompt', error);
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
                  onPaste={(e) => {
                    const text = e.clipboardData?.getData('text');
                    if (typeof text === 'string' && text.length > 0) {
                      e.preventDefault();
                      const target = e.currentTarget;
                      const { selectionStart, selectionEnd } = target;
                      const start = selectionStart ?? typedMessage.length;
                      const end = selectionEnd ?? typedMessage.length;
                      const nextValue = `${typedMessage.slice(0, start)}${text}${typedMessage.slice(end)}`;
                      setTypedMessage(nextValue);
                      // Manually trigger form validity updates so the send button re-evaluates immediately.
                      queueMicrotask(() => {
                        const event = new Event('input', { bubbles: true, cancelable: true });
                        target.dispatchEvent(event);
                      });
                    }
                  }}
                  placeholder={
                    isRecognizedSlashCommand
                      ? 'Dispatching directly to the Canvas steward…'
                      : room?.state === 'connected'
                        ? 'Type a message for the agent…'
                        : 'Connecting to LiveKit…'
                  }
                  className="flex-1 px-3 py-2 rounded border border-gray-300 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                  aria-label="Type a message for the agent"
                  disabled={inputDisabled}
                />
                <button
                  type="submit"
                  disabled={sendDisabled}
                  className={cn(
                    'px-3 py-2 rounded bg-primary text-primary-foreground disabled:opacity-50',
                  )}
                >
                  {isSending ? 'Sending…' : 'Send'}
                </button>
              </form>
              <div className="text-[11px] text-muted-foreground mt-1 flex items-center gap-2 flex-wrap">
                <span>
                  {isRecognizedSlashCommand
                    ? 'Slash command active — prompt dispatches directly to the Canvas steward.'
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
            <div className="p-3 border-t border-gray-200">
              <div className="flex items-center justify-between text-[11px] text-muted-foreground gap-2">
                <div className="flex items-center gap-2 overflow-hidden">
                  <span className={cn('inline-block h-2 w-2 rounded-full', room?.state === 'connected' ? 'bg-green-500' : room?.state === 'connecting' ? 'bg-yellow-500' : 'bg-gray-400')} />
                  <span className="truncate">{room?.state === 'connected' ? 'Connected' : room?.state === 'connecting' ? 'Connecting…' : 'Disconnected'}</span>
                  {livekitCtx?.roomName && (
                    <span className="font-mono truncate max-w-[140px]">{livekitCtx.roomName}</span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={room?.state === 'connected' ? disconnectRoom : connectRoom}
                    disabled={connBusy}
                    className="px-2 py-1 rounded border text-foreground hover:bg-muted disabled:opacity-50"
                  >
                    {room?.state === 'connected' ? 'Disconnect' : 'Connect'}
                  </button>
                  <button
                    onClick={() => {
                      try {
                        const id = new URL(window.location.href).searchParams.get('id');
                        const link = `${window.location.origin}/canvas${id ? `?id=${encodeURIComponent(id)}` : ''}`;
                        navigator.clipboard.writeText(link);
                      } catch {}
                    }}
                    className="px-2 py-1 rounded border hover:bg-muted"
                  >
                    Copy Link
                  </button>
                  {transcriptions.length > 0 && (
                    <button onClick={clearTranscriptions} className="px-2 py-1 rounded hover:bg-muted">
                      Clear
                    </button>
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
