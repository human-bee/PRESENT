#!/usr/bin/env node
"use strict";
/**
 * Tambo Voice Agent - LiveKit Agent JS Implementation
 *
 * Based on LiveKit Agent JS documentation patterns
 * Replaces the Python agent with TypeScript equivalent
 */
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv_1 = require("dotenv");
const path_1 = require("path");
// Load environment variables from .env.local
(0, dotenv_1.config)({ path: (0, path_1.join)(process.cwd(), '.env.local') });
const agents_1 = require("@livekit/agents");
// import { STT, LLM, TTS } from '@livekit/agents-plugin-openai';
const livekit_agent_tools_1 = require("./livekit-agent-tools");
console.log('🚀 Starting Tambo Voice Agent Worker...');
console.log('🔧 Environment Check:');
console.log(`  - OpenAI API Key: ${process.env.OPENAI_API_KEY ? '✅ Present' : '❌ Missing'}`);
console.log(`  - LiveKit API Key: ${process.env.LIVEKIT_API_KEY ? '✅ Present' : '❌ Missing'}`);
console.log(`  - LiveKit URL: ${process.env.LIVEKIT_URL || process.env.NEXT_PUBLIC_LK_SERVER_URL || '❌ Missing'}`);
exports.default = (0, agents_1.defineAgent)({
    entry: async (job) => {
        console.log(`🤖 [Agent] Joining room: ${job.room.name}`);
        await job.connect();
        console.log('✅ [Agent] Connected to room');
        // Initialize AI components (will be used for actual STT/LLM/TTS processing)
        // const stt = new STT({ model: 'whisper-1' });
        // const llm = new LLM({ model: 'gpt-4o-mini' });
        // const tts = new TTS({ model: 'tts-1', voice: 'alloy' });
        console.log('🧠 [Agent] AI components ready (STT/LLM/TTS initialized when needed)');
        console.log('🔧 [Agent] Available tools:', livekit_agent_tools_1.AVAILABLE_TOOLS);
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
                if (!livekit_agent_tools_1.AVAILABLE_TOOLS.includes(request.tool_name)) {
                    console.warn(`⚠️ [Agent] Unknown tool requested: ${request.tool_name}`);
                    return JSON.stringify({
                        status: 'ERROR',
                        message: `Unknown tool: ${request.tool_name}`,
                        available_tools: livekit_agent_tools_1.AVAILABLE_TOOLS
                    });
                }
                // Execute the requested tool
                const result = await (0, livekit_agent_tools_1.executeTool)(request.tool_name, job, request.params || {});
                console.log(`✅ [Agent] Tool ${request.tool_name} executed:`, {
                    status: result.status,
                    message: result.message.substring(0, 100)
                });
                return JSON.stringify(result);
            }
            catch (error) {
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
            }
            catch (error) {
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
                text: '🤖 Tambo Voice Agent connected with tools: ' + livekit_agent_tools_1.AVAILABLE_TOOLS.join(', '),
                speaker: 'tambo-voice-agent',
                timestamp: Date.now(),
                is_final: true,
            });
            job.room.localParticipant?.publishData(new TextEncoder().encode(welcomeData), { reliable: true, topic: 'transcription' });
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
            job.room.localParticipant?.publishData(new TextEncoder().encode(welcomeMsg), { reliable: true, topic: 'transcription' });
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
                job.room.localParticipant?.publishData(new TextEncoder().encode(audioData), { reliable: true, topic: 'transcription' });
                // TODO: Implement real STT processing here
                // For now, simulate transcription with tool demonstration
                let count = 0;
                const interval = setInterval(async () => {
                    count++;
                    // Demonstrate tool usage every few transcriptions
                    if (count === 3) {
                        console.log('🔧 [Agent] Demonstrating do_nothing tool...');
                        await (0, livekit_agent_tools_1.executeTool)('do_nothing', job);
                    }
                    const transcriptionData = JSON.stringify({
                        type: 'live_transcription',
                        text: `Transcription ${count} from ${participant.identity} - Agent ready with ${livekit_agent_tools_1.AVAILABLE_TOOLS.length} tools`,
                        speaker: participant.identity,
                        timestamp: Date.now(),
                        is_final: count % 3 === 0,
                    });
                    job.room.localParticipant?.publishData(new TextEncoder().encode(transcriptionData), { reliable: true, topic: 'transcription' });
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
                    job.room.localParticipant?.publishData(new TextEncoder().encode(responseData), { reliable: true, topic: 'transcription' });
                }
            }
            catch (error) {
                console.error('❌ [Agent] Error processing data message:', error);
            }
        });
        console.log('🎯 [Agent] Fully initialized with tools and RPC communication');
    },
});
if (require.main === module) {
    console.log('🎬 [Agent] Starting...');
    agents_1.cli.runApp(new agents_1.WorkerOptions({ agent: __filename }));
}
//# sourceMappingURL=livekit-agent-worker.js.map