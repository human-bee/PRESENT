'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { nanoid } from 'nanoid';
import type { Editor } from '@tldraw/tldraw';
import type { Room, Participant } from 'livekit-client';
import { useTldrawAgent } from '@/lib/tldraw-agent';
import { applyEnvelope } from '@/components/tool-dispatcher/handlers/tldraw-actions';
import { useViewportSelectionPublisher } from '@/components/ui/canvas/hooks/useViewportSelectionPublisher';
import { useScreenshotRequestHandler } from '@/components/ui/canvas/hooks/useScreenshotRequestHandler';
import { createLiveKitBus } from '@/lib/livekit/livekit-bus';
import { convertTldrawShapeToSimpleShape } from '@/lib/tldraw-agent/shared/format/convertTldrawShapeToSimpleShape';
import type { SimpleShape } from '@/lib/tldraw-agent/shared/format/SimpleShape';
import type { ContextItem } from '@/lib/tldraw-agent/shared/types/ContextItem';
import type { AgentInput } from '@/lib/tldraw-agent/shared/types/AgentInput';

interface CanvasAgentControllerProps {
  editor: Editor;
  room?: Room;
}

const isDevEnv = typeof process !== 'undefined' && process.env.NODE_ENV !== 'production';
const isClientAgentEnabled =
  typeof process === 'undefined'
    ? false
    : process.env.NEXT_PUBLIC_CANVAS_AGENT_CLIENT_ENABLED === 'true';
// The legacy DOM TLDraw agent is archived; this flag should only be true in emergencies.

const LOGS_ENABLED =
  typeof process !== 'undefined' && process.env.NEXT_PUBLIC_TOOL_DISPATCHER_LOGS === 'true';
const debugLog = (...args: Parameters<typeof console.log>) => {
  if (isDevEnv && LOGS_ENABLED) {
    console.log(...args);
  }
};

const debugWarn = (...args: Parameters<typeof console.warn>) => {
  if (isDevEnv && LOGS_ENABLED) {
    console.warn(...args);
  }
};

interface AgentHostState {
  isHost: boolean;
  hostId: string | null;
}

function useIsAgentHost(room?: Room) {
  const [hostState, setHostState] = useState<AgentHostState>({ isHost: false, hostId: null });

  useEffect(() => {
    if (!room) {
      setHostState({ isHost: false, hostId: null });
      return;
    }

    const getParticipantId = (participant: Participant | undefined) =>
      participant?.identity || participant?.sid || '';
    const isAgentParticipant = (participant: Participant | undefined) => {
      const flagged = Boolean((participant as any)?.isAgent || (participant as any)?.permissions?.agent);
      if (flagged) return true;
      const identity = String(participant?.identity || participant?.name || '').toLowerCase();
      if (!identity) return false;
      if (identity.startsWith('agent-')) return true;
      if (identity.includes('voice-agent')) return true;
      return false;
    };
    const getEligibleId = (participant: Participant | undefined) => {
      if (!participant || isAgentParticipant(participant)) return '';
      return getParticipantId(participant);
    };

    const recompute = () => {
      const localId = getEligibleId(room.localParticipant);
      if (!localId) {
        setHostState({ isHost: false, hostId: null });
        return;
      }

      const ids = [localId];
      room.remoteParticipants.forEach((participant) => {
        const id = getEligibleId(participant);
        if (id) ids.push(id);
      });

      ids.sort();
      setHostState({ isHost: ids[0] === localId, hostId: ids[0] ?? null });
    };

    recompute();

    const handleParticipantChange = () => recompute();
    room.on('participantConnected', handleParticipantChange);
    room.on('participantDisconnected', handleParticipantChange);
    room.on('connectionStateChanged', handleParticipantChange);

    return () => {
      room.off('participantConnected', handleParticipantChange);
      room.off('participantDisconnected', handleParticipantChange);
      room.off('connectionStateChanged', handleParticipantChange);
    };
  }, [room]);

  return hostState;
}

async function sendAgentTelemetry(event: 'agent_begin' | 'agent_end', payload: Record<string, unknown>) {
  try {
    await fetch('/api/agent/telemetry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event, payload }),
    });
  } catch (error) {
    debugWarn('[CanvasAgent] telemetry failed', error);
  }
}

