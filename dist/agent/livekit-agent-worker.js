#!/usr/bin/env node
/**
 * Tambo Voice Agent - LiveKit Agent JS Implementation
 *
 * AGENT #1 of 3 in the Tambo Architecture
 * =======================================
 * This is the VOICE AGENT that runs as a Node.js worker process.
 *
 * Responsibilities:
 * - Capture voice input from users in LiveKit rooms
 * - Transcribe speech using OpenAI Realtime API
 * - Forward transcriptions to the Decision Engine (Agent #2)
 * - Publish tool calls to the Tool Dispatcher (Agent #3)
 * - Respond to users with text/voice based on results
 *
 * Data Flow:
 * 1. User speaks → This agent transcribes
 * 2. Transcription → Decision Engine (embedded)
 * 3. Filtered request → Tool call event
 * 4. Tool Dispatcher executes → Results come back
 * 5. Agent responds to user
 *
 * See docs/THREE_AGENT_ARCHITECTURE.md for complete details.
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
        let systemCapabilities = null;
        const queryCapabilities = async () => {
            return new Promise((resolve) => {
                console.log('🔍 [Agent] Querying system capabilities...');
                // Set up one-time listener for response
                const handleCapabilityResponse = (data) => {
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
                    }
                    catch {
                        // Ignore non-JSON messages
                    }
                };
                job.room.on('dataReceived', handleCapabilityResponse);
                // Send capability query
                const queryMessage = JSON.stringify({
                    type: 'capability_query',
                    timestamp: Date.now()
                });
                job.room.localParticipant?.publishData(new TextEncoder().encode(queryMessage), { reliable: true, topic: 'capability_query' });
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
        let stateSnapshot = null;
        // Query initial state snapshot from browser
        const queryStateSnapshot = async () => {
            try {
                const apiUrl = process.env.NEXT_PUBLIC_VERCEL_URL || 'http://localhost:3000';
                const response = await fetch(`${apiUrl}/api/registry/snapshot`);
                if (response.ok) {
                    stateSnapshot = (await response.json());
                    console.log('✅ [Agent] Received state snapshot:', {
                        stateCount: stateSnapshot?.snapshot.length || 0,
                        timestamp: new Date(stateSnapshot?.timestamp || 0).toISOString()
                    });
                }
            }
            catch (error) {
                console.log('⚠️ [Agent] Failed to query state snapshot:', error);
            }
        };
        // Query state on startup
        await queryStateSnapshot();
        // Listen for state updates via data channel
        const handleStateUpdate = (data) => {
            try {
                const message = JSON.parse(new TextDecoder().decode(data));
                if (message.kind && message.version !== undefined) {
                    // This looks like a StateEnvelope
                    console.log('📥 [Agent] State update received:', {
                        kind: message.kind,
                        id: message.id,
                        version: message.version
                    });
                    // Update local snapshot (simplified - in production, use proper state management)
                    if (stateSnapshot) {
                        const existingIndex = stateSnapshot.snapshot.findIndex(s => s.id === message.id);
                        if (existingIndex >= 0) {
                            // Update if newer version
                            if (stateSnapshot.snapshot[existingIndex].version < message.version) {
                                stateSnapshot.snapshot[existingIndex] = message;
                            }
                        }
                        else {
                            // Add new state
                            stateSnapshot.snapshot.push(message);
                        }
                    }
                }
            }
            catch {
                // Ignore non-JSON or non-state messages
            }
        };
        job.room.on('dataReceived', handleStateUpdate);
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
        // Check immediately and then every 30 seconds (instead of 10)
        setTimeout(checkRoomState, 1000);
        setInterval(checkRoomState, 30000);
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
        // Track the most recently active speaker in the room with enhanced debugging
        let lastActiveSpeaker = null;
        job.room.on('activeSpeakersChanged', (speakers) => {
            console.log(`🗣️ [Agent] Active speakers changed:`, {
                count: speakers.length,
                identities: speakers.map(s => s.identity),
                audioLevels: speakers.map(s => ({ identity: s.identity, level: s.audioLevel || 0 }))
            });
            if (speakers.length > 0) {
                const previousSpeaker = lastActiveSpeaker;
                lastActiveSpeaker = speakers[0].identity;
                console.log(`🎯 [Agent] Primary speaker changed: ${previousSpeaker} → ${lastActiveSpeaker}`);
            }
            else {
                console.log(`🔇 [Agent] No active speakers detected`);
            }
        });
        console.log('🧠 [Agent] Initializing OpenAI Realtime model...');
        // Build dynamic instructions based on available capabilities
        const buildInstructions = () => {
            const baseInstructions = `You are Tambo Voice Agent, a helpful AI assistant integrated with a powerful UI generation system.
        
      ARCHITECTURE AWARENESS:
      You are Agent #1 in a 3-agent system:
      - YOU (Voice Agent): Handle voice interactions and initiate tool calls
      - Decision Engine: Filters your transcriptions for actionable requests (embedded with you)
      - Tool Dispatcher: Executes tools in the browser and returns results
      
      Your tool calls are sent to the Tool Dispatcher in the browser, which has access to:
      - Tambo UI components for generating visual elements
      - MCP (Model Context Protocol) tools for external integrations
      - Direct browser APIs and canvas manipulation
        
        CRITICAL: Always respond with TEXT ONLY. Never use audio responses. All your responses should be in text format.
        
        IMPORTANT: When users ask for UI components, timers, or visual elements, DO NOT repeat their request back as text. The UI generation is handled automatically when they speak.`;
            // Add available tools from capabilities
            let toolSection = `\n\nYou have access to ${systemCapabilities?.tools?.length || 7} tools:`;
            if (systemCapabilities?.tools) {
                systemCapabilities.tools.forEach(tool => {
                    toolSection += `\n- ${tool.name}: ${tool.description}`;
                    if (tool.examples && tool.examples.length > 0) {
                        toolSection += `\n  Examples: ${tool.examples.slice(0, 2).join(', ')}`;
                    }
                });
                // Add summary of tool categories
                const mcpTools = systemCapabilities.tools.filter(t => t.name.startsWith('mcp_') || t.name.includes('search'));
                const uiTools = systemCapabilities.tools.filter(t => t.name.includes('component') || t.name.includes('update'));
                toolSection += `\n\nTool Categories:`;
                toolSection += `\n- UI Generation: ${uiTools.length} tools`;
                toolSection += `\n- MCP/External: ${mcpTools.length} tools`;
                toolSection += `\n- Total Available: ${systemCapabilities.tools.length} tools`;
            }
            else {
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
        
        IMPORTANT TOOL SELECTION RULES:
        - For ANY YouTube-related request (search, play, find videos), you MUST use the "youtube_search" tool
        - Do NOT use "web_search_exa" or any other web search tool for YouTube content
        - When users say "search youtube", "find video", "play video", "show video" - use "youtube_search"
        - For general web searches that are NOT about YouTube, you may use other search tools
        
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
        const decisionEngineConfig = systemCapabilities?.decisionEngine
            ? {
                intents: systemCapabilities.decisionEngine.intents || {},
                keywords: systemCapabilities.decisionEngine.keywords || {}
            }
            : {
                intents: {},
                keywords: {}
            };
        const decisionEngine = new DecisionEngine(process.env.OPENAI_API_KEY || '', decisionEngineConfig);
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
                // Remap function calls if needed
                let toolName = evt.name;
                // If OpenAI calls web_search_exa for YouTube content, remap to youtube_search
                if (toolName === 'web_search_exa') {
                    const query = args.query || args.search || args.q || '';
                    const queryLower = query.toLowerCase();
                    // Check if this is actually a YouTube search
                    if (queryLower.includes('youtube') ||
                        queryLower.includes('video') ||
                        queryLower.includes('ronaldo') || // Common YouTube searches
                        queryLower.includes('music') ||
                        queryLower.includes('tutorial')) {
                        console.log(`🔄 [Agent] Remapping web_search_exa → youtube_search for query: "${query}"`);
                        toolName = 'youtube_search';
                        // Remap args to match youtube_search expected format
                        args.query = query;
                        delete args.numResults; // Remove web_search_exa specific params
                    }
                }
                // Instead of executing directly, send to ToolDispatcher
                const toolCallEvent = {
                    id: evt.call_id,
                    roomId: job.room.name || 'unknown',
                    type: 'tool_call',
                    payload: {
                        tool: toolName,
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
                console.log(`✅ [Agent] Tool call dispatched:`, {
                    originalName: evt.name,
                    remappedName: toolName,
                    wasRemapped: evt.name !== toolName,
                    params: args
                });
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
                source: 'voice',
            };
            console.log(`📤 [Agent] Tool call event:`, JSON.stringify(toolCallEvent, null, 2));
            job.room.localParticipant?.publishData(new TextEncoder().encode(JSON.stringify(toolCallEvent)), { reliable: true, topic: 'tool_call' });
        });
        // Track participant rotation for better attribution (now using time-based rotation)
        // Track processed transcriptions to avoid duplicates
        const processedTranscriptions = new Set();
        // Subscribe to transcription events from all participants
        session.on('input_speech_transcription_completed', async (evt) => {
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
                }
                else {
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
                job.room.localParticipant?.publishData(new TextEncoder().encode(transcriptionData), { reliable: true, topic: 'transcription' });
                // Process through decision engine with participant ID
                await decisionEngine.processTranscript(evt.transcript, speakerId);
            }
            else {
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
    }
});
// CLI runner  
if (import.meta.url.startsWith('file:') && process.argv[1].endsWith('livekit-agent-worker.ts')) {
    console.log('🎬 [Agent] Starting agent worker...');
    const workerOptions = new WorkerOptions({
        agent: process.argv[1],
        agentName: 'tambo-voice-agent',
    });
    console.log('🔧 [Agent] Worker configured');
    cli.runApp(workerOptions);
}
//# sourceMappingURL=livekit-agent-worker.js.map