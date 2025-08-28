import { RealtimeAgent, RealtimeSession } from '@openai/agents/realtime';
import { z } from 'zod';

/**
 * OpenAI Agent-JS setup for LiveKit + Tambo UI integration
 *
 * This agent:
 * - Connects to LiveKit rooms to receive audio from participants
 * - Uses OpenAI Responses API for speech transcription and processing
 * - Detects trigger phrases to surface Tambo UI components
 * - Maintains conversation context and state
 */

// Configuration for the agent
export interface AgentConfig {
  name: string;
  instructions: string;
  model: string;
  triggerPhrases: string[];
  openaiApiKey: string;
}

// Default agent configuration
export const defaultAgentConfig: AgentConfig = {
  name: 'Tambo Voice Assistant',
  instructions: `You are a voice assistant that listens to conversations in a LiveKit room and can surface UI components when requested.

Key responsibilities:
- Listen to audio from room participants  
- Transcribe speech accurately
- Detect trigger phrases like "show timer", "create button", etc.
- When a trigger phrase is detected, call the appropriate tool to surface the Tambo UI component
- Maintain context of the conversation
- Only respond when directly addressed or when a trigger phrase is detected

Available trigger phrases and actions:
- "show timer" → surface RetroTimer component
- "create button" → surface button creation interface
- More components will be added as needed

Stay focused on detecting these specific triggers rather than general conversation.`,
  model: 'gpt-4o-realtime-preview-2025-06-03',
  triggerPhrases: ['show timer', 'create button', 'show component'],
  openaiApiKey: process.env.OPENAI_API_KEY || '',
};

/**
 * Create a configured RealtimeAgent for speech processing
 */
export function createTamboVoiceAgent(config: Partial<AgentConfig> = {}): RealtimeAgent {
  const finalConfig = { ...defaultAgentConfig, ...config };

  if (!finalConfig.openaiApiKey || finalConfig.openaiApiKey.trim() === '') {
    throw new Error('OpenAI API key is required. Set OPENAI_API_KEY environment variable.');
  }

  const agent = new RealtimeAgent({
    name: finalConfig.name,
    instructions: finalConfig.instructions,
    // Tools will be added here to surface Tambo UI components
    tools: [
      // Placeholder for Tambo component surfacing tools
    ],
  });

  return agent;
}

/**
 * Create a RealtimeSession for the agent
 */
export function createAgentSession(
  agent: RealtimeAgent,
  config: Partial<AgentConfig> = {},
): RealtimeSession {
  const finalConfig = { ...defaultAgentConfig, ...config };

  const session = new RealtimeSession(agent, {
    model: finalConfig.model,
  });

  return session;
}

/**
 * Agent state and connection management
 */
export class TamboVoiceAgentManager {
  private agent: RealtimeAgent | null = null;
  private session: RealtimeSession | null = null;
  private isConnected = false;

  constructor(private config: Partial<AgentConfig> = {}) {}

  /**
   * Initialize the agent and session
   */
  async initialize(): Promise<void> {
    try {
      this.agent = createTamboVoiceAgent(this.config);
      this.session = createAgentSession(this.agent, this.config);

      console.log('🤖 Tambo Voice Agent initialized successfully');
    } catch (error) {
      console.error('❌ Failed to initialize Tambo Voice Agent:', error);
      throw error;
    }
  }

  /**
   * Connect the agent session
   */
  async connect(apiKey?: string): Promise<void> {
    if (!this.session) {
      throw new Error('Agent not initialized. Call initialize() first.');
    }

    try {
      const key = apiKey || this.config.openaiApiKey || process.env.OPENAI_API_KEY;
      if (!key) {
        throw new Error('OpenAI API key is required');
      }

      await this.session.connect({ apiKey: key });
      this.isConnected = true;

      console.log('✅ Tambo Voice Agent connected to OpenAI Realtime API');
    } catch (error) {
      console.error('❌ Failed to connect Tambo Voice Agent:', error);
      throw error;
    }
  }

  /**
   * Disconnect the agent session
   */
  async disconnect(): Promise<void> {
    if (this.session && this.isConnected) {
      try {
        await this.session.disconnect();
        this.isConnected = false;
        console.log('🔌 Tambo Voice Agent disconnected');
      } catch (error) {
        console.error('⚠️ Error disconnecting Tambo Voice Agent:', error);
      }
    }
  }

  /**
   * Get agent status
   */
  getStatus() {
    return {
      initialized: !!this.agent,
      connected: this.isConnected,
      agentName: this.agent?.name || 'Not initialized',
    };
  }

  /**
   * Get the session for external integration
   */
  getSession(): RealtimeSession | null {
    return this.session;
  }

  /**
   * Get the agent for external configuration
   */
  getAgent(): RealtimeAgent | null {
    return this.agent;
  }
}

/**
 * Global agent manager instance
 */
export const tamboVoiceAgent = new TamboVoiceAgentManager(defaultAgentConfig);
