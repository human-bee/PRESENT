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
import { defineAgent, cli, WorkerOptions, multimodal } from '@livekit/agents';
import * as openai from '@livekit/agents-plugin-openai';
console.log('🚀 Starting Tambo Voice Agent Worker...');
console.log('🔧 Environment Check:');
console.log(`  - OpenAI API Key: ${process.env.OPENAI_API_KEY ? '✅ Present' : '❌ Missing'}`);
console.log(`  - LiveKit API Key: ${process.env.LIVEKIT_API_KEY ? '✅ Present' : '❌ Missing'}`);
console.log(`  - LiveKit URL: ${process.env.LIVEKIT_URL || process.env.NEXT_PUBLIC_LK_SERVER_URL || '❌ Missing'}`);
export default defineAgent({
    entry: async (job) => {
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
            instructions: `You are Tambo Voice Agent, a helpful AI assistant integrated with a powerful UI generation system.
        
        IMPORTANT: When users ask for UI components, timers, or visual elements, DO NOT repeat their request back as text. The UI generation is handled automatically when they speak.
        
        You have access to these tools:
        - generate_ui_component: Create ANY UI component (timers, charts, buttons, forms, etc.) - Tambo knows about all available components
        - youtube_search: Search and display YouTube videos
        - mcp_tool: Access external tools via Model Context Protocol
        - respond_with_voice: Speak responses when appropriate
        - do_nothing: When no action is needed
        
        Only use voice responses for:
        - Answering questions
        - Providing explanations
        - Casual conversation
        - Confirming actions that YOU perform
        
        DO NOT use voice to repeat UI requests like "Create a timer" or "Show me a chart" - these are handled automatically by the system.`,
            voice: 'alloy',
            model: 'gpt-4o-realtime-preview',
        });
        console.log('🎙️ [Agent] Starting multimodal agent...');
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
            // Send welcome message after agent is ready
            setTimeout(() => {
                const welcomeData = JSON.stringify({
                    type: 'live_transcription',
                    text: '🤖 Tambo Voice Agent connected! I can hear you and respond naturally. Just speak!',
                    speaker: 'tambo-voice-agent',
                    timestamp: Date.now(),
                    is_final: true,
                });
                job.room.localParticipant?.publishData(new TextEncoder().encode(welcomeData), { reliable: true, topic: 'transcription' });
                console.log('📤 [Agent] Welcome message sent');
            }, 1000);
            // Override recoverFromTextResponse to turn it into a no-op so text responses are fine
            session.recoverFromTextResponse = () => { };
            return session;
        })
            .catch(error => {
            console.error('❌ [Agent] Failed to start multimodal agent:', error);
            throw error;
        });
        // Handle text-only responses from the model
        session.on('response_content_done', (evt) => {
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
                job.room.localParticipant?.publishData(new TextEncoder().encode(transcriptionData), { reliable: true, topic: 'transcription' });
            }
        });
        // Handle function calls from the agent
        session.on('response_function_call_completed', async (evt) => {
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
                    source: 'voice',
                };
                // Publish to tool dispatcher
                await job.room.localParticipant?.publishData(new TextEncoder().encode(JSON.stringify(toolCallEvent)), { reliable: true, topic: 'tool_call' });
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
            }
            catch (error) {
                console.error(`❌ [Agent] Function call error:`, error);
                // Submit error result
                session.conversation.item.create({
                    type: 'function_call_output',
                    call_id: evt.call_id,
                    output: JSON.stringify({ status: 'ERROR', message: String(error) })
                });
            }
        });
        // Subscribe to transcription events for logging and frontend display
        session.on('input_speech_transcription_completed', (evt) => {
            console.log(`👤 [Agent] User said: "${evt.transcript}"`);
            // Send transcription to frontend
            const transcriptionData = JSON.stringify({
                type: 'live_transcription',
                text: evt.transcript,
                speaker: 'user',
                timestamp: Date.now(),
                is_final: true,
            });
            job.room.localParticipant?.publishData(new TextEncoder().encode(transcriptionData), { reliable: true, topic: 'transcription' });
            // NEW: Send user's speech to Tambo as a tool call
            const toolCallEvent = {
                id: `user-speech-${Date.now()}`,
                roomId: job.room.name || 'unknown',
                type: 'tool_call',
                payload: {
                    tool: 'generate_ui_component',
                    params: {
                        prompt: evt.transcript,
                        task_prompt: evt.transcript
                    },
                    context: {
                        source: 'voice',
                        timestamp: Date.now(),
                        transcript: evt.transcript,
                        speaker: 'user'
                    }
                },
                timestamp: Date.now(),
                source: 'voice',
            };
            // Send user's speech to ToolDispatcher which will route to Tambo
            job.room.localParticipant?.publishData(new TextEncoder().encode(JSON.stringify(toolCallEvent)), { reliable: true, topic: 'tool_call' });
            console.log(`✅ [Agent] User speech sent to Tambo: "${evt.transcript}"`);
        });
        // Log when agent responds
        session.on('response_content_completed', (evt) => {
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
                job.room.localParticipant?.publishData(new TextEncoder().encode(responseData), { reliable: true, topic: 'transcription' });
            }
        });
        // Listen for tool results from the frontend ToolDispatcher
        // This replaces the old RPC approach with data channel events
        const handleDataReceived = (data, participant, kind, topic) => {
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
            }
            catch {
                // Not all data messages are JSON, so this is expected sometimes
            }
        };
        // Subscribe to tool result topics
        job.room.on('dataReceived', handleDataReceived);
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
                    job.room.localParticipant?.publishData(new TextEncoder().encode(responseData), { reliable: true, topic: 'transcription' });
                }
            }
            catch (error) {
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
//# sourceMappingURL=livekit-agent-worker.js.map