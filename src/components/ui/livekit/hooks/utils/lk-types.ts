export type AgentStatus = 'not-requested' | 'dispatching' | 'joined' | 'failed';

export type ConnectorConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'error';

export interface LivekitRoomConnectorState {
  connectionState: ConnectorConnectionState;
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

export type LivekitRoomConnectorAction =
  | { type: 'set-connection'; connectionState: ConnectorConnectionState; errorMessage?: string | null }
  | { type: 'set-participant-count'; participantCount: number }
  | { type: 'set-token'; token: string | null }
  | { type: 'set-agent'; agentStatus: AgentStatus; agentIdentity: string | null }
  | { type: 'toggle-minimized' }
  | { type: 'merge'; patch: Partial<LivekitRoomConnectorState> }
  | { type: 'reset'; patch?: Partial<LivekitRoomConnectorState> };

export function livekitRoomConnectorReducer(
  state: LivekitRoomConnectorState,
  action: LivekitRoomConnectorAction,
): LivekitRoomConnectorState {
  switch (action.type) {
    case 'set-connection':
      return {
        ...state,
        connectionState: action.connectionState,
        errorMessage: action.errorMessage ?? null,
      };
    case 'set-participant-count':
      return {
        ...state,
        participantCount: action.participantCount,
      };
    case 'set-token':
      return {
        ...state,
        token: action.token,
      };
    case 'set-agent':
      return {
        ...state,
        agentStatus: action.agentStatus,
        agentIdentity: action.agentIdentity,
      };
    case 'toggle-minimized':
      return {
        ...state,
        isMinimized: !state.isMinimized,
      };
    case 'merge':
      return {
        ...state,
        ...action.patch,
      };
    case 'reset':
      return {
        ...initialLivekitRoomConnectorState,
        ...action.patch,
      };
    default:
      return state;
  }
}
