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
import { RoomEvent, Track } from 'livekit-client';
import * as openai from '@livekit/agents-plugin-openai';
import { DecisionEngine } from './decision-engine';
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
        // --- AUDIO DEBUG: Enhanced participant tracking ---------------------
        console.log('[TRACE] 👥 Participants when agent joined:', [...job.room.remoteParticipants.values()].map(p => p.identity));
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
        // Check immediately and then every 10 seconds
        setTimeout(checkRoomState, 1000);
        setInterval(checkRoomState, 10000);
        // ----------------------------------------------------------------
        // 1️⃣  every time a participant connects/disconnects
        job.room
            .on(RoomEvent.ParticipantConnected, p => console.log('[TRACE] participant connected', p.identity))
            .on(RoomEvent.ParticipantDisconnected, p => console.log('[TRACE] participant disconnected', p.identity));
        // 2️⃣  every time a remote audio publication appears
        job.room.on(RoomEvent.TrackPublished, async (pub, p) => {
            console.log('[TRACE] trackPublished', p.identity, pub.name || pub.trackName, pub.kind);
            if (pub.kind === Track.Kind.Audio || pub.kind === 'audio') {
                try {
                    await pub.setSubscribed(true);
                    console.log(`[SUCCESS] subscribed to ${p.identity}'s audio track`);
                }
                catch (err) {
                    console.error('[ERROR] could not subscribe to', p.identity, err);
                }
            }
        });
        // Track the most recently active speaker in the room
        let lastActiveSpeaker = null;
        job.room.on('activeSpeakersChanged', (speakers) => {
            if (speakers.length > 0) {
                lastActiveSpeaker = speakers[0].identity;
            }
        });
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
            model: 'gpt-4o-realtime-preview',
            modalities: ['text'],
        });
        console.log('🎙️ [Agent] Starting multimodal agent...');
        // Initialize Decision Engine
        const decisionEngine = new DecisionEngine(process.env.OPENAI_API_KEY || '');
        console.log('🧠 [Agent] Decision Engine initialized');
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
            // Forward the summary to Tambo
            const toolCallEvent = {
                id: `smart-speech-${Date.now()}`,
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
                source: 'voice',
            };
            console.log(`📤 [Agent] Tool call event:`, JSON.stringify(toolCallEvent, null, 2));
            job.room.localParticipant?.publishData(new TextEncoder().encode(JSON.stringify(toolCallEvent)), { reliable: true, topic: 'tool_call' });
        });
        // Track participant rotation for better attribution
        let participantRotationIndex = 0;
        // Subscribe to transcription events from all participants
        session.on('input_speech_transcription_completed', async (evt) => {
            console.log(`👤 [Agent] Speech transcribed: "${evt.transcript}"`);
            // Determine the speaker using LiveKit's active speaker info if available
            let speakerId = lastActiveSpeaker || 'unknown-speaker';
            if (!lastActiveSpeaker && job.room.remoteParticipants.size > 0) {
                const participants = Array.from(job.room.remoteParticipants.values());
                if (participants.length > 1) {
                    speakerId = participants[participantRotationIndex % participants.length]?.identity || 'participant-1';
                    participantRotationIndex++;
                }
                else {
                    speakerId = participants[0]?.identity || 'participant-1';
                }
            }
            console.log(`🗣️ [Agent] Attributed speech to: ${speakerId}`);
            // Send transcription to frontend for display
            const transcriptionData = JSON.stringify({
                type: 'live_transcription',
                text: evt.transcript,
                speaker: speakerId,
                timestamp: Date.now(),
                is_final: true,
            });
            job.room.localParticipant?.publishData(new TextEncoder().encode(transcriptionData), { reliable: true, topic: 'transcription' });
            // Process through decision engine with participant ID
            await decisionEngine.processTranscript(evt.transcript, speakerId);
        });
        // Log participant connections for audio tracking
        job.room.on('participantConnected', (participant) => {
            console.log(`👤 [Agent] Participant joined: ${participant.identity} - will capture their audio via OpenAI Realtime`);
        });
        job.room.on('participantDisconnected', (participant) => {
            console.log(`👋 [Agent] Participant left: ${participant.identity}`);
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
        // Clean up decision engine on disconnect
        job.room.on('disconnected', () => {
            console.log('🧹 [Agent] Cleaning up decision engine...');
            decisionEngine.clearAllBuffers();
        });
        console.log('🎯 [Agent] Fully initialized with smart decision engine');
        // Ensure we receive audio from every participant
        const subscribeToAudio = async (publication, participant) => {
            if (publication.kind === Track.Kind.Audio || publication.kind === 'audio') {
                try {
                    await publication.setSubscribed(true);
                    console.log(`🔊 [Agent] Subscribed to ${participant.identity}'s audio track`);
                }
                catch (err) {
                    console.error(`❌ [Agent] Failed to subscribe to ${participant.identity}'s audio track:`, err);
                }
            }
        };
        // Subscribe to future tracks
        job.room.on(RoomEvent.TrackPublished, subscribeToAudio);
        // Subscribe to already-published tracks
        for (const participant of job.room.remoteParticipants.values()) {
            for (const publication of participant.trackPublications.values()) {
                await subscribeToAudio(publication, participant);
            }
        }
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
//# sourceMappingURL=livekit-agent-worker.js.map