export function CanvasAgentController({ editor, room }: CanvasAgentControllerProps) {
  const agent = useTldrawAgent(editor, 'present-canvas-agent');
  const { isHost, hostId } = useIsAgentHost(room);
  const bus = useMemo(() => (room ? createLiveKitBus(room) : null), [room]);

  const processedIdsRef = useRef<Set<string>>(new Set());
  const currentRequestRef = useRef<string | null>(null);
  const appliedActionIdsRef = useRef<Set<string>>(new Set());

  // Mount connectors regardless of client agent enablement
  useViewportSelectionPublisher(editor, room, true);
  useScreenshotRequestHandler(editor, room);

  useEffect(() => {
    if (!bus) return;

    const unsubscribe = bus.on('agent_prompt', (message: any) => {
      if (!message || message.type !== 'agent_prompt') return;
      try {
        debugLog('[AgentBridge] agent_prompt', message);
      } catch {}
      if (!isHost || !isClientAgentEnabled) {
        try {
          debugLog('[AgentBridge] ignoring agent_prompt (not host)');
        } catch {}
        return;
      }

      const { payload } = message as { payload?: any };
      const text: string | undefined = typeof payload?.message === 'string' ? payload.message.trim() : undefined;
      if (!text) return;

      const generateId = () => {
        if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
          return crypto.randomUUID();
        }
        return nanoid();
      };

      const requestId: string = typeof payload?.requestId === 'string' && payload.requestId ? payload.requestId : generateId();
      const seen = processedIdsRef.current;
      if (seen.has(requestId)) return;
      if (seen.size > 100) {
        const firstKey = seen.values().next().value;
        if (firstKey) {
          seen.delete(firstKey);
        }
      }
      seen.add(requestId);

      const boundsInput = payload?.bounds;
      const normalizedBounds =
        boundsInput && typeof boundsInput === 'object'
          ? {
              x: Number(boundsInput.x) || 0,
              y: Number(boundsInput.y) || 0,
              w: Number(boundsInput.w) || 0,
              h: Number(boundsInput.h) || 0,
            }
          : editor.getViewportPageBounds();

      const selectionIds: string[] | undefined = Array.isArray(payload?.selectionIds)
        ? payload.selectionIds.filter((id: unknown) => typeof id === 'string' && id.trim().length > 0)
        : undefined;

      const selectedShapes: SimpleShape[] = selectionIds
        ? selectionIds
            .map((id) => editor.getShape(id as any) as any)
            .filter((shape): shape is any => !!shape)
            .map((shape) => convertTldrawShapeToSimpleShape(editor as any, shape))
        : [];

      const contextItems: ContextItem[] = [];
      if (boundsInput && typeof boundsInput === 'object') {
        contextItems.push({ type: 'area', bounds: normalizedBounds, source: 'user' });
      }
      if (selectedShapes.length === 1) {
        contextItems.push({ type: 'shape', shape: selectedShapes[0], source: 'user' });
      } else if (selectedShapes.length > 1) {
        contextItems.push({ type: 'shapes', shapes: selectedShapes, source: 'user' });
      }

      const input: AgentInput = {
        message: text,
        bounds: normalizedBounds,
        contextItems,
        selectedShapes,
        type: 'user',
      };

      const run = async () => {
        currentRequestRef.current = requestId;
        try {
          if (isClientAgentEnabled) agent.cancel();
          try {
            debugLog('[AgentBridge] starting client TLDraw agent prompt', {
              requestId,
              message: text,
            });
          } catch {}
          await sendAgentTelemetry('agent_begin', {
            requestId,
            room: room?.name,
            message: text,
          });

          if (isClientAgentEnabled) {
          await agent.prompt(input);
          }

          await sendAgentTelemetry('agent_end', {
            requestId,
            room: room?.name,
            ok: true,
          });
        } catch (error) {
          await sendAgentTelemetry('agent_end', {
            requestId,
            room: room?.name,
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          });
          console.error('[CanvasAgent] prompt failed', error);
        } finally {
          if (currentRequestRef.current === requestId) {
            currentRequestRef.current = null;
          }
        }
      };

      void run();
    });

    return () => {
      unsubscribe?.();
      currentRequestRef.current = null;
      if (isClientAgentEnabled) agent.cancel();
    };
  }, [agent, bus, editor, isHost, room?.name]);

  useEffect(() => {
    const handler = (evt: Event) => {
      try {
        const env = (evt as CustomEvent).detail;
        if (!env) return;
        if (isDevEnv && LOGS_ENABLED) {
          try {
            console.debug('[AgentBridge] applying agent_actions', {
              room: room?.name,
              sessionId: env?.sessionId,
              seq: env?.seq,
              actionCount: Array.isArray(env?.actions) ? env.actions.length : 0,
              isHost,
            });
          } catch {}
        }
        applyEnvelope({ editor, isHost, appliedIds: appliedActionIdsRef.current }, env);
        if (isDevEnv && LOGS_ENABLED) {
          try {
            const totalShapes = Array.from(editor.getCurrentPageShapeIds?.() ?? []).length;
            const w = window as any;
            w.__presentCanvasAgentAppliedActionCount =
              (w.__presentCanvasAgentAppliedActionCount ?? 0) + 1;
            w.__presentCanvasAgentLastShapeCount = totalShapes;
          } catch {}
        }
      } catch {}
    };
    window.addEventListener('present:agent_actions', handler as EventListener);
    return () => { window.removeEventListener('present:agent_actions', handler as EventListener); };
  }, [editor, isHost, room]);

  useEffect(() => {
    if (!isDevEnv) return;
    if (!room) {
      debugLog('[AgentBridge] no LiveKit room available; skipping host election log');
      return;
    }

    const participants: Participant[] = [room.localParticipant as unknown as Participant, ...Array.from(room.remoteParticipants.values()) as unknown as Participant[]].filter(
      (participant): participant is Participant => Boolean(participant),
    );
    const hostParticipant = participants.find((participant) => (participant.identity || participant.sid || '') === hostId);
    if (isHost) {
      debugLog('[AgentBridge] agent host: you', { identity: hostParticipant?.identity, name: hostParticipant?.name });
    } else if (hostParticipant) {
      debugLog('[AgentBridge] agent host: someone else', {
        identity: hostParticipant.identity,
        name: hostParticipant.name,
      });
    } else {
      debugLog('[AgentBridge] agent host: unresolved', { hostId });
    }
  }, [hostId, isHost, room]);

  return null;
}
