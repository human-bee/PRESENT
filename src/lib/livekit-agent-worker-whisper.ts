#!/usr/bin/env node
/**
 * Experimental Whisper API Tambo Voice Agent
 * 
 * This approach uses traditional OpenAI Whisper API with audio chunking
 * to transcribe multiple participants separately.
 */

import { config } from 'dotenv';
import { join } from 'path';

// Load environment variables from .env.local
config({ path: join(process.cwd(), '.env.local') });

import { defineAgent, JobContext, cli, WorkerOptions } from '@livekit/agents';
import { RoomEvent, Track, RemoteAudioTrack } from 'livekit-client';
import { DecisionEngine } from './decision-engine';
import OpenAI from 'openai';

console.log('🚀 Starting Whisper API Tambo Voice Agent Worker...');

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Track audio processing per participant
const participantAudioProcessors = new Map<string, AudioProcessor>();

class AudioProcessor {
  private participantId: string;
  private audioChunks: Blob[] = [];
  private isProcessing = false;
  private processingInterval: NodeJS.Timeout | null = null;
  private decisionEngine: DecisionEngine;
  private room: any;

  constructor(participantId: string, decisionEngine: DecisionEngine, room: any) {
    this.participantId = participantId;
    this.decisionEngine = decisionEngine;
    this.room = room;
    this.startProcessing();
  }

  private startProcessing() {
    // Process audio every 5 seconds
    this.processingInterval = setInterval(async () => {
      if (this.audioChunks.length > 0 && !this.isProcessing) {
        await this.processAudioChunks();
      }
    }, 5000);
  }

  addAudioChunk(chunk: Blob) {
    this.audioChunks.push(chunk);
    // Keep only last 10 chunks to avoid memory issues
    if (this.audioChunks.length > 10) {
      this.audioChunks = this.audioChunks.slice(-10);
    }
  }

  private async processAudioChunks() {
    if (this.audioChunks.length === 0 || this.isProcessing) return;

    this.isProcessing = true;
    console.log(`🎧 [WhisperAgent] Processing ${this.audioChunks.length} audio chunks for ${this.participantId}`);

    try {
      // Combine all chunks into one blob
      const combinedBlob = new Blob(this.audioChunks, { type: 'audio/webm' });
      this.audioChunks = []; // Clear processed chunks

      // Convert blob to file for Whisper API
      const audioFile = new File([combinedBlob], `${this.participantId}-audio.webm`, {
        type: 'audio/webm'
      });

      // Transcribe using Whisper API
      const transcription = await openai.audio.transcriptions.create({
        file: audioFile,
        model: 'whisper-1',
        language: 'en', // Adjust as needed
        response_format: 'text',
      });

      if (transcription && transcription.trim()) {
        console.log(`👤 [WhisperAgent] Transcribed from ${this.participantId}: "${transcription}"`);

        // Send transcription to frontend
        const transcriptionData = JSON.stringify({
          type: 'live_transcription',
          text: transcription,
          speaker: this.participantId,
          timestamp: Date.now(),
          is_final: true,
        });

        this.room.localParticipant?.publishData(
          new TextEncoder().encode(transcriptionData),
          { reliable: true, topic: 'transcription' }
        );

        // Process through decision engine
        await this.decisionEngine.processTranscript(transcription, this.participantId);
      }
    } catch (error) {
      console.error(`❌ [WhisperAgent] Error processing audio for ${this.participantId}:`, error);
    } finally {
      this.isProcessing = false;
    }
  }

  destroy() {
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      this.processingInterval = null;
    }
    this.audioChunks = [];
  }
}

