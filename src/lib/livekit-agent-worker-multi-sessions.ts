#!/usr/bin/env node
/**
 * Multi-Session Tambo Voice Agent - Multiple OpenAI Realtime Sessions
 * 
 * Creates separate OpenAI Realtime sessions for each participant to ensure
 * all audio is transcribed independently.
 */

import { config } from 'dotenv';
import { join } from 'path';

// Load environment variables from .env.local
config({ path: join(process.cwd(), '.env.local') });

import { defineAgent, JobContext, cli, WorkerOptions, multimodal } from '@livekit/agents';
import { RoomEvent, Track } from 'livekit-client';
import * as openai from '@livekit/agents-plugin-openai';
import { DecisionEngine } from './decision-engine';

console.log('🚀 Starting Multi-Session Tambo Voice Agent Worker...');

export default defineAgent({
  entry: async (job: JobContext) => {
    console.log(`🎉 [Multi-Session Agent] Job received! Joining room: ${job.room.name}`);
    
    await job.connect();
    console.log('✅ [Multi-Session Agent] Successfully connected to room!');
    
    // Track participants and their corresponding Realtime sessions
    const participantSessions = new Map<string, { 
      model: openai.realtime.RealtimeModel; 
      agent: multimodal.MultimodalAgent;
      session: any;
    }>();
    
    // Initialize Decision Engine
    const decisionEngine = new DecisionEngine(process.env.OPENAI_API_KEY || '');
    console.log('🧠 [Multi-Session Agent] Decision Engine initialized');
    
    // Function to create a new session for a participant
    const createParticipantSession = async (participantId: string) => {
      console.log(`🎙️ [Multi-Session Agent] Creating session for participant: ${participantId}`);
      
      const model = new openai.realtime.RealtimeModel({
        instructions: `You are transcribing audio for participant ${participantId}. Only transcribe speech, do not respond.`,
        model: 'gpt-4o-realtime-preview',
        modalities: ['text'],
      });
      
      const agent = new multimodal.MultimodalAgent({ 
        model,
        maxTextResponseRetries: Number.MAX_SAFE_INTEGER
      });
      
      try {
        const session = await agent.start(job.room);
        
        // Handle transcriptions from this specific participant
        session.on('input_speech_transcription_completed', async (evt: { transcript: string }) => {
          console.log(`👤 [${participantId}] Speech transcribed: "${evt.transcript}"`);
          
          // Send transcription to frontend for display
          const transcriptionData = JSON.stringify({
            type: 'live_transcription',
            text: evt.transcript,
            speaker: participantId,
            timestamp: Date.now(),
            is_final: true,
          });
          
          job.room.localParticipant?.publishData(
            new TextEncoder().encode(transcriptionData),
            { reliable: true, topic: 'transcription' }
          );
          
          // Process through decision engine
          await decisionEngine.processTranscript(evt.transcript, participantId);
        });
        
        // Store the session
        participantSessions.set(participantId, { model, agent, session });
        console.log(`✅ [Multi-Session Agent] Session created for ${participantId}`);
        
        return session;
      } catch (error) {
        console.error(`❌ [Multi-Session Agent] Failed to create session for ${participantId}:`, error);
        throw error;
      }
    };
    
    // Handle participant connections - create sessions for existing and new participants
    const handleParticipantConnection = async (participant: any) => {
      const participantId = participant.identity;
      
      if (!participantSessions.has(participantId)) {
        console.log(`🎯 [Multi-Session Agent] New participant detected: ${participantId}`);
        
        try {
          await createParticipantSession(participantId);
          
          // Subscribe to their audio tracks
          for (const publication of participant.trackPublications.values()) {
            if (publication.kind === Track.Kind.Audio || publication.kind === 'audio') {
              try {
                await publication.setSubscribed(true);
                console.log(`🔊 [Multi-Session Agent] Subscribed to ${participantId}'s audio for dedicated session`);
              } catch (err) {
                console.error(`❌ [Multi-Session Agent] Failed to subscribe to ${participantId}'s audio:`, err);
              }
            }
          }
        } catch (error) {
          console.error(`❌ [Multi-Session Agent] Failed to setup session for ${participantId}:`, error);
        }
      }
    };
    
    // Handle participant disconnections - cleanup sessions
    const handleParticipantDisconnection = (participant: any) => {
      const participantId = participant.identity;
      console.log(`👋 [Multi-Session Agent] Participant left: ${participantId}`);
      
      const sessionData = participantSessions.get(participantId);
      if (sessionData) {
        try {
          // Cleanup session resources
          sessionData.session?.end?.();
          participantSessions.delete(participantId);
          console.log(`🧹 [Multi-Session Agent] Cleaned up session for ${participantId}`);
        } catch (error) {
          console.error(`❌ [Multi-Session Agent] Error cleaning up session for ${participantId}:`, error);
        }
      }
    };
    
    // Set up event listeners
    job.room.on(RoomEvent.ParticipantConnected, handleParticipantConnection);
    job.room.on(RoomEvent.ParticipantDisconnected, handleParticipantDisconnection);
    
    // Handle existing participants
    for (const participant of job.room.remoteParticipants.values()) {
      await handleParticipantConnection(participant);
    }
    
    // Set up decision engine callback
    decisionEngine.onDecision(async (decision, participantId, originalText) => {
      if (!decision.should_send) {
        console.log(`⏸️ [Multi-Session Agent] Filtered out: "${originalText}" (confidence: ${decision.confidence}%)`);
        return;
      }

      console.log(`✅ [Multi-Session Agent] Sending to Tambo from ${participantId}: "${decision.summary}" (confidence: ${decision.confidence}%)`);
      
      const prompt = decision.summary && decision.summary.trim() ? decision.summary : originalText;
      
      if (!prompt || prompt.trim() === '') {
        console.error(`❌ [Multi-Session Agent] Empty prompt detected!`);
        return;
      }
      
      // Forward to Tambo with participant attribution
      const toolCallEvent = {
        id: `multi-session-${participantId}-${Date.now()}`,
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
            reason: decision.reason,
            session_type: 'multi-session'
          }
        },
        timestamp: Date.now(),
        source: 'voice' as const,
      };

      job.room.localParticipant?.publishData(
        new TextEncoder().encode(JSON.stringify(toolCallEvent)),
        { reliable: true, topic: 'tool_call' }
      );
    });
    
    // Clean up on disconnect
    job.room.on('disconnected', () => {
      console.log('🧹 [Multi-Session Agent] Cleaning up all sessions...');
      for (const [participantId, sessionData] of participantSessions.entries()) {
        try {
          sessionData.session?.end?.();
        } catch (error) {
          console.error(`❌ [Multi-Session Agent] Error cleaning up session for ${participantId}:`, error);
        }
      }
      participantSessions.clear();
      decisionEngine.clearAllBuffers();
    });
    
    console.log('🎯 [Multi-Session Agent] Fully initialized with separate sessions per participant');
    console.log(`📊 [Multi-Session Agent] Managing ${participantSessions.size} participant sessions`);
  },
});

// CLI runner
if (import.meta.url.startsWith('file:') && process.argv[1].endsWith('livekit-agent-worker-multi-sessions.ts')) {
  console.log('🎬 [Multi-Session Agent] Starting worker...');
  
  const workerOptions = new WorkerOptions({ 
    agent: process.argv[1],
    agentName: 'tambo-voice-agent-multi-sessions',
  });
  
  cli.runApp(workerOptions);
} 