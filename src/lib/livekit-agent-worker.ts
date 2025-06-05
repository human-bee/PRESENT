#!/usr/bin/env node
/**
 * LiveKit Agent Worker
 * 
 * This is a standalone Node.js worker that runs the LiveKit agent.
 * It should be run as a separate process, not imported by Next.js.
 */

import { cli, defineAgent, JobContext } from '@livekit/agents';
import { STT, LLM, TTS } from '@livekit/agents-plugin-openai';
import { fileURLToPath } from 'url';
import { Track } from 'livekit-client';

console.log('🚀 Starting Tambo Voice Agent Worker...');
console.log('🔧 Environment Check:');
console.log(`  - OpenAI API Key: ${process.env.OPENAI_API_KEY ? '✅ Present' : '❌ Missing'}`);
console.log(`  - LiveKit API Key: ${process.env.LIVEKIT_API_KEY ? '✅ Present' : '❌ Missing'}`);
console.log(`  - LiveKit URL: ${process.env.LIVEKIT_URL || process.env.NEXT_PUBLIC_LK_SERVER_URL || '❌ Missing'}`);

const agent = defineAgent({
  entry: async (job: JobContext) => {
    const roomName = job.room.name;
    console.log(`🤖 [Agent] Initializing for room: ${roomName}`);
    
    try {
      // Connect to the room
      console.log(`🔌 [Agent] Connecting to room...`);
      await job.connect();
      console.log('✅ [Agent] Successfully connected to room');
      
      // Log initial room state
      console.log(`📊 [Agent] Initial Room State:`);
      console.log(`   - Room name: ${job.room.name}`);
      console.log(`   - Participants: ${job.room.remoteParticipants.size}`);
      
      // Set up OpenAI components for speech processing
      console.log('🧠 [Agent] Initializing OpenAI components...');
      
      const stt = new STT({
        model: 'whisper-1',
      });
      
      const llm = new LLM({
        model: 'gpt-4o-mini',
      });
      
      const tts = new TTS({
        model: 'tts-1',
        voice: 'alloy',
      });
      
      console.log('✅ [Agent] OpenAI components initialized');
      
      // Send initial test message to confirm agent is working
      setTimeout(() => {
        console.log('📤 [Agent] Sending initial test transcription...');
        const testData = JSON.stringify({
          type: 'live_transcription',
          text: '🤖 Tambo Voice Agent is now active and listening for speech!',
          speaker: 'tambo-voice-agent',
          timestamp: Date.now(),
          is_final: true,
        });
        
        try {
          job.room.localParticipant?.publishData(
            new TextEncoder().encode(testData), 
            { reliable: true }
          );
          console.log('✅ [Agent] Test transcription sent');
        } catch (error) {
          console.error('❌ [Agent] Failed to send test transcription:', error);
        }
      }, 3000);
      
      // Enhanced participant tracking
      job.room.on('participantConnected', (participant) => {
        console.log(`👤 [Agent] Participant joined: ${participant.identity} (${participant.name || 'no name'})`);
        console.log(`   - Participant SID: ${participant.sid}`);
        console.log(`   - Participant metadata: ${participant.metadata || 'none'}`);
        
        // Send welcome message
        setTimeout(() => {
          const welcomeData = JSON.stringify({
            type: 'live_transcription',
            text: `Welcome ${participant.identity}! I'm listening for your speech.`,
            speaker: 'tambo-voice-agent',
            timestamp: Date.now(),
            is_final: true,
          });
          
          try {
            job.room.localParticipant?.publishData(
              new TextEncoder().encode(welcomeData), 
              { reliable: true }
            );
            console.log(`📤 [Agent] Sent welcome message to ${participant.identity}`);
          } catch (error) {
            console.error(`❌ [Agent] Failed to send welcome message to ${participant.identity}:`, error);
          }
        }, 1000);
      });
      
      job.room.on('participantDisconnected', (participant) => {
        console.log(`👋 [Agent] Participant left: ${participant.identity}`);
      });
      
      // Enhanced track subscription handling
      job.room.on('trackSubscribed', (track, publication, participant) => {
        console.log(`🎵 [Agent] Track subscribed from ${participant.identity}:`);
        console.log(`   - Track kind: ${track.kind}`);
        console.log(`   - Track SID: ${track.sid}`);
        console.log(`   - Publication SID: ${publication.sid}`);
        
        if (track.kind === Track.Kind.Audio) {
          console.log(`🎤 [Agent] Audio track detected from ${participant.identity}`);
          console.log(`   - Audio track details: ${JSON.stringify({
            sid: track.sid,
            kind: track.kind,
            source: publication.source
          })}`);
          
          // Send audio detection confirmation
          const audioData = JSON.stringify({
            type: 'live_transcription',
            text: `🎤 Now receiving audio from ${participant.identity}`,
            speaker: 'tambo-voice-agent',
            timestamp: Date.now(),
            is_final: true,
          });
          
          try {
            job.room.localParticipant?.publishData(
              new TextEncoder().encode(audioData), 
              { reliable: true }
            );
            console.log(`📤 [Agent] Sent audio detection confirmation for ${participant.identity}`);
          } catch (error) {
            console.error(`❌ [Agent] Failed to send audio detection confirmation for ${participant.identity}:`, error);
          }
          
          // Here we would start speech recognition on the audio track
          // For now, we'll simulate transcription events
          let transcriptionCount = 0;
          const simulateTranscription = () => {
            transcriptionCount++;
            const transcriptionData = JSON.stringify({
              type: 'live_transcription',
              text: `This is simulated transcription ${transcriptionCount} from ${participant.identity}`,
              speaker: participant.identity,
              timestamp: Date.now(),
              is_final: transcriptionCount % 3 === 0, // Every third is final
            });
            
            try {
              job.room.localParticipant?.publishData(
                new TextEncoder().encode(transcriptionData), 
                { reliable: true }
              );
              console.log(`📝 [Agent] Sent simulated transcription ${transcriptionCount} for ${participant.identity}`);
            } catch (error) {
              console.error(`❌ [Agent] Failed to send simulated transcription for ${participant.identity}:`, error);
            }
          };
          
          // Simulate transcriptions every 5 seconds for demonstration
          const transcriptionInterval = setInterval(simulateTranscription, 5000);
          
          // Clean up interval when participant disconnects
          const cleanup = () => {
            clearInterval(transcriptionInterval);
            console.log(`🔇 [Agent] Stopped transcription simulation for ${participant.identity}`);
          };
          
          // Listen for participant disconnect to clean up
          job.room.on('participantDisconnected', (disconnectedParticipant) => {
            if (disconnectedParticipant.identity === participant.identity) {
              cleanup();
            }
          });
        }
      });
      
      job.room.on('trackUnsubscribed', (track, publication, participant) => {
        console.log(`🔇 [Agent] Track unsubscribed from ${participant.identity}: ${track.kind}`);
      });
      
      // Monitor room state
      const logRoomState = () => {
        console.log(`📊 [Agent] Room State Check:`);
        console.log(`   - Room name: ${job.room.name}`);
        console.log(`   - Remote participants: ${job.room.remoteParticipants.size}`);
        
        job.room.remoteParticipants.forEach((participant) => {
          console.log(`   - Remote participant: ${participant.identity}`);
          console.log(`     - Track publications: ${participant.trackPublications.size}`);
          
          let audioTracks = 0;
          let videoTracks = 0;
          participant.trackPublications.forEach((pub) => {
            if (pub.kind === Track.Kind.Audio) audioTracks++;
            if (pub.kind === Track.Kind.Video) videoTracks++;
            console.log(`     - Track ${pub.sid}: kind=${pub.kind}, subscribed=${pub.subscribed}`);
          });
          
          console.log(`     - Audio tracks: ${audioTracks}, Video tracks: ${videoTracks}`);
        });
      };
      
      // Log room state every 10 seconds
      setInterval(logRoomState, 10000);
      
      // Initial state log
      setTimeout(logRoomState, 2000);
      
      console.log('🎯 [Agent] Agent is fully active and listening for speech...');
      
    } catch (error) {
      console.error('❌ [Agent] Error during agent setup:', error);
      if (error instanceof Error) {
        console.error('   Error details:', {
          name: error.name,
          message: error.message,
          stack: error.stack,
        });
      }
      throw error;
    }
  },
});

// Only run if this file is executed directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log('🎬 [Agent] Starting CLI application...');
  cli.runApp({ agent });
} 