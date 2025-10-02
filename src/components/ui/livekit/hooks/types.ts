export type AgentStatus = 'not-requested' | 'dispatching' | 'joined' | 'failed';

export interface LivekitRoomConnectorState {
  connectionState: 'disconnected' | 'connecting' | 'connected' | 'error';
  isMinimized: boolean;
  participantCount: number;
  errorMessage: string | null;
  token: string | null;
  agentStatus: AgentStatus;
  agentIdentity: string | null;
}

export const initialLivekitRoomConnectorState: LivekitRoomConnectorState = {
  connectionState: 'disconnected',
  isMinimized: false,
  participantCount: 0,
  errorMessage: null,
  token: null,
  agentStatus: 'not-requested',
  agentIdentity: null,
};
