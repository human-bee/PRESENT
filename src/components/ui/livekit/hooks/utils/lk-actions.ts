import type {
  AgentStatus,
  ConnectorConnectionState,
  LivekitRoomConnectorAction,
  LivekitRoomConnectorState,
} from './lk-types';

export function setConnectionState(
  connectionState: ConnectorConnectionState,
  errorMessage?: string | null,
): LivekitRoomConnectorAction {
  return { type: 'set-connection', connectionState, errorMessage: errorMessage ?? null };
}

export function setParticipantCount(participantCount: number): LivekitRoomConnectorAction {
  return { type: 'set-participant-count', participantCount };
}

export function setToken(token: string | null): LivekitRoomConnectorAction {
  return { type: 'set-token', token };
}

export function setAgentStatus(
  agentStatus: AgentStatus,
  agentIdentity: string | null,
): LivekitRoomConnectorAction {
  return { type: 'set-agent', agentStatus, agentIdentity };
}

export function toggleMinimized(): LivekitRoomConnectorAction {
  return { type: 'toggle-minimized' };
}

export function mergeState(
  patch: Partial<LivekitRoomConnectorState>,
): LivekitRoomConnectorAction {
  return { type: 'merge', patch };
}

export function resetState(
  patch?: Partial<LivekitRoomConnectorState>,
): LivekitRoomConnectorAction {
  return { type: 'reset', patch };
}
