/**
 * LiveKit Agent Bridge Types
 *
 * Type definitions for communication between the frontend and the LiveKit agent.
 * The actual agent runs as a separate Node.js process.
 */

export interface LiveKitAgentBridgeConfig {
  roomUrl: string;
  token: string;
  agentName?: string;
  openaiApiKey?: string;
}

export interface AgentStatus {
  livekit: {
    connected: boolean;
    roomName?: string;
    participantCount?: number;
  };
  openai: {
    connected: boolean;
    model?: string;
  };
  bridge: {
    connected: boolean;
    audioTracksConnected?: number;
  };
}

export interface TamboComponent {
  type: 'tambo_component';
  component: string;
  props: {
    [key: string]: string | number | boolean | undefined;
  };
  timestamp: number;
}

export interface LiveTranscription {
  type: 'live_transcription';
  text: string;
  speaker: string;
  timestamp: number;
  is_final: boolean;
}

export type AgentDataMessage = TamboComponent | LiveTranscription;
