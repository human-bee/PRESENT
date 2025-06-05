#!/usr/bin/env node
"use strict";
/**
 * LiveKit Agent Worker
 *
 * This is a standalone Node.js worker that runs the LiveKit agent.
 * It should be run as a separate process, not imported by Next.js.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const agents_plugin_openai_1 = require("@livekit/agents-plugin-openai");
const dotenv = __importStar(require("dotenv"));
// Load environment variables
dotenv.config({ path: '.env.local' });
exports.default = new agents_1.Agent()
    .on('jobRequest', async (jobRequest) => {
    console.log('🤖 Received job request for room:', jobRequest.job.room.name);
    // Accept all job requests for now
    await jobRequest.accept();
})
    .on('jobStarted', async (job) => {
    console.log('🤖 Job started, connecting to room:', job.room.name);
    // Connect to the room
    await job.connect();
    console.log('✅ Connected to LiveKit room');
    // Initialize OpenAI components
    const openaiLLM = new agents_plugin_openai_1.LLM({
        model: 'gpt-4o-realtime-preview-2025-06-03',
    });
    const openaiSTT = new agents_plugin_openai_1.STT({
        model: 'whisper-1',
    });
    const openaiTTS = new agents_plugin_openai_1.TTS({
        model: 'tts-1',
        voice: 'alloy',
    });
    // Send test transcription after 2 seconds
    setTimeout(() => {
        const data = JSON.stringify({
            type: 'live_transcription',
            text: 'Hello! The TypeScript agent is connected and working!',
            speaker: 'tambo-voice-agent',
            timestamp: Date.now(),
            is_final: true,
        });
        job.room.localParticipant?.publishData(new TextEncoder().encode(data), { reliable: true, topic: 'transcription' });
        console.log('📤 Sent test transcription');
    }, 2000);
    // Handle incoming audio tracks
    job.room.on('trackSubscribed', (track, publication, participant) => {
        if (track.kind === 'audio') {
            console.log(`🎤 Subscribed to audio from ${participant.identity}`);
            // Send another test transcription
            const data = JSON.stringify({
                type: 'live_transcription',
                text: `I can hear audio from ${participant.identity}!`,
                speaker: 'tambo-voice-agent',
                timestamp: Date.now(),
                is_final: true,
            });
            job.room.localParticipant?.publishData(new TextEncoder().encode(data), { reliable: true, topic: 'transcription' });
        }
    });
    console.log('✅ Tambo Voice Agent ready');
});
//# sourceMappingURL=livekit-agent-worker.js.map