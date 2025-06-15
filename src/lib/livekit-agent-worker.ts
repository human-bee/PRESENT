#!/usr/bin/env node
/**
 * Tambo Voice Agent - LiveKit Agent JS Implementation
 * 
 * Based on LiveKit Agent JS documentation patterns
 * Replaces the Python agent with TypeScript equivalent
 */

import { config } from 'dotenv';
import { join } from 'path';

// Load environment variables from .env.local
config({ path: join(process.cwd(), '.env.local') });

import { defineAgent, JobContext, cli, WorkerOptions } from '@livekit/agents';
// import { STT, LLM, TTS } from '@livekit/agents-plugin-openai';
import { executeTool, ToolName, AVAILABLE_TOOLS } from './livekit-agent-tools';

console.log('🚀 Starting Tambo Voice Agent Worker...');
console.log('🔧 Environment Check:');
console.log(`  - OpenAI API Key: ${process.env.OPENAI_API_KEY ? '✅ Present' : '❌ Missing'}`);
console.log(`  - LiveKit API Key: ${process.env.LIVEKIT_API_KEY ? '✅ Present' : '❌ Missing'}`);
console.log(`  - LiveKit URL: ${process.env.LIVEKIT_URL || process.env.NEXT_PUBLIC_LK_SERVER_URL || '❌ Missing'}`);

// Add manual dispatch polling system
async function checkForManualDispatch() {
  try {
    const fs = await import('fs/promises');
    const path = await import('path');
    
    const dispatchFile = path.join(process.cwd(), '.next/agent-dispatch.json');
    
    try {
      const dispatchData = JSON.parse(await fs.readFile(dispatchFile, 'utf-8'));
      
      if (dispatchData.status === 'pending') {
        console.log('🎯 [Agent] Manual dispatch request found, connecting directly...');
        
        // Mark as processing
        dispatchData.status = 'processing';
        await fs.writeFile(dispatchFile, JSON.stringify(dispatchData, null, 2));
        
        // Connect directly using the token
        await connectAgentDirectly(dispatchData);
        
        // Mark as completed
        dispatchData.status = 'completed';
        await fs.writeFile(dispatchFile, JSON.stringify(dispatchData, null, 2));
      }
    } catch (error) {
      if ((error as any).code !== 'ENOENT') {
        console.warn('⚠️ [Agent] Error checking dispatch file:', error);
      }
    }
  } catch (error) {
    console.warn('⚠️ [Agent] Manual dispatch check error:', error);
  }
}

// Direct agent connection function
async function connectAgentDirectly(dispatchData: any) {
  try {
    console.log(`🤖 [Agent] Connecting directly to room: ${dispatchData.roomName}`);
    
    // Create a mock job context for direct connection
    const mockJobContext = {
      room: null as any,
      connect: async () => {
        console.log('🔌 [Agent] Creating direct room connection...');
        
        // Import LiveKit room client
        const { Room } = await import('livekit-client');
        const room = new Room();
        
        // Set up event handlers
        room.on('connected', () => {
          console.log(`✅ [Agent] Direct connection successful to room: ${dispatchData.roomName}`);
          
          // Send welcome message
          const welcomeData = JSON.stringify({
            type: 'live_transcription',
            text: '🤖 Tambo Voice Agent connected directly with tools: ' + AVAILABLE_TOOLS.join(', '),
            speaker: 'tambo-voice-agent',
            timestamp: Date.now(),
            is_final: true,
          });
          
          room.localParticipant?.publishData(
            new TextEncoder().encode(welcomeData),
            { reliable: true, topic: 'transcription' }
          );
        });
        
        room.on('participantConnected', (participant) => {
          console.log(`👤 [Agent] Direct: Participant joined: ${participant.identity}`);
        });
        
        room.on('disconnected', () => {
          console.log(`🔌 [Agent] Direct: Disconnected from room: ${dispatchData.roomName}`);
        });
        
        // Connect using the token
        await room.connect(dispatchData.serverUrl, dispatchData.agentToken);
        console.log(`🎉 [Agent] Successfully connected directly to room: ${dispatchData.roomName}`);
        
        // Store room reference
        mockJobContext.room = room;
        
        return room;
      }
    };
    
    // Connect to the room
    await mockJobContext.connect();
    
    console.log(`✅ [Agent] Direct connection completed for room: ${dispatchData.roomName}`);
    
  } catch (error) {
    console.error('❌ [Agent] Direct connection failed:', error);
    throw error;
  }
}