export default defineAgent({
  entry: async (job: JobContext) => {
    console.log(`🎉 [WhisperAgent] Job received! Joining room: ${job.room.name}`);
    
    await job.connect();
    console.log('✅ [WhisperAgent] Successfully connected to room!');
    
    // Initialize Decision Engine
    const decisionEngine = new DecisionEngine(process.env.OPENAI_API_KEY || '');
    console.log('🧠 [WhisperAgent] Decision Engine initialized');
    
    // Function to start audio processing for a participant
    const startAudioProcessing = async (participantId: string, audioTrack: RemoteAudioTrack) => {
      console.log(`🎙️ [WhisperAgent] Starting audio processing for: ${participantId}`);
      
      try {
        const processor = new AudioProcessor(participantId, decisionEngine, job.room);
        participantAudioProcessors.set(participantId, processor);

        // Get MediaStream from the audio track
        const mediaStream = audioTrack.mediaStream;
        if (!mediaStream) {
          console.error(`❌ [WhisperAgent] No media stream for ${participantId}`);
          return;
        }

        // Create MediaRecorder to capture audio
        const mediaRecorder = new MediaRecorder(mediaStream, {
          mimeType: 'audio/webm;codecs=opus'
        });

        mediaRecorder.ondataavailable = (event) => {
          if (event.data.size > 0) {
            processor.addAudioChunk(event.data);
          }
        };

        mediaRecorder.onerror = (event) => {
          console.error(`❌ [WhisperAgent] MediaRecorder error for ${participantId}:`, event);
        };

        // Record in 2-second chunks
        mediaRecorder.start(2000);
        
        console.log(`✅ [WhisperAgent] Audio processing started for ${participantId}`);
      } catch (error) {
        console.error(`❌ [WhisperAgent] Failed to start audio processing for ${participantId}:`, error);
      }
    };
    
    // Function to stop audio processing for a participant
    const stopAudioProcessing = (participantId: string) => {
      const processor = participantAudioProcessors.get(participantId);
      if (processor) {
        processor.destroy();
        participantAudioProcessors.delete(participantId);
        console.log(`🧹 [WhisperAgent] Audio processing stopped for ${participantId}`);
      }
    };
    
    // Handle participant connections
    job.room.on(RoomEvent.ParticipantConnected, (participant: any) => {
      console.log(`👤 [WhisperAgent] Participant joined: ${participant.identity}`);
    });
    
    job.room.on(RoomEvent.ParticipantDisconnected, (participant: any) => {
      console.log(`👋 [WhisperAgent] Participant left: ${participant.identity}`);
      stopAudioProcessing(participant.identity);
    });
    
    // Handle audio track subscriptions
    job.room.on(RoomEvent.TrackSubscribed, async (track: any, publication: any, participant: any) => {
      if (track.kind === 'audio') {
        console.log(`🔊 [WhisperAgent] Audio track subscribed from ${participant.identity}`);
        await startAudioProcessing(participant.identity, track);
      }
    });

    job.room.on(RoomEvent.TrackUnsubscribed, (track: any, publication: any, participant: any) => {
      if (track.kind === 'audio') {
        console.log(`🔇 [WhisperAgent] Audio track unsubscribed from ${participant.identity}`);
        stopAudioProcessing(participant.identity);
      }
    });
    
    // Handle audio track publications  
    job.room.on(RoomEvent.TrackPublished, async (pub: any, participant: any) => {
      if (pub.kind === Track.Kind.Audio || pub.kind === 'audio') {
        try {
          await pub.setSubscribed(true);
          console.log(`🔊 [WhisperAgent] Subscribed to ${participant.identity}'s audio`);
        } catch (err) {
          console.error(`❌ [WhisperAgent] Failed to subscribe to ${participant.identity}'s audio:`, err);
        }
      }
    });
    
    // Subscribe to existing participants' audio tracks
    for (const participant of job.room.remoteParticipants.values()) {
      for (const publication of participant.trackPublications.values()) {
        if (publication.kind === 'audio' && publication.track) {
          await startAudioProcessing(participant.identity, publication.track);
        }
      }
    }
    
    // Set up decision engine callback
    decisionEngine.onDecision(async (decision, participantId, originalText) => {
      if (!decision.should_send) {
        console.log(`⏸️ [WhisperAgent] Filtered out: "${originalText}" from ${participantId}`);
        return;
      }

      console.log(`✅ [WhisperAgent] Sending to Tambo: "${decision.summary}" from ${participantId}`);
      
      const prompt = decision.summary && decision.summary.trim() ? decision.summary : originalText;
      
      if (!prompt || prompt.trim() === '') {
        console.error(`❌ [WhisperAgent] Empty prompt from ${participantId}`);
        return;
      }
      
      // Forward to Tambo
      const toolCallEvent = {
        id: `whisper-speech-${Date.now()}`,
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
    job.room.on('disconnected', () => {
      console.log('🧹 [WhisperAgent] Cleaning up all audio processors...');
      for (const [participantId] of participantAudioProcessors) {
        stopAudioProcessing(participantId);
      }
      decisionEngine.clearAllBuffers();
    });
    
    console.log('🎯 [WhisperAgent] Whisper API agent fully initialized');
  },
});

// CLI runner
if (import.meta.url.startsWith('file:') && process.argv[1].endsWith('livekit-agent-worker-whisper.ts')) {
  console.log('🎬 [WhisperAgent] Starting Whisper API worker...');
  
  const workerOptions = new WorkerOptions({ 
    agent: process.argv[1],
    agentName: 'tambo-voice-agent-whisper', 
  });
  
  console.log('🔧 [WhisperAgent] Whisper API worker configured');
  cli.runApp(workerOptions);
} 