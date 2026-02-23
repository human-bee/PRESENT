import { useCallback, useEffect, useRef } from 'react';
import { Participant } from 'livekit-client';
import { LivekitRoomConnectorState } from './types';

type MergeFn = (patch: Partial<LivekitRoomConnectorState>) => void;
type GetStateFn = () => LivekitRoomConnectorState;

const normalizeRoomName = (value: string): string => value.trim();
const AGENT_DISPATCH_COOLDOWN_MS = Math.max(
  1000,
  Number.parseInt(process.env.NEXT_PUBLIC_AGENT_DISPATCH_COOLDOWN_MS ?? '5000', 10) || 5000,
);
const AGENT_DISPATCH_TIMEOUT_MS = Math.max(
  5000,
  Number.parseInt(process.env.NEXT_PUBLIC_AGENT_DISPATCH_TIMEOUT_MS ?? '30000', 10) || 30000,
);
const AGENT_DISPATCH_RETRY_DELAY_MS = Math.max(
  1000,
  Number.parseInt(process.env.NEXT_PUBLIC_AGENT_DISPATCH_RETRY_DELAY_MS ?? '2500', 10) || 2500,
);
const AGENT_DISPATCH_MAX_RETRIES = Math.max(
  0,
  Number.parseInt(process.env.NEXT_PUBLIC_AGENT_DISPATCH_MAX_RETRIES ?? '2', 10) || 2,
);

const isRetryableDispatchStatus = (status: number): boolean =>
  status === 404 || status === 408 || status === 425 || status === 429 || status >= 500;

export function useAgentDispatch(
  roomName: string,
  connectionState: LivekitRoomConnectorState['connectionState'],
  mergeState: MergeFn,
  getState: GetStateFn,
) {
  const dispatchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dispatchRetryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dispatchRetryCountRef = useRef(0);
  const dispatchInFlightRef = useRef(false);
  const lastDispatchAtRef = useRef(0);

  // Trigger agent join
  const requestAgent = useCallback(async (options?: { force?: boolean }) => {
    const force = options?.force === true;
    const scheduleRetry = (normalizedRoomName: string, reason: string) => {
      if (dispatchRetryCountRef.current >= AGENT_DISPATCH_MAX_RETRIES) {
        mergeState({
          agentStatus: 'failed',
          errorMessage: reason,
        });
        return;
      }
      dispatchRetryCountRef.current += 1;
      const retryAttempt = dispatchRetryCountRef.current;
      mergeState({
        agentStatus: 'dispatching',
        errorMessage: `${reason}. Retrying (${retryAttempt}/${AGENT_DISPATCH_MAX_RETRIES})`,
      });
      if (dispatchRetryRef.current) {
        clearTimeout(dispatchRetryRef.current);
      }
      dispatchRetryRef.current = setTimeout(() => {
        dispatchRetryRef.current = null;
        const latest = getState();
        if (latest.agentStatus === 'joined') {
          dispatchRetryCountRef.current = 0;
          return;
        }
        if (latest.connectionState !== 'connected' && latest.connectionState !== 'reconnecting') {
          return;
        }
        console.log(`🔁 [LiveKitConnector-${normalizedRoomName}] Retrying agent dispatch...`);
        lastDispatchAtRef.current = 0;
        void requestAgent({ force: true });
      }, AGENT_DISPATCH_RETRY_DELAY_MS);
    };

    if (dispatchInFlightRef.current) {
      return;
    }
    const latestState = getState();
    if (latestState.agentStatus === 'joined' && latestState.agentIdentity) {
      dispatchRetryCountRef.current = 0;
      return;
    }
    if (!force && latestState.agentStatus === 'dispatching') {
      return;
    }
    const nowMs = Date.now();
    if (!force && nowMs - lastDispatchAtRef.current < AGENT_DISPATCH_COOLDOWN_MS) {
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
        errorMessage: dispatchRetryCountRef.current > 0 ? latestState.errorMessage : null,
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
          dispatchRetryCountRef.current = 0;
          if (dispatchRetryRef.current) {
            clearTimeout(dispatchRetryRef.current);
            dispatchRetryRef.current = null;
          }
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
                `⏰ [LiveKitConnector-${normalizedRoomName}] Agent dispatch timeout - no agent joined within ${AGENT_DISPATCH_TIMEOUT_MS / 1000}s`,
              );
              scheduleRetry(
                normalizedRoomName,
                'Agent failed to join within timeout period',
              );
            }
          }, AGENT_DISPATCH_TIMEOUT_MS);
        }
      } else {
        const errorData = await response.json().catch(() => ({}));
        console.warn(
          `⚠️ [LiveKitConnector-${normalizedRoomName}] Agent dispatch failed:`,
          response.status,
          errorData,
        );
        const failureMessage = `Dispatch failed: ${errorData.message || response.statusText}`;
        if (isRetryableDispatchStatus(response.status)) {
          scheduleRetry(normalizedRoomName, failureMessage);
          return;
        }
        mergeState({
          agentStatus: 'failed',
          errorMessage: failureMessage,
        });
      }
    } catch (error) {
      console.error(`❌ [LiveKitConnector-${normalizedRoomName}] Agent dispatch error:`, error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown dispatch error';
      scheduleRetry(normalizedRoomName, errorMessage);
    } finally {
      dispatchInFlightRef.current = false;
    }
  }, [roomName, mergeState, getState]);

  useEffect(() => {
    if (connectionState !== 'disconnected' && connectionState !== 'error') return;
    if (dispatchTimeoutRef.current) {
      clearTimeout(dispatchTimeoutRef.current);
      dispatchTimeoutRef.current = null;
    }
    if (dispatchRetryRef.current) {
      clearTimeout(dispatchRetryRef.current);
      dispatchRetryRef.current = null;
    }
    dispatchRetryCountRef.current = 0;
  }, [connectionState]);

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
      if (dispatchRetryRef.current) {
        clearTimeout(dispatchRetryRef.current);
        dispatchRetryRef.current = null;
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
