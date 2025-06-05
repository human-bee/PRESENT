import { Room, RoomEvent, TrackEvent, RemoteTrack, RemoteAudioTrack, LocalAudioTrack, AudioFrame, createAudioTrack } from 'livekit-client';
import { tamboVoiceAgent, TamboVoiceAgentManager } from './openai-agent';

/**
 * LiveKit Agent Bridge
 * 
 * This service bridges LiveKit rooms with the OpenAI Agent-JS SDK:
 * - Joins LiveKit rooms as an agent participant
 * - Routes audio from LiveKit participants to OpenAI Realtime API
 * - Sends OpenAI responses back to the LiveKit room
 * - Handles trigger phrase detection and Tambo UI component surfacing
 */

export interface LiveKitAgentBridgeConfig {
  roomUrl: string;
  token: string;
  agentName?: string;
  openaiApiKey?: string;
}

export class LiveKitAgentBridge {
  private room: Room;
  private agent: TamboVoiceAgentManager;
  private audioTrackMap = new Map<string, RemoteAudioTrack>();
  private localAudioTrack: LocalAudioTrack | null = null;
  private isConnected = false;
  
  constructor(private config: LiveKitAgentBridgeConfig) {
    this.room = new Room({
      adaptiveStream: true,
      dynacast: true,
      // Configure for agent use
      audioCaptureDefaults: {
        echoCancellation: false, // Agents don't need echo cancellation
        noiseSuppression: false, // Let OpenAI handle noise
      },
    });
    
    // Initialize the OpenAI agent with custom config if provided
    this.agent = new TamboVoiceAgentManager({
      openaiApiKey: config.openaiApiKey,
      name: config.agentName || 'Tambo Voice Agent',
    });
    
    this.setupRoomEventHandlers();
  }

  /**
   * Connect the agent to both LiveKit room and OpenAI
   */
  async connect(): Promise<void> {
    try {
      console.log('🔌 Connecting LiveKit Agent Bridge...');
      
      // Connect to LiveKit room
      await this.room.connect(this.config.roomUrl, this.config.token);
      console.log('✅ Connected to LiveKit room');
      
      // Initialize and connect OpenAI agent
      await this.agent.initialize();
      await this.agent.connect(this.config.openaiApiKey);
      console.log('✅ Connected to OpenAI Realtime API');
      
      // Create and publish local audio track for agent responses
      this.localAudioTrack = await createAudioTrack();
      await this.room.localParticipant.publishTrack(this.localAudioTrack);
      console.log('✅ Published agent audio track');
      
      this.isConnected = true;
      
      // Set up audio routing
      this.setupAudioBridge();
      
    } catch (error) {
      console.error('❌ Failed to connect LiveKit Agent Bridge:', error);
      throw error;
    }
  }

  /**
   * Disconnect the agent from both systems
   */
  async disconnect(): Promise<void> {
    if (this.isConnected) {
      try {
        // Unpublish local track
        if (this.localAudioTrack) {
          this.room.localParticipant.unpublishTrack(this.localAudioTrack);
          this.localAudioTrack.stop();
          this.localAudioTrack = null;
        }
        
        // Disconnect from services
        await this.agent.disconnect();
        await this.room.disconnect();
        
        this.isConnected = false;
        console.log('🔌 Disconnected LiveKit Agent Bridge');
      } catch (error) {
        console.error('⚠️ Error disconnecting LiveKit Agent Bridge:', error);
      }
    }
  }

  /**
   * Set up event handlers for the LiveKit room
   */
  private setupRoomEventHandlers(): void {
    // Handle new participants
    this.room.on(RoomEvent.ParticipantConnected, (participant) => {
      console.log(`👥 Participant connected: ${participant.identity}`);
    });
    
    // Handle participant disconnections
    this.room.on(RoomEvent.ParticipantDisconnected, (participant) => {
      console.log(`👥 Participant disconnected: ${participant.identity}`);
      // Clean up audio tracks
      this.audioTrackMap.delete(participant.identity);
    });
    
    // Handle new tracks
    this.room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
      if (track.kind === 'audio' && track instanceof RemoteAudioTrack) {
        console.log(`🎤 Subscribed to audio track from ${participant.identity}`);
        this.audioTrackMap.set(participant.identity, track);
        this.handleNewAudioTrack(track, participant.identity);
      }
    });
    
    // Handle track unsubscriptions
    this.room.on(RoomEvent.TrackUnsubscribed, (track, publication, participant) => {
      if (track.kind === 'audio') {
        console.log(`🎤 Unsubscribed from audio track from ${participant.identity}`);
        this.audioTrackMap.delete(participant.identity);
      }
    });
    
    // Handle room disconnection
    this.room.on(RoomEvent.Disconnected, (reason) => {
      console.log(`❌ Disconnected from room: ${reason}`);
      this.isConnected = false;
    });
  }

  /**
   * Handle new audio track from a participant
   */
  private handleNewAudioTrack(track: RemoteAudioTrack, participantIdentity: string): void {
    // In a real implementation, we would:
    // 1. Attach the track to get audio data
    // 2. Convert the audio format if needed
    // 3. Send it to the OpenAI Realtime API
    
    console.log(`🎵 Processing audio from ${participantIdentity}`);
    
    // For now, log that we would process this audio
    // The actual audio routing would require WebRTC audio processing
    // which is complex and depends on the specific runtime environment
  }

  /**
   * Set up the audio bridge between LiveKit and OpenAI
   */
  private setupAudioBridge(): void {
    const session = this.agent.getSession();
    if (!session) {
      console.error('❌ No OpenAI session available for audio bridge');
      return;
    }
    
    // In a real implementation, this would:
    // 1. Route audio from LiveKit participants to OpenAI
    // 2. Route OpenAI responses back to LiveKit
    // 3. Handle trigger phrase detection
    // 4. Surface Tambo UI components when triggers are detected
    
    console.log('🌉 Audio bridge setup complete (placeholder)');
    
    // Note: The actual implementation would require:
    // - WebRTC audio processing to convert between formats
    // - Audio streaming between LiveKit and OpenAI
    // - Handling of audio codecs and sample rates
    // - Real-time audio synchronization
  }

  /**
   * Send a trigger event when a Tambo UI component should be surfaced
   */
  private async surfaceTamboComponent(componentType: string, data: any): Promise<void> {
    // Send data message to all participants to surface the component
    const message = {
      type: 'tambo_component_trigger',
      component: componentType,
      data: data,
      timestamp: Date.now(),
    };
    
    const encoder = new TextEncoder();
    const encodedData = encoder.encode(JSON.stringify(message));
    
    await this.room.localParticipant.publishData(encodedData, {
      reliable: true,
    });
    
    console.log(`🎯 Surfaced Tambo component: ${componentType}`);
  }

  /**
   * Get connection status
   */
  getStatus() {
    return {
      livekit: {
        connected: this.room.state === 'connected',
        roomName: this.room.name,
        participantCount: this.room.remoteParticipants.size + 1, // +1 for agent
      },
      openai: this.agent.getStatus(),
      bridge: {
        connected: this.isConnected,
        audioTracksConnected: this.audioTrackMap.size,
      },
    };
  }
}

/**
 * Factory function to create a LiveKit agent bridge
 */
export async function createLiveKitAgentBridge(config: LiveKitAgentBridgeConfig): Promise<LiveKitAgentBridge> {
  const bridge = new LiveKitAgentBridge(config);
  await bridge.connect();
  return bridge;
} 