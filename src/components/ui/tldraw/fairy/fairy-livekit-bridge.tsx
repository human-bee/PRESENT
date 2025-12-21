'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Room, Participant } from 'livekit-client';
import { useEditor } from '@tldraw/tldraw';
import { createLiveKitBus } from '@/lib/livekit/livekit-bus';
import { useFairyApp } from '@/vendor/tldraw-fairy/fairy/fairy-app/FairyAppProvider';
import { useViewportSelectionPublisher } from '@/components/ui/canvas/hooks/useViewportSelectionPublisher';
import { useScreenshotRequestHandler } from '@/components/ui/canvas/hooks/useScreenshotRequestHandler';
import type { FairyAgent } from '@/vendor/tldraw-fairy/fairy/fairy-agent/FairyAgent';
import { useFairyPromptData } from './fairy-prompt-data';

interface FairyLiveKitBridgeProps {
  room?: Room;
}

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

function pickAgent(agents: FairyAgent[]): FairyAgent | null {
  if (!agents.length) return null;
  const selected = agents.find((agent) => agent.getEntity()?.isSelected);
  return selected ?? agents[0];
}

export function FairyLiveKitBridge({ room }: FairyLiveKitBridgeProps) {
  const editor = useEditor();
  const fairyApp = useFairyApp();
  const { isHost } = useIsAgentHost(room);
  const bus = useMemo(() => (room ? createLiveKitBus(room) : null), [room]);
  const processedIdsRef = useRef<Set<string>>(new Set());
  const buildPromptData = useFairyPromptData();

  useViewportSelectionPublisher(editor, room, true);
  useScreenshotRequestHandler(editor, room);

  useEffect(() => {
    if (!bus) return;

    const unsubscribe = bus.on('agent_prompt', (message: any) => {
      if (!message || message.type !== 'agent_prompt') return;
      if (!isHost) return;

      const { payload } = message as { payload?: any };
      const text: string | undefined = typeof payload?.message === 'string' ? payload.message.trim() : undefined;
      if (!text) return;

      const requestId: string =
        typeof payload?.requestId === 'string' && payload.requestId
          ? payload.requestId
          : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const seen = processedIdsRef.current;
      if (seen.has(requestId)) return;
      seen.add(requestId);
      if (seen.size > 100) {
        const firstKey = seen.values().next().value;
        if (firstKey) seen.delete(firstKey);
      }

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

      const selectionIds = Array.isArray(payload?.selectionIds)
        ? payload.selectionIds.filter((id: unknown) => typeof id === 'string')
        : [];
      const validSelectionIds = selectionIds.filter((id: string) => {
        try {
          return Boolean(editor.getShape(id as any));
        } catch {
          return false;
        }
      });

      const agents = fairyApp.agents.getAgents();
      const agent = pickAgent(agents);
      if (!agent) return;

      if (agent.mode.isSleeping()) {
        agent.mode.setMode('idling');
      }
      agent.updateEntity((f) => (f ? { ...f, isSelected: true } : f));
      agent.position.summon();

      const run = async () => {
        const previousSelection =
          typeof (editor as any).getSelectedShapeIds === 'function'
            ? (editor as any).getSelectedShapeIds()
            : [];
        const setSelection = (ids: string[]) => {
          const setter = (editor as any).setSelectedShapes ?? (editor as any).setSelectedShapeIds;
          if (typeof setter === 'function') {
            setter.call(editor, ids);
          }
        };
        if (validSelectionIds.length > 0) {
          setSelection(validSelectionIds);
        }
        try {
          await agent.prompt({
            message: text,
            bounds: normalizedBounds,
            source: 'user',
            data: buildPromptData({
              metadata: payload?.metadata,
              selectionIds: validSelectionIds,
            }),
          } as any);
        } catch (error) {
          console.error('[FairyBridge] prompt failed', error);
        } finally {
          if (validSelectionIds.length > 0) {
            setSelection(previousSelection);
          }
        }
      };

      void run();
    });

    return () => {
      unsubscribe?.();
    };
  }, [bus, buildPromptData, editor, fairyApp, isHost]);

  return null;
}
