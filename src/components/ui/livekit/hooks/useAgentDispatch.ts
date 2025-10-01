import { useCallback, useEffect } from 'react';
import { Room, Participant } from 'livekit-client';

type AgentStatus = 'not-requested' | 'dispatching' | 'joined' | 'failed';

interface AgentState {
  agentStatus: AgentStatus;
  agentIdentity: string | null;
}

/**
 * Manages AI agent dispatch and tracking
 */
export function useAgentDispatch(
  room: Room | undefined,
  roomName: string,
  connectionState: string,
  setState: (updater: (prev: any) => any) => void,
  stateRef: React.RefObject<any>,
) {
  // Trigger agent join
  const triggerAgentJoin = useCallback(async () => {
    try {
      console.log(`🤖 [LiveKitConnector-${roomName}] Triggering agent join...`);

      setState((prev: any) => ({
        ...prev,
        agentStatus: 'dispatching',
      }));

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

        setTimeout(() => {
          if (stateRef.current?.agentStatus === 'dispatching') {
            console.warn(
              `⏰ [LiveKitConnector-${roomName}] Agent dispatch timeout - no agent joined within 30 seconds`,
            );
            setState((prev: any) => ({
              ...prev,
              agentStatus: 'failed',
              errorMessage: 'Agent failed to join within timeout period',
            }));
          }
        }, 30000);
      } else {
        const errorData = await response.json().catch(() => ({}));
        console.warn(
          `⚠️ [LiveKitConnector-${roomName}] Agent dispatch failed:`,
          response.status,
          errorData,
        );
        setState((prev: any) => ({
          ...prev,
          agentStatus: 'failed',
          errorMessage: `Dispatch failed: ${errorData.message || response.statusText}`,
        }));
      }
    } catch (error) {
      console.error(`❌ [LiveKitConnector-${roomName}] Agent dispatch error:`, error);
      setState((prev: any) => ({
        ...prev,
        agentStatus: 'failed',
        errorMessage: error instanceof Error ? error.message : 'Unknown dispatch error',
      }));
    }
  }, [roomName, setState, stateRef]);

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
    };
  }, [roomName, connectionState, triggerAgentJoin]);

  return { triggerAgentJoin };
}

/**
 * Helper to check if a participant is an agent
 */
export function isAgentParticipant(p: Participant): boolean {
  return (
    p.identity.toLowerCase().includes('agent') ||
    p.identity.toLowerCase().includes('bot') ||
    p.identity.toLowerCase().includes('ai') ||
    p.identity.startsWith('voice-agent') ||
    p.metadata?.includes('agent') ||
    p.metadata?.includes('type":"agent')
  );
}
