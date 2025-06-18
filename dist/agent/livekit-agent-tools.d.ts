/**
 * LiveKit Agent Tools - TypeScript Implementation
 *
 * Ported from Python livekit-backend/tools.py
 * Provides tool functions for the Tambo Voice Agent
 */
import { JobContext } from '@livekit/agents';
interface ToolResult {
    status: 'SUCCESS' | 'ERROR';
    message: string;
    [key: string]: any;
}
/**
 * Call this essential tool if, after analyzing the latest user turn and the overall conversation,
 * you determine that no other specific action, information retrieval, or task generation
 * is necessary or would meaningfully contribute to the conversation at this precise moment.
 * This is your default 'no-op' action.
 */
export declare function doNothing(): Promise<ToolResult>;
/**
 * Use this tool ONLY when a user directly addresses you (the AI assistant) and asks
 * a question or makes a request that requires a spoken response that cannot be handled
 * by dispatching a task to the frontend AI.
 */
export declare function respondWithVoice(job: JobContext, spokenMessage: string, justificationForSpeaking: string): Promise<ToolResult>;
/**
 * Helper function to dispatch tasks to the frontend AI via RPC.
 */
export declare function sendTaskToFrontend(job: JobContext, taskType: string, taskPrompt: string, method?: string): Promise<ToolResult>;
/**
 * Call this tool when the conversation indicates a YouTube-related task is needed.
 * You must formulate a comprehensive 'action_plan' (as a natural language, multi-step text string)
 * based on the conversation and your knowledge of how the frontend's YouTube MCP server works.
 */
export declare function generateYoutubeTaskPrompt(job: JobContext, actionPlan: string): Promise<ToolResult>;
/**
 * Tool registry for easy management
 */
export declare const AVAILABLE_TOOLS: readonly ["do_nothing", "respond_with_voice", "generate_youtube_task_prompt"];
export type ToolName = typeof AVAILABLE_TOOLS[number];
/**
 * Execute a tool by name with parameters
 */
export declare function executeTool(toolName: ToolName, job: JobContext, params?: Record<string, any>): Promise<ToolResult>;
export {};
//# sourceMappingURL=livekit-agent-tools.d.ts.map