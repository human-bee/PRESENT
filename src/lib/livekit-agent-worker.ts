#!/usr/bin/env node
/**
 * Tambo Voice Agent - LiveKit Agent JS Implementation
 * 
 * A voice-enabled AI agent using LiveKit's real-time communication
 * infrastructure and OpenAI's Realtime API for natural conversations.
 */

import { config } from 'dotenv';
import { join } from 'path';

// Load environment variables from .env.local
config({ path: join(process.cwd(), '.env.local') });

import { defineAgent, JobContext, cli, WorkerOptions, llm, stt, tts, multimodal } from '@livekit/agents';
import * as openai from '@livekit/agents-plugin-openai';
import { executeTool, ToolName, AVAILABLE_TOOLS } from './livekit-agent-tools';

console.log('🚀 Starting Tambo Voice Agent Worker...');
console.log('🔧 Environment Check:');
console.log(`  - OpenAI API Key: ${process.env.OPENAI_API_KEY ? '✅ Present' : '❌ Missing'}`);
console.log(`  - LiveKit API Key: ${process.env.LIVEKIT_API_KEY ? '✅ Present' : '❌ Missing'}`);
console.log(`  - LiveKit URL: ${process.env.LIVEKIT_URL || process.env.NEXT_PUBLIC_LK_SERVER_URL || '❌ Missing'}`);

export default defineAgent({
  entry: async (job: JobContext) => {
    console.log(`🎉 [Agent] Job received! Joining room: ${job.room.name}`);
    console.log(`📊 [Agent] Room details:`, {
      roomName: job.room.name,
      remoteParticipantsCount: job.room.remoteParticipants.size,
      metadata: job.room.metadata || 'none',
      timestamp: new Date().toISOString()
    });
    
    await job.connect();
    console.log('✅ [Agent] Successfully connected to room!');
    
    console.log('🧠 [Agent] Initializing OpenAI Realtime model...');
    
    // Create the multimodal agent using OpenAI Realtime API
    const model = new openai.realtime.RealtimeModel({
      instructions: `You are Tambo Voice Agent, a helpful AI assistant.
        You have access to the following tools: ${AVAILABLE_TOOLS.join(', ')}.
        Listen carefully to the user and provide helpful responses.
        When appropriate, use your tools to assist the user.`,
      voice: 'alloy',
      model: 'gpt-4o-realtime-preview-2024-12-17',
    });
    
    console.log('🎙️ [Agent] Starting multimodal agent...');
    
    const agent = new multimodal.MultimodalAgent({ 
      model 
    });
    
    // Start the agent session
    const session = await agent
      .start(job.room)
      .then(session => {
        console.log('✅ [Agent] Multimodal agent started successfully!');
        
        // Send welcome message after agent is ready
        setTimeout(() => {
          const welcomeData = JSON.stringify({
            type: 'live_transcription',
            text: '🤖 Tambo Voice Agent connected! I can hear you and respond naturally. Just speak!',
            speaker: 'tambo-voice-agent',
            timestamp: Date.now(),
            is_final: true,
          });
          
          job.room.localParticipant?.publishData(
            new TextEncoder().encode(welcomeData),
            { reliable: true, topic: 'transcription' }
          );
          console.log('📤 [Agent] Welcome message sent');
        }, 1000);
        
        return session;
      })
      .catch(error => {
        console.error('❌ [Agent] Failed to start multimodal agent:', error);
        throw error;
      });
    
    // Subscribe to transcription events for logging and frontend display
    session.on('input_speech_transcription_completed', (evt: any) => {
      console.log(`👤 [Agent] User said: "${evt.text}"`);
      
      // Send transcription to frontend
      const transcriptionData = JSON.stringify({
        type: 'live_transcription',
        text: evt.text,
        speaker: 'user',
        timestamp: Date.now(),
        is_final: true,
      });
      
      job.room.localParticipant?.publishData(
        new TextEncoder().encode(transcriptionData),
        { reliable: true, topic: 'transcription' }
      );
    });
    
    // Log when agent responds
    session.on('response_content_completed', (evt: any) => {
      if (evt.content_type === 'text') {
        console.log(`🤖 [Agent] Assistant said: "${evt.text}"`);
        
        // Send agent response to frontend  
        const responseData = JSON.stringify({
          type: 'live_transcription',
          text: evt.text,
          speaker: 'tambo-voice-agent',
          timestamp: Date.now(),
          is_final: true,
        });
        
        job.room.localParticipant?.publishData(
          new TextEncoder().encode(responseData),
          { reliable: true, topic: 'transcription' }
        );
      }
    });
    
    // Set up RPC method for tool calls from frontend
    job.room.localParticipant?.registerRpcMethod('agent_tool_call', async (data) => {
      try {
        const request = JSON.parse(data.payload);
        console.log('🔧 [Agent] Received tool call:', {
          tool: request.tool_name,
          hasParams: !!request.params,
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
        
        console.log(`✅ [Agent] Tool ${request.tool_name} executed successfully`);
        
        return JSON.stringify(result);
      } catch (error) {
        console.error('❌ [Agent] Error handling RPC tool call:', error);
        return JSON.stringify({
          status: 'ERROR',
          message: `RPC error: ${error instanceof Error ? error.message : 'Unknown error'}`
        });
      }
    });
    
    // Handle participant events
    job.room.on('participantConnected', (participant) => {
      console.log(`👤 [Agent] Participant joined: ${participant.identity}`);
    });
    
    job.room.on('participantDisconnected', (participant) => {
      console.log(`👋 [Agent] Participant left: ${participant.identity}`);
    });
    
    // Handle data messages from frontend
    job.room.on('dataReceived', (data, participant) => {
      try {
        const message = JSON.parse(new TextDecoder().decode(data));
        console.log(`📨 [Agent] Data received from ${participant?.identity}:`, {
          type: message.type,
          hasContent: !!message.content || !!message.text
        });
        
        // Handle text-based messages (voice is handled by the multimodal agent)
        if (message.type === 'user_message' || message.type === 'chat_message') {
          console.log(`💬 [Agent] User text message: "${message.content || message.text}"`);
          
          // For text messages, we acknowledge but remind user this is a voice agent
          const responseData = JSON.stringify({
            type: 'live_transcription',
            text: `I received your text: "${message.content || message.text}". For the best experience, try speaking to me!`,
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
    
    console.log('🎯 [Agent] Fully initialized with voice processing and tools');
  },
});

// Use the CLI runner if this file is being run directly
if (import.meta.url.startsWith('file:') && process.argv[1].endsWith('livekit-agent-worker.ts')) {
  console.log('🎬 [Agent] Starting worker...');
  
  // Configure worker options WITHOUT agent name for automatic dispatch
  const workerOptions = new WorkerOptions({ 
    agent: process.argv[1], // Path to this agent file
    // Removed agentName to enable automatic dispatch
  });
  
  console.log('🔧 [Agent] Worker configured for automatic dispatch');
  console.log('📡 [Agent] Connecting to LiveKit Cloud...');
  console.log('🌐 [Agent] LiveKit URL:', process.env.LIVEKIT_URL || process.env.NEXT_PUBLIC_LK_SERVER_URL);
  
  cli.runApp(workerOptions);
} 