// Start polling for manual dispatch requests
setInterval(checkForManualDispatch, 5000); // Check every 5 seconds
console.log('🔄 [Agent] Manual dispatch polling started');

export default defineAgent({
  entry: async (job: JobContext) => {
    console.log(`🎉 [Agent] 🚨 AGENT DISPATCH RECEIVED! 🚨 Joining room: ${job.room.name}`);
    console.log(`🔍 [Agent] Room details:`, {
      roomName: job.room.name,
      remoteParticipantsCount: job.room.remoteParticipants.size,
      timestamp: new Date().toISOString()
    });
    
    // Add detailed job context logging
    console.log(`📊 [Agent] Job Context:`, {
      room: {
        name: job.room.name,
        metadata: job.room.metadata || 'none'
      },
      timestamp: new Date().toISOString()
    });
    
    await job.connect();
    console.log('✅ [Agent] Successfully connected to room!');
    
    // Initialize AI components (will be used for actual STT/LLM/TTS processing)
    // const stt = new STT({ model: 'whisper-1' });
    // const llm = new LLM({ model: 'gpt-4o-mini' });
    // const tts = new TTS({ model: 'tts-1', voice: 'alloy' });
    
    console.log('🧠 [Agent] AI components ready (STT/LLM/TTS initialized when needed)');
    console.log('🔧 [Agent] Available tools:', AVAILABLE_TOOLS);
    
    // Set up RPC method for tool calls from frontend
    job.room.localParticipant?.registerRpcMethod('agent_tool_call', async (data) => {
      try {
        const request = JSON.parse(data.payload);
        console.log('🔧 [Agent] Received tool call:', {
          tool: request.tool_name,
          hasParams: !!request.params,
          participantCount: job.room.remoteParticipants.size
        });
        
        // Validate tool name
        if (!AVAILABLE_TOOLS.includes(request.tool_name as ToolName)) {
          console.warn(`⚠️ [Agent] Unknown tool requested: ${request.tool_name}`);
          return JSON.stringify({
            status: 'ERROR',
            message: `Unknown tool: ${request.tool_name}`,
            available_tools: AVAILABLE_TOOLS
          });
        }
        
        // Execute the requested tool
        const result = await executeTool(
          request.tool_name as ToolName,
          job,
          request.params || {}
        );
        
        console.log(`✅ [Agent] Tool ${request.tool_name} executed:`, {
          status: result.status,
          message: result.message.substring(0, 100)
        });
        
        return JSON.stringify(result);
      } catch (error) {
        console.error('❌ [Agent] Error handling RPC tool call:', error);
        return JSON.stringify({
          status: 'ERROR',
          message: `RPC error: ${error instanceof Error ? error.message : 'Unknown error'}`
        });
      }
    });
    
    // Set up RPC method for receiving frontend AI task responses  
    job.room.localParticipant?.registerRpcMethod('frontend_task_response', async (data) => {
      try {
        const response = JSON.parse(data.payload);
        console.log('📨 [Agent] Received frontend task response:', {
          taskType: response.task_type,
          status: response.status,
          hasResult: !!response.result
        });
        
        // You could store this response or forward it to other systems
        // For now, just acknowledge receipt
        return JSON.stringify({
          status: 'SUCCESS',
          message: 'Frontend task response received'
        });
      } catch (error) {
        console.error('❌ [Agent] Error handling frontend task response:', error);
        return JSON.stringify({
          status: 'ERROR',
          message: `Error processing task response: ${error}`
        });
      }
    });
    
    // Send welcome message after a delay
    setTimeout(() => {
      const welcomeData = JSON.stringify({
        type: 'live_transcription',
        text: '🤖 Tambo Voice Agent connected with tools: ' + AVAILABLE_TOOLS.join(', '),
        speaker: 'tambo-voice-agent',
        timestamp: Date.now(),
        is_final: true,
      });
      
      job.room.localParticipant?.publishData(
        new TextEncoder().encode(welcomeData),
        { reliable: true, topic: 'transcription' }
      );
      console.log('📤 [Agent] Welcome message sent');
    }, 2000);
    
    // Handle participant events
    job.room.on('participantConnected', (participant) => {
      console.log(`👤 [Agent] Participant joined: ${participant.identity}`);
      
      const welcomeMsg = JSON.stringify({
        type: 'live_transcription',
        text: `Welcome ${participant.identity}! I'm equipped with tools and ready to assist.`,
        speaker: 'tambo-voice-agent',
        timestamp: Date.now(),
        is_final: true,
      });
      
      job.room.localParticipant?.publishData(
        new TextEncoder().encode(welcomeMsg),
        { reliable: true, topic: 'transcription' }
      );
    });
    
    job.room.on('participantDisconnected', (participant) => {
      console.log(`👋 [Agent] Participant left: ${participant.identity}`);
    });
    
    // Handle audio tracks for transcription
    job.room.on('trackSubscribed', (track, publication, participant) => {
      if (track.kind && track.kind.toString() === 'audio') {
        console.log(`🎤 [Agent] Audio track from ${participant.identity}`);
        
        // Send audio detection confirmation
        const audioData = JSON.stringify({
          type: 'live_transcription',
          text: `🎤 Now listening to audio from ${participant.identity}`,
          speaker: 'tambo-voice-agent',
          timestamp: Date.now(),
          is_final: true,
        });
        
        job.room.localParticipant?.publishData(
          new TextEncoder().encode(audioData),
          { reliable: true, topic: 'transcription' }
        );
        
        // TODO: Implement real STT processing here
        // For now, simulate transcription with tool demonstration
        let count = 0;
        const interval = setInterval(async () => {
          count++;
          
          // Demonstrate tool usage every few transcriptions
          if (count === 3) {
            console.log('🔧 [Agent] Demonstrating do_nothing tool...');
            await executeTool('do_nothing', job);
          }
          
          const transcriptionData = JSON.stringify({
            type: 'live_transcription',
            text: `Transcription ${count} from ${participant.identity} - Agent ready with ${AVAILABLE_TOOLS.length} tools`,
            speaker: participant.identity,
            timestamp: Date.now(),
            is_final: count % 3 === 0,
          });
          
          job.room.localParticipant?.publishData(
            new TextEncoder().encode(transcriptionData),
            { reliable: true, topic: 'transcription' }
          );
        }, 5000);
        
        // Cleanup on disconnect
        job.room.on('participantDisconnected', (p) => {
          if (p.identity === participant.identity) {
            clearInterval(interval);
            console.log(`🔇 [Agent] Stopped transcription for ${participant.identity}`);
          }
        });
      }
    });
    
    // Handle data messages from frontend
    job.room.on('dataReceived', (data, participant) => {
      try {
        const message = JSON.parse(new TextDecoder().decode(data));
        console.log(`📨 [Agent] Data received from ${participant?.identity}:`, {
          type: message.type,
          hasContent: !!message.content || !!message.text
        });
        
        // Handle different types of data messages
        if (message.type === 'user_message' || message.type === 'chat_message') {
          // This is where you'd integrate with LLM for conversation
          console.log(`💬 [Agent] User message: "${message.content || message.text}"`);
          
          // Example: Echo back with tool suggestion
          const responseData = JSON.stringify({
            type: 'live_transcription',
            text: `I heard: "${message.content || message.text}". I can help with YouTube searches and more!`,
            speaker: 'tambo-voice-agent',
            timestamp: Date.now(),
            is_final: true,
          });
          
          job.room.localParticipant?.publishData(
            new TextEncoder().encode(responseData),
            { reliable: true, topic: 'transcription' }
          );
        }
      } catch (error) {
        console.error('❌ [Agent] Error processing data message:', error);
      }
    });
    
    console.log('🎯 [Agent] Fully initialized with tools and RPC communication');
  },
});

// Use the CLI runner which properly handles process forking
// Check if this file is being run directly
if (import.meta.url.startsWith('file:') && process.argv[1].endsWith('livekit-agent-worker.ts')) {
  console.log('🎬 [Agent] Starting...');
  
  // Configure worker options with the path to this agent file
  const workerOptions = new WorkerOptions({ 
    agent: process.argv[1] // Path to this agent file
  });
  
  console.log('🔧 [Agent] Worker configured for automatic room dispatch');
  console.log('📡 [Agent] Waiting for room events from LiveKit server...');
  console.log('💡 [Agent] When a participant joins a room, LiveKit will dispatch this agent automatically');
  console.log('🌐 [Agent] LiveKit URL:', process.env.LIVEKIT_URL);
  console.log('🔑 [Agent] API Key present:', !!process.env.LIVEKIT_API_KEY);
  
  // Add worker lifecycle logging
  console.log('🚀 [Agent] Starting worker registration with LiveKit Cloud...');
  
  cli.runApp(workerOptions);
} 