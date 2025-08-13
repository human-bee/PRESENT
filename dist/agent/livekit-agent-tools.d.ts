/**
 * LiveKit Agent Tools - TypeScript Implementation
 *
 * Updated to use data channel events instead of RPC for better reliability
 * and integration with the ToolDispatcher system.
 */
import { JobContext } from '@livekit/agents';
export interface ToolResult {
    status: 'SUCCESS' | 'ERROR';
    message: string;
    [key: string]: unknown;
}
export type ToolName = 'do_nothing' | 'respond_with_voice' | 'generate_ui_component' | 'youtube_search' | 'mcp_tool';
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
 * Helper function to dispatch tool calls to the frontend via data channel.
 * This replaces the old RPC approach with a more reliable event-driven system.
 */
export declare function dispatchToolCall(job: JobContext, toolName: string, params?: Record<string, unknown>): Promise<ToolResult>;
/**
 * Generate a UI component using Tambo's generative UI system
 */
export declare function generateUIComponent(job: JobContext, componentType: string | undefined, prompt: string): Promise<ToolResult>;
/**
 * Call this tool when the conversation indicates a YouTube-related task is needed.
 *
 * This tool now includes smart search capabilities:
 * - Detects "latest/newest" keywords and prioritizes recent uploads
 * - Recognizes "official" requests and filters for verified channels
 * - Automatically picks the best video and creates a YoutubeEmbed component
 * - Special handling for known artists (e.g., PinkPantheress)
 *
 * Examples:
 * - "Show me the latest React tutorial" → Finds newest tutorial from verified channels
 * - "Play Pink Pantheress latest video" → Finds newest official video from her channel
 * - "Find official Taylor Swift music video" → Filters for VEVO/official channels only
 */
export declare function youtubeSearch(job: JobContext, query: string): Promise<ToolResult>;
/**
 * Call an MCP (Model Context Protocol) tool
 */
export declare function callMcpTool(job: JobContext, toolName: string, params?: Record<string, unknown>): Promise<ToolResult>;
/**
 * Tool registry for easy management
 */
export declare const AVAILABLE_TOOLS: readonly ["do_nothing", "respond_with_voice", "generate_ui_component", "youtube_search", "mcp_tool"];
/**
 * Execute a tool by name with parameters
 */
export declare function executeTool(toolName: ToolName, job: JobContext, params?: Record<string, unknown>): Promise<ToolResult>;
export declare const generateYoutubeTaskPrompt: typeof youtubeSearch;
export declare const sendTaskToFrontend: typeof dispatchToolCall;
//# sourceMappingURL=livekit-agent-tools.d.ts.map