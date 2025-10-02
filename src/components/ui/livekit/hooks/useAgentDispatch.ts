import { useCallback, useEffect, useRef } from 'react';
import { Participant } from 'livekit-client';
import { LivekitRoomConnectorState } from './types';

type MergeFn = (patch: Partial<LivekitRoomConnectorState>) => void;
type GetStateFn = () => LivekitRoomConnectorState;

export function useAgentDispatch(
  roomName: string,
  connectionState: LivekitRoomConnectorState['connectionState'],
  mergeState: MergeFn,
  getState: GetStateFn,
) {
  const dispatchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Trigger agent join
  const triggerAgentJoin = useCallback(async () => {
    try {
      console.log(`🤖 [LiveKitConnector-${roomName}] Triggering agent join...`);

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
          roomName,
          trigger: 'participant_connected',
          timestamp: Date.now(),
        }),
      });

      if (response.ok) {
        const result = await response.json();
        console.log(`✅ [LiveKitConnector-${roomName}] Agent dispatch triggered:`, result);

        if (typeof window !== 'undefined') {
          if (dispatchTimeoutRef.current) {
            clearTimeout(dispatchTimeoutRef.current);
          }

          dispatchTimeoutRef.current = setTimeout(() => {
            const latest = getState();
            if (latest.agentStatus === 'dispatching') {
              console.warn(
                `⏰ [LiveKitConnector-${roomName}] Agent dispatch timeout - no agent joined within 30 seconds`,
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
          `⚠️ [LiveKitConnector-${roomName}] Agent dispatch failed:`,
          response.status,
          errorData,
        );
        mergeState({
          agentStatus: 'failed',
          errorMessage: `Dispatch failed: ${errorData.message || response.statusText}`,
        });
      }
    } catch (error) {
      console.error(`❌ [LiveKitConnector-${roomName}] Agent dispatch error:`, error);
      mergeState({
        agentStatus: 'failed',
        errorMessage: error instanceof Error ? error.message : 'Unknown dispatch error',
      });
    }
  }, [roomName, mergeState, getState]);

  // Listen for manual agent requests
  useEffect(() => {
    const handleAgentRequest = (event: CustomEvent) => {
      const { roomName: requestedRoom } = event.detail;
      if (requestedRoom === roomName && connectionState === 'connected') {
        console.log(`🎯 [LiveKitConnector-${roomName}] Manual agent request received`);
        triggerAgentJoin();
      }
    };

        window.addEventListener('livekit:request-agent', handleAgentRequest as EventListener);

        return () => {
          window.removeEventListener('livekit:request-agent', handleAgentRequest as EventListener);
          if (dispatchTimeoutRef.current) {
            clearTimeout(dispatchTimeoutRef.current);
            dispatchTimeoutRef.current = null;
          }
        };
  }, [roomName, connectionState, triggerAgentJoin]);

  return { triggerAgentJoin };
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
