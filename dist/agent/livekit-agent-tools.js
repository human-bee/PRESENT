/**
 * LiveKit Agent Tools - TypeScript Implementation
 *
 * Ported from Python livekit-backend/tools.py
 * Provides tool functions for the Tambo Voice Agent
 */
import { TTS } from '@livekit/agents-plugin-openai';
/**
 * Call this essential tool if, after analyzing the latest user turn and the overall conversation,
 * you determine that no other specific action, information retrieval, or task generation
 * is necessary or would meaningfully contribute to the conversation at this precise moment.
 * This is your default 'no-op' action.
 */
export async function doNothing() {
    console.log('🔄 [Agent] Tool "do_nothing" called - no action required');
    return {
        status: 'SUCCESS',
        message: 'No action required at this time',
        action_taken: 'none'
    };
}
/**
 * Use this tool ONLY when a user directly addresses you (the AI assistant) and asks
 * a question or makes a request that requires a spoken response that cannot be handled
 * by dispatching a task to the frontend AI.
 */
export async function respondWithVoice(job, spokenMessage, justificationForSpeaking) {
    console.log(`🗣️ [Agent] Tool "respond_with_voice" called: "${spokenMessage.substring(0, 100)}..."`);
    try {
        // Initialize TTS for voice response
        const tts = new TTS({
            model: 'tts-1',
            voice: 'alloy',
        });
        // Send voice response as data message (in a real implementation, we'd use TTS to generate audio)
        const responseData = JSON.stringify({
            type: 'agent_voice_response',
            text: spokenMessage,
            speaker: 'tambo-voice-agent',
            timestamp: Date.now(),
            justification: justificationForSpeaking
        });
        job.room.localParticipant?.publishData(new TextEncoder().encode(responseData), { reliable: true, topic: 'agent_response' });
        console.log('✅ [Agent] Voice response sent successfully');
        return {
            status: 'SUCCESS',
            message: 'Voice response sent',
            spoken_message: spokenMessage,
            justification: justificationForSpeaking
        };
    }
    catch (error) {
        console.error('❌ [Agent] Error sending voice response:', error);
        return {
            status: 'ERROR',
            message: `Failed to send voice response: ${error}`
        };
    }
}
/**
 * Helper function to dispatch tasks to the frontend AI via RPC.
 */
export async function sendTaskToFrontend(job, taskType, taskPrompt, method = 'executeFrontendAITask') {
    const remoteParticipants = Array.from(job.room.remoteParticipants.values());
    if (remoteParticipants.length === 0) {
        console.warn(`⚠️ [Agent] Attempted to send '${taskType}' task, but no remote participants found.`);
        return {
            status: 'ERROR',
            message: 'No remote participants to send the task to.'
        };
    }
    for (const participant of remoteParticipants) {
        const payload = {
            task_type: taskType,
            task_prompt: taskPrompt,
        };
        console.log(`📤 [Agent] Dispatching task '${taskType}' to participant '${participant.identity}'. Prompt: ${taskPrompt.substring(0, 100)}...`);
        try {
            const response = await job.room.localParticipant?.performRpc({
                destinationIdentity: participant.identity,
                method: method,
                payload: JSON.stringify(payload),
                responseTimeout: 60000
            });
            console.log(`✅ [Agent] RPC response for task '${taskType}' from frontend:`, response);
            return {
                status: 'SUCCESS',
                message: `Task '${taskType}' successfully dispatched.`,
                frontend_response: response
            };
        }
        catch (error) {
            if (error instanceof Error && error.name === 'TimeoutError') {
                console.error(`⏰ [Agent] Timeout waiting for RPC response for task '${taskType}' from '${participant.identity}'.`);
                return {
                    status: 'ERROR',
                    message: `RPC timeout for task '${taskType}'.`
                };
            }
            else {
                console.error(`❌ [Agent] Error sending RPC for task '${taskType}' to '${participant.identity}':`, error);
                return {
                    status: 'ERROR',
                    message: `RPC error for task '${taskType}': ${error}`
                };
            }
        }
    }
    return {
        status: 'ERROR',
        message: 'Failed to send task to any participant'
    };
}
/**
 * Call this tool when the conversation indicates a YouTube-related task is needed.
 * You must formulate a comprehensive 'action_plan' (as a natural language, multi-step text string)
 * based on the conversation and your knowledge of how the frontend's YouTube MCP server works.
 */
export async function generateYoutubeTaskPrompt(job, actionPlan) {
    console.log('🎥 [Agent] Tool "generate_youtube_task_prompt" called. Dispatching action plan to frontend.');
    try {
        const result = await sendTaskToFrontend(job, 'Youtube', actionPlan, 'youtubeSearch');
        return result;
    }
    catch (error) {
        console.error('❌ [Agent] Error in generateYoutubeTaskPrompt:', error);
        return {
            status: 'ERROR',
            message: `Youtube task cancelled or failed: ${error}`
        };
    }
}
/**
 * Tool registry for easy management
 */
export const AVAILABLE_TOOLS = [
    'do_nothing',
    'respond_with_voice',
    'generate_youtube_task_prompt',
];
/**
 * Execute a tool by name with parameters
 */
export async function executeTool(toolName, job, params = {}) {
    console.log(`🔧 [Agent] Executing tool: ${toolName} with params:`, params);
    switch (toolName) {
        case 'do_nothing':
            return await doNothing();
        case 'respond_with_voice':
            return await respondWithVoice(job, params.spoken_message || params.spokenMessage, params.justification_for_speaking || params.justificationForSpeaking);
        case 'generate_youtube_task_prompt':
            return await generateYoutubeTaskPrompt(job, params.action_plan || params.actionPlan);
        default:
            return {
                status: 'ERROR',
                message: `Unknown tool: ${toolName}`
            };
    }
}
//# sourceMappingURL=livekit-agent-tools.js.map