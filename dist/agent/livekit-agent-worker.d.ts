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
declare const _default: import("@livekit/agents").Agent;
export default _default;
//# sourceMappingURL=livekit-agent-worker.d.ts.map