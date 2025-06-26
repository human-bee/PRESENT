#!/usr/bin/env node
/**
 * Enhanced Tambo Voice Agent - Improved Multi-Participant Audio Routing
 * 
 * This approach enhances the original agent with better audio routing
 * to ensure all participants' audio reaches the OpenAI Realtime API.
 */

import { config } from 'dotenv';
import { join } from 'path';
import { nanoid } from 'nanoid';

// Load environment variables from .env.local
config({ path: join(process.cwd(), '.env.local') });

import { defineAgent, JobContext, cli, WorkerOptions, multimodal } from '@livekit/agents';
import { RoomEvent, Track } from 'livekit-client';
import * as openai from '@livekit/agents-plugin-openai';
import { DecisionEngine } from './decision-engine';
import WebSocket from 'ws';
// Internal imports – not exported publicly, so we suppress type checking
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import { ClientWebSocketAdapter } from '@tldraw/sync-core/dist-cjs/lib/ClientWebSocketAdapter.js';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import { TLSyncClient } from '@tldraw/sync-core/dist-cjs/lib/TLSyncClient.js';
import { createTLStore, defaultShapeUtils, defaultBindingUtils } from 'tldraw';

console.log('🚀 Starting Enhanced Tambo Voice Agent Worker...');

// Polyfill minimal DOM globals for ClientWebSocketAdapter in Node.js
// These are no-ops just to satisfy event listeners used by the reconnection logic
if (typeof (global as any).window === 'undefined') {
  (global as any).window = {
    addEventListener: () => {},
    removeEventListener: () => {},
    __tldraw_socket_debug: false,
  } as any;
}
if (typeof (global as any).document === 'undefined') {
  (global as any).document = {
    hidden: false,
    addEventListener: () => {},
    removeEventListener: () => {},
  } as any;
}
if (typeof (global as any).navigator === 'undefined') {
  (global as any).navigator = {} as any;
}

type CanvasSyncConnection = {
  store: ReturnType<typeof createTLStore>;
  client: TLSyncClient;
};

async function connectCanvasSync(roomName: string): Promise<CanvasSyncConnection> {
  const syncHost = process.env.TLDRAW_SYNC_URL || 'wss://tldraw-sync-demo.tldraw.com/connect';
  const uri = `${syncHost}/${encodeURIComponent(roomName)}`;

  // Adapter expects global.WebSocket, but we'll pass factory that uses ws package
  const socketAdapter: any = new ClientWebSocketAdapter(() => uri);
  const ws = new WebSocket(uri);
  // Attach the Node WebSocket instance to the adapter (private API)
  (socketAdapter as any)._setNewSocket(ws);

  const store = createTLStore({
    shapeUtils: [...defaultShapeUtils],
    bindingUtils: [...defaultBindingUtils],
  });

  return await new Promise((resolve) => {
    const client = new TLSyncClient({
      store,
      socket: socketAdapter as any,
      didCancel: () => false,
      onLoad: () => {
        console.log('🖥️  [AgentSync] Connected to tldraw sync server');
        resolve({ store, client });
      },
      onSyncError: (reason: unknown) => {
        console.error('❌ [AgentSync] Sync error:', reason);
      },
      presence: undefined as any,
    });
  });
}

