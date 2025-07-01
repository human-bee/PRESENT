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

import { defineAgent, JobContext, cli, WorkerOptions, multimodal } from '@livekit/agents';
import { RoomEvent, Track } from 'livekit-client';
import * as openai from '@livekit/agents-plugin-openai';
import { DecisionEngine, DecisionEngineConfig } from './decision-engine';

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
    
    // Query system capabilities from the browser
    interface SystemCapabilities {
      tools: Array<{ name: string; description: string; examples?: string[] }>;
      decisionEngine: {
        intents: Record<string, string[]>;
        keywords: Record<string, string[]>;
      };
    }
    
    let systemCapabilities: SystemCapabilities | null = null;
    
    const queryCapabilities = async (): Promise<void> => {
      return new Promise((resolve) => {
        console.log('🔍 [Agent] Querying system capabilities...');
        
        // Set up one-time listener for response
        const handleCapabilityResponse = (data: Uint8Array) => {
          try {
            const message = JSON.parse(new TextDecoder().decode(data));
            if (message.type === 'capability_list') {
              systemCapabilities = message.capabilities;
              console.log('✅ [Agent] Received capabilities:', {
                tools: systemCapabilities?.tools.length || 0,
                intents: Object.keys(systemCapabilities?.decisionEngine.intents || {}).length,
                keywords: Object.keys(systemCapabilities?.decisionEngine.keywords || {}).length
              });
              job.room.off('dataReceived', handleCapabilityResponse);
              resolve();
            }
          } catch {
            // Ignore non-JSON messages
          }
        };
        
        job.room.on('dataReceived', handleCapabilityResponse);
        
        // Send capability query
        const queryMessage = JSON.stringify({
          type: 'capability_query',
          timestamp: Date.now()
        });
        
        job.room.localParticipant?.publishData(
          new TextEncoder().encode(queryMessage),
          { reliable: true, topic: 'capability_query' }
        );
        
        // Timeout after 5 seconds and continue with defaults
        setTimeout(() => {
          if (!systemCapabilities) {
            console.log('⚠️ [Agent] Capability query timed out, using defaults');
            job.room.off('dataReceived', handleCapabilityResponse);
            resolve();
          }
        }, 5000);
      });
    };
    
    // Query capabilities
    await queryCapabilities();
    
    // Set up periodic capability refresh (every 30 seconds)
    const capabilityRefreshInterval = setInterval(async () => {
      console.log('🔄 [Agent] Refreshing capabilities...');
      await queryCapabilities();
      
      // Update decision engine if capabilities changed
      if (systemCapabilities) {
        console.log('🔧 [Agent] New capabilities available, would update decision engine');
        // TODO: Add update method to DecisionEngine to reconfigure at runtime
      }
    }, 30000);
    
    // Clean up interval on disconnect
    job.room.once('disconnected', () => {
      clearInterval(capabilityRefreshInterval);
    });
    
    // --- AUDIO DEBUG: Enhanced participant tracking ---------------------
    console.log('[TRACE] 👥 Participants when agent joined:',
                [...job.room.remoteParticipants.values()].map(p => p.identity));
    
    // Check room state every few seconds to see who's really there
    const checkRoomState = () => {
      console.log('\n[TRACE] 🔍 Current room state:');
      console.log(`  📊 Total participants: ${job.room.remoteParticipants.size}`);
      for (const participant of job.room.remoteParticipants.values()) {
        console.log(`  👤 ${participant.identity}:`);
        console.log(`     - Track publications: ${participant.trackPublications.size}`);
        for (const pub of participant.trackPublications.values()) {
          console.log(`     - ${pub.kind} track`);
        }
      }
      console.log('');
    };
    
    // Check immediately and then every 30 seconds (instead of 10)
    setTimeout(checkRoomState, 1000);
    setInterval(checkRoomState, 30000);
    // ----------------------------------------------------------------

    // 1️⃣  every time a participant connects/disconnects
    job.room
      .on(RoomEvent.ParticipantConnected, p =>
          console.log('[TRACE] participant connected', p.identity))
      .on(RoomEvent.ParticipantDisconnected, p =>
          console.log('[TRACE] participant disconnected', p.identity));

    // 2️⃣  every time a remote audio publication appears
    job.room.on(RoomEvent.TrackPublished, async (pub: any, p: any) => {
      console.log('[TRACE] trackPublished',
                  p.identity, pub.name || pub.trackName, pub.kind);
      if (pub.kind === Track.Kind.Audio || pub.kind === 'audio') {
        try {
          await pub.setSubscribed(true);
          console.log(`[SUCCESS] subscribed to ${p.identity}'s audio track`);
        } catch (err) {
          console.error('[ERROR] could not subscribe to', p.identity, err);
        }
      }
    });
    
    // Track the most recently active speaker in the room with enhanced debugging
    let lastActiveSpeaker: string | null = null;
    job.room.on('activeSpeakersChanged', (speakers) => {
      console.log(`🗣️ [Agent] Active speakers changed:`, {
        count: speakers.length,
        identities: speakers.map(s => s.identity),
        audioLevels: speakers.map(s => ({ identity: s.identity, level: (s as any).audioLevel || 0 }))
      });
      
      if (speakers.length > 0) {
        const previousSpeaker = lastActiveSpeaker;
        lastActiveSpeaker = speakers[0].identity;
        console.log(`🎯 [Agent] Primary speaker changed: ${previousSpeaker} → ${lastActiveSpeaker}`);
      } else {
        console.log(`🔇 [Agent] No active speakers detected`);
      }
    });
    
    console.log('🧠 [Agent] Initializing OpenAI Realtime model...');
    
    // Build dynamic instructions based on available capabilities
    const buildInstructions = () => {
      const baseInstructions = `You are Tambo Voice Agent, a helpful AI assistant integrated with a powerful UI generation system.
        
        CRITICAL: Always respond with TEXT ONLY. Never use audio responses. All your responses should be in text format.
        
        IMPORTANT: When users ask for UI components, timers, or visual elements, DO NOT repeat their request back as text. The UI generation is handled automatically when they speak.`;
      
      // Add available tools from capabilities
      let toolSection = '\n\nYou have access to these tools:';
      if (systemCapabilities?.tools) {
        systemCapabilities.tools.forEach(tool => {
          toolSection += `\n- ${tool.name}: ${tool.description}`;
          if (tool.examples && tool.examples.length > 0) {
            toolSection += `\n  Examples: ${tool.examples.slice(0, 2).join(', ')}`;
          }
        });
      } else {
        // Fallback to default tools
        toolSection += `
        - generate_ui_component: Create ANY UI component (timers, charts, buttons, forms, etc.)
        - youtube_search: Search and display YouTube videos
        - mcp_tool: Access external tools via Model Context Protocol
        - ui_update: Update existing UI components (MUST call list_components first!)
        - list_components: List all current UI components to get their IDs
        - respond_with_voice: Speak responses when appropriate
        - do_nothing: When no action is needed`;
      }
      
      const endInstructions = `
        
        Always respond with text for:
        - Answering questions
        - Providing explanations
        - Casual conversation
        - Confirming actions that YOU perform
        
        DO NOT use voice to repeat UI requests like "Create a timer" or "Show me a chart" - these are handled automatically by the system.
        
        Remember: TEXT RESPONSES ONLY, even though you can hear audio input.`;
      
      return baseInstructions + toolSection + endInstructions;
    };
    
    // Create the multimodal agent using OpenAI Realtime API
    // Note: Tools will be handled through OpenAI's native function calling mechanism
    const model = new openai.realtime.RealtimeModel({
      instructions: buildInstructions(),
      model: 'gpt-4o-realtime-preview',
      modalities: ['text'] //add Audio input for Agent audio output, text only for transcription only
    });
    
    console.log('🎙️ [Agent] Starting multimodal agent...');
    
    // Initialize Decision Engine with dynamic configuration  
    const decisionEngineConfig: DecisionEngineConfig = (systemCapabilities as SystemCapabilities | null)?.decisionEngine 
      ? {
          intents: (systemCapabilities as unknown as SystemCapabilities).decisionEngine.intents || {},
          keywords: (systemCapabilities as unknown as SystemCapabilities).decisionEngine.keywords || {}
        }
      : {
          intents: {},
          keywords: {}
        };
    
    const decisionEngine = new DecisionEngine(
      process.env.OPENAI_API_KEY || '',
      decisionEngineConfig
    );
    
    console.log('🧠 [Agent] Decision Engine initialized with:', {
      intents: Object.keys(decisionEngineConfig.intents || {}).length,
      keywords: Object.keys(decisionEngineConfig.keywords || {}).length
    });
    
    // Configure agent to accept text responses when using tools
    const agent = new multimodal.MultimodalAgent({ 
      model,
      // Use a very high limit so the built-in check never throws
      maxTextResponseRetries: Number.MAX_SAFE_INTEGER
    });
    
    // Start the agent session
    const session = await agent
      .start(job.room)
      .then(session => {
        console.log('✅ [Agent] Multimodal agent started successfully!');
        
        // Note: Tools are configured through OpenAI Realtime API's native function calling
        // The session.on('response_function_call_completed') handler below processes tool calls
        console.log('🔧 [Agent] Using OpenAI Realtime API native function calling');
        
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
        
        // Override recoverFromTextResponse to turn it into a no-op so text responses are fine
        (session as unknown as { recoverFromTextResponse: () => void }).recoverFromTextResponse = () => {};
        
        return session;
      })
      .catch(error => {
        console.error('❌ [Agent] Failed to start multimodal agent:', error);
        throw error;
      });
    
    // Handle text-only responses from the model
    session.on('response_content_done', (evt: { contentType: string; text: string; itemId: string }) => {
      if (evt.contentType === 'text') {
        console.log(`📝 [Agent] Text-only response received: "${evt.text}"`);
        
        // Only log the text response - don't send it as a tool call
        // The user's actual speech is already being sent to Tambo
        
        // Send as transcription for display
        const transcriptionData = JSON.stringify({
          type: 'live_transcription',
          text: evt.text,
          speaker: 'tambo-voice-agent',
          timestamp: Date.now(),
          is_final: true,
        });
        
        job.room.localParticipant?.publishData(
          new TextEncoder().encode(transcriptionData),
          { reliable: true, topic: 'transcription' }
        );
      }
    });
    
    // Handle function calls from the agent
    session.on('response_function_call_completed', async (evt: { 
      call_id: string; 
      name: string; 
      arguments: string; 
    }) => {
      console.log(`🔧 [Agent] Function call completed: ${evt.name}`);
      try {
        const args = JSON.parse(evt.arguments);
        
        // Instead of executing directly, send to ToolDispatcher
        const toolCallEvent = {
          id: evt.call_id,
          roomId: job.room.name || 'unknown',
          type: 'tool_call',
          payload: {
            tool: evt.name,
            params: args,
            context: {
              source: 'voice',
              timestamp: Date.now(),
            }
          },
          timestamp: Date.now(),
          source: 'voice' as const,
        };
        
        // Publish to tool dispatcher
        await job.room.localParticipant?.publishData(
          new TextEncoder().encode(JSON.stringify(toolCallEvent)),
          { reliable: true, topic: 'tool_call' }
        );
        
        console.log(`✅ [Agent] Tool call dispatched:`, evt.name);
        
        // For now, return a placeholder result to keep the session going
        // The actual result will come from the tool dispatcher
        session.conversation.item.create({
          type: 'function_call_output',
          call_id: evt.call_id,
          output: JSON.stringify({ 
            status: 'DISPATCHED', 
            message: 'Tool call sent to dispatcher',
            timestamp: Date.now()
          })
        });
        
      } catch (error) {
        console.error(`❌ [Agent] Function call error:`, error);
        // Submit error result
        session.conversation.item.create({
          type: 'function_call_output',
          call_id: evt.call_id,
          output: JSON.stringify({ status: 'ERROR', message: String(error) })
        });
      }
    });
    
    // Set up decision engine callback to handle Tambo forwarding
    decisionEngine.onDecision(async (decision, participantId, originalText) => {
      if (!decision.should_send) {
        console.log(`⏸️ [Agent] Filtered out: "${originalText}" (confidence: ${decision.confidence}%)`);
        return;
      }

      console.log(`✅ [Agent] Sending to Tambo: "${decision.summary}" (confidence: ${decision.confidence}%)`);
      
      // Ensure we have a valid prompt - fallback to original text if summary is empty
      const prompt = decision.summary && decision.summary.trim() ? decision.summary : originalText;
      
      // Final safety check - should never happen but just in case
      if (!prompt || prompt.trim() === '') {
        console.error(`❌ [Agent] Empty prompt detected! Decision:`, decision, `OriginalText: "${originalText}"`);
        return;
      }
      
      console.log(`🔍 [Agent] Debug - prompt: "${prompt}", originalText: "${originalText}"`);
      
      // Determine the appropriate tool based on intent
      const tool = decision.intent === 'youtube_search' ? 'youtube_search' : 'generate_ui_component';
      
      // Forward the summary to Tambo with enhanced context
      const toolCallEvent = {
        id: `smart-speech-${Date.now()}`,
        roomId: job.room.name || 'unknown',
        type: 'tool_call',
        payload: {
          tool: tool,
          params: {
            prompt: prompt,
            task_prompt: prompt,
            query: decision.intent === 'youtube_search' ? (decision.structuredContext?.rawQuery || prompt) : undefined
          },
          context: {
            source: 'voice',
            timestamp: Date.now(),
            transcript: originalText,
            summary: decision.summary,
            speaker: participantId,
            confidence: decision.confidence,
            reason: decision.reason,
            intent: decision.intent,
            structuredContext: decision.structuredContext
          }
        },
        timestamp: Date.now(),
        source: 'voice' as const,
      };

      console.log(`📤 [Agent] Tool call event:`, JSON.stringify(toolCallEvent, null, 2));

      job.room.localParticipant?.publishData(
        new TextEncoder().encode(JSON.stringify(toolCallEvent)),
        { reliable: true, topic: 'tool_call' }
      );
    });

    // Track participant rotation for better attribution (now using time-based rotation)

    // Subscribe to transcription events from all participants
    session.on('input_speech_transcription_completed', async (evt: { transcript: string }) => {
      console.log(`👤 [Agent] Speech transcribed: "${evt.transcript}"`);
      
      // Debug current room state
      const participants = Array.from(job.room.remoteParticipants.values());
      console.log(`🔍 [Agent] Room state during transcription:`, {
        totalParticipants: participants.length,
        participantIdentities: participants.map(p => p.identity),
        lastActiveSpeaker: lastActiveSpeaker
      });

      // Determine the speaker using LiveKit's active speaker info if available
      let speakerId = lastActiveSpeaker || 'unknown-speaker';
      let attributionMethod = 'active-speaker';

      if (!lastActiveSpeaker && job.room.remoteParticipants.size > 0) {
        if (participants.length > 1) {
          // Slower rotation - change every 10 seconds instead of every transcription
          const slowRotationIndex = Math.floor(Date.now() / 10000) % participants.length;
          speakerId = participants[slowRotationIndex]?.identity || 'participant-1';
          attributionMethod = 'slow-rotation';
        } else {
          speakerId = participants[0]?.identity || 'participant-1';
          attributionMethod = 'single-participant';
        }
      }

      console.log(`🗣️ [Agent] Speech attribution:`, {
        transcript: evt.transcript,
        attributedTo: speakerId,
        method: attributionMethod,
        allParticipants: participants.map(p => p.identity)
      });
      
      // Create a unique key to check for duplicates
      const transcriptionKey = `${evt.transcript}-${Math.floor(Date.now() / 1000)}`;
      
      // Only process if this transcription hasn't been processed recently
      if (!processedTranscriptions.has(transcriptionKey)) {
        processedTranscriptions.add(transcriptionKey);
        
        // Clean up old entries after 5 seconds
        setTimeout(() => processedTranscriptions.delete(transcriptionKey), 5000);
        
        // Send transcription to frontend for display
        const transcriptionData = JSON.stringify({
          type: 'live_transcription',
          text: evt.transcript,
          speaker: speakerId,
          timestamp: Date.now(),
          is_final: true,
          agentId: job.room.localParticipant?.identity // Include agent ID for debugging
        });
        
        job.room.localParticipant?.publishData(
          new TextEncoder().encode(transcriptionData),
          { reliable: true, topic: 'transcription' }
        );
        
        // Process through decision engine with participant ID
        await decisionEngine.processTranscript(evt.transcript, speakerId);
      } else {
        console.log(`⏭️ [Agent] Skipping duplicate transcription: "${evt.transcript}"`);
      }
    });

    // Log participant connections for audio tracking
    job.room.on('participantConnected', (participant) => {
      console.log(`👤 [Agent] Participant joined: ${participant.identity} - will capture their audio via OpenAI Realtime`);
    });
    
    job.room.on('participantDisconnected', (participant) => {
      console.log(`👋 [Agent] Participant left: ${participant.identity}`);
    });
    
    // Log when agent responds
    session.on('response_content_completed', (evt: { content_type: string; text: string }) => {
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
    
    // Track processed transcriptions to avoid duplicates
    const processedTranscriptions = new Set<string>();
    
    // Listen for tool results from the frontend ToolDispatcher
    // This replaces the old RPC approach with data channel events
    const handleDataReceived = (data: Uint8Array, participant?: unknown, kind?: unknown, topic?: string) => {
      try {
        const message = JSON.parse(new TextDecoder().decode(data));
        
        // Handle tool results
        if (topic === 'tool_result' && message.type === 'tool_result') {
          console.log(`✅ [Agent] Tool result received:`, {
            toolCallId: message.toolCallId,
            executionTime: message.executionTime,
            hasResult: !!message.result
          });
          // Agent can process tool results if needed
        }
        
        // Handle tool errors
        if (topic === 'tool_error' && message.type === 'tool_error') {
          console.error(`❌ [Agent] Tool error received:`, {
            toolCallId: message.toolCallId,
            error: message.error
          });
          // Agent can handle tool errors if needed
        }
        
        // Check for transcriptions from other agents to avoid duplicates
        if (topic === 'transcription' && message.type === 'live_transcription' && message.speaker?.startsWith('agent-')) {
          const transcriptionKey = `${message.text}-${message.timestamp}`;
          processedTranscriptions.add(transcriptionKey);
        }
      } catch {
        // Not all data messages are JSON, so this is expected sometimes
      }
    };
    
    // Subscribe to tool result topics
    job.room.on('dataReceived', handleDataReceived);
    

    
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
    
    // Clean up decision engine on disconnect
    job.room.on('disconnected', () => {
      console.log('🧹 [Agent] Cleaning up decision engine...');
      decisionEngine.clearAllBuffers();
    });
    
    console.log('🎯 [Agent] Fully initialized with smart decision engine');

    // Ensure we receive audio from every participant
    const subscribeToAudio = async (publication: any, participant: any) => {
      if (publication.kind === Track.Kind.Audio || publication.kind === 'audio') {
        try {
          await publication.setSubscribed(true);
          console.log(`🔊 [Agent] Subscribed to ${participant.identity}'s audio track`);
        } catch (err) {
          console.error(`❌ [Agent] Failed to subscribe to ${participant.identity}'s audio track:`, err);
        }
      }
    };

    // Subscribe to future tracks
    job.room.on(RoomEvent.TrackPublished, subscribeToAudio as any);

    // Subscribe to already-published tracks
    for (const participant of job.room.remoteParticipants.values()) {
      for (const publication of participant.trackPublications.values()) {
        await subscribeToAudio(publication, participant);
      }
    }

    // Add auto-cleanup logic after participant connection/disconnection handlers
    // Disconnect the agent if no human participants remain in the room for >10 s
    const isHuman = (p: { identity: string; metadata?: string }) => {
      const id = p.identity.toLowerCase();
      const meta = (p.metadata || '').toLowerCase();
      return !(
        id.includes('agent') ||
        id.includes('bot') ||
        id.includes('ai') ||
        id.startsWith('tambo-voice-agent') ||
        meta.includes('agent') ||
        meta.includes('type":"agent')
      );
    };

    let disconnectTimer: NodeJS.Timeout | null = null;

    const scheduleOrCancelDisconnect = () => {
      const humanParticipants = Array.from(job.room.remoteParticipants.values()).filter(isHuman);

      if (humanParticipants.length === 0) {
        if (!disconnectTimer) {
          console.log('🧹 [Agent] Room is empty of humans. Scheduling disconnect in 10 s…');
          disconnectTimer = setTimeout(() => {
            console.log('🔌 [Agent] Disconnecting – no human participants remained for 10 s');
            // Cleanly disconnect the agent and exit the process so the worker shuts down
            try {
              job.room.disconnect();
            } catch (err) {
              console.error('⚠️ [Agent] Error during disconnect:', err);
            }
            process.exit(0);
          }, 10000);
        }
      } else if (disconnectTimer) {
        // Humans have (re)joined → cancel pending shutdown
        clearTimeout(disconnectTimer);
        disconnectTimer = null;
        console.log('🔄 [Agent] Human participant detected – canceling pending disconnect');
      }
    };

    // Monitor participant changes to trigger the above logic
    job.room.on(RoomEvent.ParticipantConnected, scheduleOrCancelDisconnect);
    job.room.on(RoomEvent.ParticipantDisconnected, scheduleOrCancelDisconnect);

    // Run at start in case the agent was dispatched into an already-empty room
    scheduleOrCancelDisconnect();
  },
});

// Use the CLI runner if this file is being run directly
if (import.meta.url.startsWith('file:') && process.argv[1].endsWith('livekit-agent-worker.ts')) {
  console.log('🎬 [Agent] Starting worker...');
  
  // Configure worker options WITH agent name for automatic dispatch
  const workerOptions = new WorkerOptions({ 
    agent: process.argv[1], // Path to this agent file
    agentName: 'tambo-voice-agent', // Register under this name so dispatcher can find it
  });
  
  console.log('🔧 [Agent] Worker configured for automatic dispatch');
  console.log('📡 [Agent] Connecting to LiveKit Cloud...');
  console.log('🌐 [Agent] LiveKit URL:', process.env.LIVEKIT_URL || process.env.NEXT_PUBLIC_LK_SERVER_URL);
  
  cli.runApp(workerOptions);
} 