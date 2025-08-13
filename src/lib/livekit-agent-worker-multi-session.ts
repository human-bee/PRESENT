#!/usr/bin/env node
/**
 * Experimental Multi-Session Tambo Voice Agent
 * 
 * This approach creates separate OpenAI Realtime sessions for each participant
 * to solve the multi-participant transcription issue.
 */

import { config } from 'dotenv';
import { join } from 'path';

// Load environment variables from .env.local
config({ path: join(process.cwd(), '.env.local') });

import { defineAgent, JobContext, cli, WorkerOptions } from '@livekit/agents';
import { RoomEvent, Track } from 'livekit-client';
import * as openai from '@livekit/agents-plugin-openai';
import { DecisionEngine } from './decision-engine';

console.log('🚀 Starting Multi-Session Tambo Voice Agent Worker...');

// Track active sessions per participant
const participantSessions = new Map<string, any>();

export default defineAgent({
  entry: async (job: JobContext) => {
    console.log(`🎉 [MultiAgent] Job received! Joining room: ${job.room.name}`);
    
    await job.connect();
    console.log('✅ [MultiAgent] Successfully connected to room!');
    
    // Initialize Decision Engine
    const decisionEngine = new DecisionEngine(process.env.OPENAI_API_KEY || '');
    console.log('🧠 [MultiAgent] Decision Engine initialized');
    
    // Function to create a new session for a participant
    const createParticipantSession = async (participantId: string) => {
      console.log(`🎙️ [MultiAgent] Creating new session for participant: ${participantId}`);
      
      try {
        const model = new openai.realtime.RealtimeModel({
          instructions: `You are processing audio from participant ${participantId}. Transcribe their speech accurately.`,
          model: 'gpt-4o-realtime-preview',
          modalities: ['text'],
        });
        
        // Create a minimal session just for transcription
        const session = await model.connect();
        
        // Handle transcription for this specific participant
        session.on('input_speech_transcription_completed', async (evt: { transcript: string }) => {
          console.log(`👤 [MultiAgent] Speech from ${participantId}: "${evt.transcript}"`);
          
          // Send transcription to frontend
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
        
        participantSessions.set(participantId, session);
        console.log(`✅ [MultiAgent] Session created for ${participantId}`);
        
        return session;
      } catch (error) {
        console.error(`❌ [MultiAgent] Failed to create session for ${participantId}:`, error);
        return null;
      }
    };
    
    // Function to remove a participant session
    const removeParticipantSession = async (participantId: string) => {
      const session = participantSessions.get(participantId);
      if (session) {
        try {
          await session.disconnect();
          participantSessions.delete(participantId);
          console.log(`🧹 [MultiAgent] Session removed for ${participantId}`);
        } catch (error) {
          console.error(`❌ [MultiAgent] Error removing session for ${participantId}:`, error);
        }
      }
    };
    
    // Handle participant connections
    job.room.on(RoomEvent.ParticipantConnected, async (participant: any) => {
      console.log(`👤 [MultiAgent] Participant joined: ${participant.identity}`);
      await createParticipantSession(participant.identity);
    });
    
    job.room.on(RoomEvent.ParticipantDisconnected, async (participant: any) => {
      console.log(`👋 [MultiAgent] Participant left: ${participant.identity}`);
      await removeParticipantSession(participant.identity);
    });
    
    // Handle audio track subscriptions
    job.room.on(RoomEvent.TrackPublished, async (pub: any, participant: any) => {
      if (pub.kind === Track.Kind.Audio || pub.kind === 'audio') {
        try {
          await pub.setSubscribed(true);
          console.log(`🔊 [MultiAgent] Subscribed to ${participant.identity}'s audio`);
          
          // Ensure we have a session for this participant
          if (!participantSessions.has(participant.identity)) {
            await createParticipantSession(participant.identity);
          }
        } catch (err) {
          console.error(`❌ [MultiAgent] Failed to subscribe to ${participant.identity}'s audio:`, err);
        }
      }
    });
    
    // Create sessions for existing participants
    for (const participant of job.room.remoteParticipants.values()) {
      await createParticipantSession(participant.identity);
      
      // Subscribe to their audio tracks
      for (const publication of participant.trackPublications.values()) {
        if (publication.kind === 'audio') {
          try {
            await publication.setSubscribed(true);
            console.log(`🔊 [MultiAgent] Subscribed to existing ${participant.identity}'s audio`);
          } catch (err) {
            console.error(`❌ [MultiAgent] Failed to subscribe to existing ${participant.identity}'s audio:`, err);
          }
        }
      }
    }
    
    // Set up decision engine callback
    decisionEngine.onDecision(async (decision, participantId, originalText) => {
      if (!decision.should_send) {
        console.log(`⏸️ [MultiAgent] Filtered out: "${originalText}" from ${participantId}`);
        return;
      }

      console.log(`✅ [MultiAgent] Sending to Tambo: "${decision.summary}" from ${participantId}`);
      
      const prompt = decision.summary && decision.summary.trim() ? decision.summary : originalText;
      
      if (!prompt || prompt.trim() === '') {
        console.error(`❌ [MultiAgent] Empty prompt from ${participantId}`);
        return;
      }
      
      // Forward to Tambo
      const toolCallEvent = {
        id: `multi-speech-${Date.now()}`,
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
    });
    
    // Clean up on disconnect
    job.room.on('disconnected', async () => {
      console.log('🧹 [MultiAgent] Cleaning up all sessions...');
      for (const [participantId] of participantSessions) {
        await removeParticipantSession(participantId);
      }
      decisionEngine.clearAllBuffers();
    });
    
    console.log('🎯 [MultiAgent] Multi-session agent fully initialized');
  },
});

// CLI runner (same as original)
if (import.meta.url.startsWith('file:') && process.argv[1].endsWith('livekit-agent-worker-multi-session.ts')) {
  console.log('🎬 [MultiAgent] Starting multi-session worker...');
  
  const workerOptions = new WorkerOptions({ 
    agent: process.argv[1],
    agentName: 'tambo-voice-agent-multi', 
  });
  
  console.log('🔧 [MultiAgent] Multi-session worker configured');
  cli.runApp(workerOptions);
} 