export default defineAgent({
  entry: async (job: JobContext) => {
    console.log(`🎉 [EnhancedAgent] Job received! Joining room: ${job.room.name}`);
    
    await job.connect();
    console.log('✅ [EnhancedAgent] Successfully connected to room!');
    
    // Enhanced audio tracking
    const participantAudioState = new Map<string, {
      isSubscribed: boolean;
      lastSeen: number;
      audioLevel: number;
    }>();
    
    // Track the most recently active speaker and all speakers
    let lastActiveSpeaker: string | null = null;
    let allActiveSpeakers: string[] = [];
    
    // Enhanced speaker tracking with audio levels
    job.room.on('activeSpeakersChanged', (speakers) => {
      console.log(`🗣️ [EnhancedAgent] Active speakers changed:`, speakers.map(s => s.identity));
      
      allActiveSpeakers = speakers.map(s => s.identity);
      if (speakers.length > 0) {
        lastActiveSpeaker = speakers[0].identity;
        console.log(`🎯 [EnhancedAgent] Primary active speaker: ${lastActiveSpeaker}`);
      }
      
      // Update audio levels for all speakers
      speakers.forEach(speaker => {
        const state = participantAudioState.get(speaker.identity);
        if (state) {
          state.audioLevel = speaker.audioLevel || 0;
          state.lastSeen = Date.now();
        }
      });
    });
    
    // Enhanced participant tracking
    job.room.on(RoomEvent.ParticipantConnected, (participant: any) => {
      console.log(`👤 [EnhancedAgent] Participant connected: ${participant.identity}`);
      participantAudioState.set(participant.identity, {
        isSubscribed: false,
        lastSeen: Date.now(),
        audioLevel: 0,
      });
    });
    
    job.room.on(RoomEvent.ParticipantDisconnected, (participant: any) => {
      console.log(`👋 [EnhancedAgent] Participant disconnected: ${participant.identity}`);
      participantAudioState.delete(participant.identity);
    });
    
    // Enhanced track subscription with better error handling and retries
    job.room.on(RoomEvent.TrackPublished, async (pub: any, participant: any) => {
      console.log(`📡 [EnhancedAgent] Track published by ${participant.identity}:`, {
        kind: pub.kind,
        name: pub.name || pub.trackName,
        muted: pub.muted,
        simulcasted: pub.simulcasted
      });
      
      if (pub.kind === Track.Kind.Audio || pub.kind === 'audio') {
        let retryCount = 0;
        const maxRetries = 3;
        
        const attemptSubscribe = async () => {
          try {
            await pub.setSubscribed(true);
            console.log(`✅ [EnhancedAgent] Successfully subscribed to ${participant.identity}'s audio`);
            
            // Update state
            const state = participantAudioState.get(participant.identity);
            if (state) {
              state.isSubscribed = true;
              state.lastSeen = Date.now();
            }
            
            // Wait a bit then verify subscription
            setTimeout(() => {
              console.log(`🔍 [EnhancedAgent] Audio subscription verification for ${participant.identity}:`, {
                subscribed: pub.subscribed,
                track: !!pub.track,
                muted: pub.muted
              });
            }, 1000);
            
          } catch (err) {
            retryCount++;
            console.error(`❌ [EnhancedAgent] Failed to subscribe to ${participant.identity}'s audio (attempt ${retryCount}/${maxRetries}):`, err);
            
            if (retryCount < maxRetries) {
              setTimeout(attemptSubscribe, 1000 * retryCount); // Exponential backoff
            }
          }
        };
        
        await attemptSubscribe();
      }
    });
    
    // Monitor track subscription status
    job.room.on(RoomEvent.TrackSubscribed, (track: any, publication: any, participant: any) => {
      if (track.kind === 'audio') {
        console.log(`🔊 [EnhancedAgent] Audio track successfully subscribed from ${participant.identity}`);
        const state = participantAudioState.get(participant.identity);
        if (state) {
          state.isSubscribed = true;
          state.lastSeen = Date.now();
        }
      }
    });
    
    job.room.on(RoomEvent.TrackUnsubscribed, (track: any, publication: any, participant: any) => {
      if (track.kind === 'audio') {
        console.log(`🔇 [EnhancedAgent] Audio track unsubscribed from ${participant.identity}`);
        const state = participantAudioState.get(participant.identity);
        if (state) {
          state.isSubscribed = false;
        }
      }
    });
    
    // Initialize existing participants
    for (const participant of job.room.remoteParticipants.values()) {
      participantAudioState.set(participant.identity, {
        isSubscribed: false,
        lastSeen: Date.now(),
        audioLevel: 0,
      });
    }
    
    console.log('🧠 [EnhancedAgent] Initializing OpenAI Realtime model...');
    
    // Create the multimodal agent with enhanced configuration
    const model = new openai.realtime.RealtimeModel({
      instructions: `You are Tambo Voice Agent, processing multi-participant conversations.
        
        You are hearing from multiple participants in a LiveKit room. When you transcribe speech, 
        pay attention to speaker changes and different voices. Process all audio input and provide
        accurate transcriptions for each speaker.
        
        IMPORTANT: When users ask for UI components, DO NOT repeat their request back as text. 
        The UI generation is handled automatically when they speak.`,
      model: 'gpt-4o-realtime-preview',
      modalities: ['text'],
      // Try to get better quality and reduce latency
      voice: 'alloy',
    });
    
    console.log('🎙️ [EnhancedAgent] Starting enhanced multimodal agent...');
    
    // Initialize Decision Engine
    const decisionEngine = new DecisionEngine(process.env.OPENAI_API_KEY || '');
    console.log('🧠 [EnhancedAgent] Decision Engine initialized');
    
    // Connect to tldraw sync once room is connected
    const { store: canvasStore } = await connectCanvasSync(job.room.name);

    // Forward agent-initiated canvas changes to LiveKit participants via data channel
    const broadcastCanvasUpdate = (snapshot: any) => {
      try {
        job.room.localParticipant?.publishData(
          new TextEncoder().encode(
            JSON.stringify({ type: 'tldraw_snapshot', data: snapshot, timestamp: Date.now() })
          ),
          { reliable: true, topic: 'tldraw' }
        );
      } catch (err) {
        console.error('❌ [EnhancedAgent] Failed to broadcast canvas state:', err);
      }
    };

    // Throttle snapshot broadcast to once every second when agent mutates store
    let lastBroadcast = 0;
    canvasStore.listen(() => {
      const now = Date.now();
      if (now - lastBroadcast < 1000) return;
      lastBroadcast = now;
      const snapshot = canvasStore.getSnapshot();
      broadcastCanvasUpdate(snapshot);
    }, { scope: 'document' });
    
    // Configure agent with enhanced settings
    const agent = new multimodal.MultimodalAgent({ 
      model,
      maxTextResponseRetries: Number.MAX_SAFE_INTEGER,
    });
    
    // Start the agent session with enhanced error handling
    const session = await agent
      .start(job.room)
      .then(session => {
        console.log('✅ [EnhancedAgent] Enhanced multimodal agent started successfully!');
        
        // Send welcome message
        setTimeout(() => {
          const welcomeData = JSON.stringify({
            type: 'live_transcription',
            text: '🤖 Enhanced Tambo Voice Agent connected! I can hear all participants and respond naturally.',
            speaker: 'tambo-voice-agent',
            timestamp: Date.now(),
            is_final: true,
          });
          
          job.room.localParticipant?.publishData(
            new TextEncoder().encode(welcomeData),
            { reliable: true, topic: 'transcription' }
          );
          console.log('📤 [EnhancedAgent] Welcome message sent');
        }, 1000);
        
        // Override for text responses
        (session as unknown as { recoverFromTextResponse: () => void }).recoverFromTextResponse = () => {};
        
        return session;
      })
      .catch(error => {
        console.error('❌ [EnhancedAgent] Failed to start enhanced multimodal agent:', error);
        throw error;
      });
    
    // Enhanced transcription handling with better speaker attribution
    session.on('input_speech_transcription_completed', async (evt: { transcript: string }) => {
      console.log(`👤 [EnhancedAgent] Speech transcribed: "${evt.transcript}"`);
      
      // Enhanced speaker attribution logic
      let speakerId = 'unknown-speaker';
      
      // Priority 1: Use the most recently active speaker
      if (lastActiveSpeaker && participantAudioState.has(lastActiveSpeaker)) {
        speakerId = lastActiveSpeaker;
        console.log(`🎯 [EnhancedAgent] Attributed to primary active speaker: ${speakerId}`);
      }
      // Priority 2: Use any currently active speaker
      else if (allActiveSpeakers.length > 0) {
        speakerId = allActiveSpeakers[0];
        console.log(`🗣️ [EnhancedAgent] Attributed to active speaker: ${speakerId}`);
      }
      // Priority 3: Use the most recently seen participant
      else {
        let mostRecentParticipant = '';
        let mostRecentTime = 0;
        
        for (const [participantId, state] of participantAudioState) {
          if (state.isSubscribed && state.lastSeen > mostRecentTime) {
            mostRecentTime = state.lastSeen;
            mostRecentParticipant = participantId;
          }
        }
        
        if (mostRecentParticipant) {
          speakerId = mostRecentParticipant;
          console.log(`🕐 [EnhancedAgent] Attributed to most recent participant: ${speakerId}`);
        }
      }
      
      console.log(`🗣️ [EnhancedAgent] Final attribution: "${evt.transcript}" → ${speakerId}`);
      
      // Send transcription to frontend
      const transcriptionData = JSON.stringify({
        type: 'live_transcription',
        text: evt.transcript,
        speaker: speakerId,
        timestamp: Date.now(),
        is_final: true,
      });
      
      job.room.localParticipant?.publishData(
        new TextEncoder().encode(transcriptionData),
        { reliable: true, topic: 'transcription' }
      );
      
      // Process through decision engine
      await decisionEngine.processTranscript(evt.transcript, speakerId);
    });
    
    // Periodic audio state monitoring
    setInterval(() => {
      console.log('📊 [EnhancedAgent] Audio State Report:');
      for (const [participantId, state] of participantAudioState) {
        console.log(`  👤 ${participantId}: subscribed=${state.isSubscribed}, level=${state.audioLevel}, lastSeen=${Date.now() - state.lastSeen}ms ago`);
      }
      console.log(`  🗣️ Active speakers: [${allActiveSpeakers.join(', ')}]`);
      console.log(`  🎯 Primary speaker: ${lastActiveSpeaker || 'none'}`);
    }, 15000); // Every 15 seconds
    
    // Rest of the agent setup (decision engine, tool handling, etc.)
    decisionEngine.onDecision(async (decision, participantId, originalText) => {
      if (!decision.should_send) {
        console.log(`⏸️ [EnhancedAgent] Filtered out: "${originalText}" from ${participantId}`);
        return;
      }

      console.log(`✅ [EnhancedAgent] Sending to Tambo: "${decision.summary}" from ${participantId}`);
      
      const prompt = decision.summary && decision.summary.trim() ? decision.summary : originalText;
      
      const toolCallEvent = {
        id: `enhanced-speech-${Date.now()}`,
        roomId: job.room.name || 'unknown',
        type: 'tool_call',
        payload: {
          tool: 'generate_ui_component',
          params: {
            prompt: prompt,
            task_prompt: prompt
          },
          context: {
            source: 'voice',
            timestamp: Date.now(),
            transcript: originalText,
            summary: decision.summary,
            speaker: participantId,
            confidence: decision.confidence,
            reason: decision.reason
          }
        },
        timestamp: Date.now(),
        source: 'voice' as const,
      };

      job.room.localParticipant?.publishData(
        new TextEncoder().encode(JSON.stringify(toolCallEvent)),
        { reliable: true, topic: 'tool_call' }
      );

      // TODO: implement shape creation via canvasStore.updateStore when design is final
      try {
        const noteId = `shape:${nanoid()}`;
        const noteShape = {
          id: noteId,
          typeName: 'shape',
          type: 'note',
          parentId: 'page:page',
          childIndex: 1,
          x: Math.random() * 400,
          y: Math.random() * 300,
          rotation: 0,
          props: {
            text: (decision.summary || originalText) as string,
          },
        } as any;

        canvasStore.put([noteShape]);
        console.log('📝 [EnhancedAgent] Note shape created');
      } catch (err) {
        console.error('⚠️  [EnhancedAgent] Error creating note shape:', err);
      }
    });
    
    // Clean up on disconnect
    job.room.on('disconnected', () => {
      console.log('🧹 [EnhancedAgent] Cleaning up enhanced agent...');
      participantAudioState.clear();
      decisionEngine.clearAllBuffers();
    });
    
    console.log('🎯 [EnhancedAgent] Enhanced agent fully initialized with improved audio routing');
  },
});

// CLI runner
if (import.meta.url.startsWith('file:') && process.argv[1].endsWith('livekit-agent-worker-enhanced.ts')) {
  console.log('🎬 [EnhancedAgent] Starting enhanced worker...');
  
  const workerOptions = new WorkerOptions({ 
    agent: process.argv[1],
    agentName: 'tambo-voice-agent-enhanced', 
  });
  
  console.log('🔧 [EnhancedAgent] Enhanced worker configured');
  cli.runApp(workerOptions);
} 