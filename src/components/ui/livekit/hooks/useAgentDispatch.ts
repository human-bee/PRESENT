import { useCallback, useEffect, useRef } from 'react';
import { Participant } from 'livekit-client';
import { LivekitRoomConnectorState } from './types';

type MergeFn = (patch: Partial<LivekitRoomConnectorState>) => void;
type GetStateFn = () => LivekitRoomConnectorState;

const normalizeRoomName = (value: string): string => value.trim();

export function useAgentDispatch(
  roomName: string,
  connectionState: LivekitRoomConnectorState['connectionState'],
  mergeState: MergeFn,
  getState: GetStateFn,
) {
  const dispatchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dispatchInFlightRef = useRef(false);
  const lastDispatchAtRef = useRef(0);

  // Trigger agent join
  const requestAgent = useCallback(async () => {
    if (dispatchInFlightRef.current) {
      return;
    }
    const latestState = getState();
    if (latestState.agentStatus === 'joined' && latestState.agentIdentity) {
      return;
    }
    if (latestState.agentStatus === 'dispatching') {
      return;
    }
    const nowMs = Date.now();
    if (nowMs - lastDispatchAtRef.current < 5000) {
      return;
    }
    const normalizedRoomName = normalizeRoomName(roomName);
    if (!normalizedRoomName) {
      mergeState({
        agentStatus: 'failed',
        errorMessage: 'Cannot dispatch agent without a room name',
      });
      return;
    }
    dispatchInFlightRef.current = true;
    lastDispatchAtRef.current = nowMs;
    try {
      console.log(`🤖 [LiveKitConnector-${normalizedRoomName}] Triggering agent join...`);

      mergeState({
        agentStatus: 'dispatching',
        errorMessage: null,
      });

      const response = await fetch('/api/agent/dispatch', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          roomName: normalizedRoomName,
          trigger: 'participant_connected',
          timestamp: Date.now(),
        }),
      });

      if (response.ok) {
        const result = await response.json();
        console.log(`✅ [LiveKitConnector-${normalizedRoomName}] Agent dispatch triggered:`, result);
        if (result?.alreadyJoined || result?.reason === 'agent_already_joined') {
          mergeState({
            agentStatus: 'joined',
            agentIdentity: latestState.agentIdentity,
            errorMessage: null,
          });
          return;
        }

        if (typeof window !== 'undefined') {
          if (dispatchTimeoutRef.current) {
            clearTimeout(dispatchTimeoutRef.current);
          }

          dispatchTimeoutRef.current = setTimeout(() => {
            const latest = getState();
            if (latest.agentStatus === 'dispatching') {
              console.warn(
                `⏰ [LiveKitConnector-${normalizedRoomName}] Agent dispatch timeout - no agent joined within 30 seconds`,
              );
              mergeState({
                agentStatus: 'failed',
                errorMessage: 'Agent failed to join within timeout period',
              });
            }
          }, 30000);
        }
      } else {
        const errorData = await response.json().catch(() => ({}));
        console.warn(
          `⚠️ [LiveKitConnector-${normalizedRoomName}] Agent dispatch failed:`,
          response.status,
          errorData,
        );
        mergeState({
          agentStatus: 'failed',
          errorMessage: `Dispatch failed: ${errorData.message || response.statusText}`,
        });
      }
    } catch (error) {
      console.error(`❌ [LiveKitConnector-${normalizedRoomName}] Agent dispatch error:`, error);
      mergeState({
        agentStatus: 'failed',
        errorMessage: error instanceof Error ? error.message : 'Unknown dispatch error',
      });
    } finally {
      dispatchInFlightRef.current = false;
    }
  }, [roomName, mergeState, getState]);

  // Listen for manual agent requests
  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const handleAgentRequest = (event: Event) => {
      const customEvent = event as CustomEvent;
      const { roomName: requestedRoom } = customEvent.detail ?? {};
      if (
        normalizeRoomName(requestedRoom ?? '') === normalizeRoomName(roomName) &&
        connectionState === 'connected'
      ) {
        console.log(`🎯 [LiveKitConnector-${normalizeRoomName(roomName)}] Manual agent request received`);
        void requestAgent();
      }
    };

    window.addEventListener('livekit:request-agent', handleAgentRequest);

    return () => {
      window.removeEventListener('livekit:request-agent', handleAgentRequest);
      if (dispatchTimeoutRef.current) {
        clearTimeout(dispatchTimeoutRef.current);
        dispatchTimeoutRef.current = null;
      }
    };
  }, [roomName, connectionState, requestAgent]);

  return { requestAgent };
}

/**
 * Helper to check if a participant is an agent
 */
export function isAgentParticipant(p: Participant): boolean {
  const identity = p.identity.toLowerCase();
  return (
    identity.includes('agent') ||
    identity.includes('bot') ||
    identity.includes('ai') ||
    p.identity.startsWith('voice-agent') ||
    Boolean(p.metadata?.includes('agent')) ||
    Boolean(p.metadata?.includes('type":"agent'))
  );
}
