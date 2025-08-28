/**
 * LiveKit Agent Tools - TypeScript Implementation
 *
 * Updated to use data channel events instead of RPC for better reliability
 * and integration with the ToolDispatcher system.
 */

import { JobContext } from "@livekit/agents";

// Tool result interface
export interface ToolResult {
	status: "SUCCESS" | "ERROR";
	message: string;
	[key: string]: unknown;
}

// Tool names enum
export type ToolName =
	| "do_nothing"
	| "respond_with_voice"
	| "generate_ui_component"
	| "youtube_search"
	| "mcp_tool";

/**
 * Call this essential tool if, after analyzing the latest user turn and the overall conversation,
 * you determine that no other specific action, information retrieval, or task generation
 * is necessary or would meaningfully contribute to the conversation at this precise moment.
 * This is your default 'no-op' action.
 */
export async function doNothing(): Promise<ToolResult> {
	console.log('🔄 [Agent] Tool "do_nothing" called - no action required');
	return {
		status: "SUCCESS",
		message: "No action required at this time",
		action_taken: "none",
	};
}

/**
 * Use this tool ONLY when a user directly addresses you (the AI assistant) and asks
 * a question or makes a request that requires a spoken response that cannot be handled
 * by dispatching a task to the frontend AI.
 */
export async function respondWithVoice(
	job: JobContext,
	spokenMessage: string,
	justificationForSpeaking: string,
): Promise<ToolResult> {
	console.log(
		`🗣️ [Agent] Tool "respond_with_voice" called: "${spokenMessage.substring(0, 100)}..."`,
	);

	try {
		// Comment out or remove the TTS initialization to disable voice
		// const tts = new TTS({
		//   model: 'tts-1',
		//   voice: 'alloy',
		// });

		// Send voice response as data message (text only, no audio generation)
		const responseData = JSON.stringify({
			type: "agent_voice_response",
			text: spokenMessage,
			speaker: "voice-agent",
			timestamp: Date.now(),
			justification: justificationForSpeaking,
		});

		job.room.localParticipant?.publishData(
			new TextEncoder().encode(responseData),
			{ reliable: true, topic: "agent_response" },
		);

		console.log("✅ [Agent] Text response sent successfully (voice disabled)");
		return {
			status: "SUCCESS",
			message: "Text response sent (voice disabled)",
			spoken_message: spokenMessage,
			justification: justificationForSpeaking,
		};
	} catch (error) {
		console.error("❌ [Agent] Error sending response:", error);
		return {
			status: "ERROR",
			message: `Failed to send response: ${error}`,
		};
	}
}

/**
 * Helper function to dispatch tool calls to the frontend via data channel.
 * This replaces the old RPC approach with a more reliable event-driven system.
 */
export async function dispatchToolCall(
	job: JobContext,
	toolName: string,
	params: Record<string, unknown> = {},
): Promise<ToolResult> {
	try {
		const toolCallEvent = {
			id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
			roomId: job.room.name,
			type: "tool_call",
			payload: {
				tool: toolName,
				params,
			},
			timestamp: Date.now(),
			source: "voice" as const,
		};

		console.log(`📤 [Agent] Dispatching tool call: ${toolName}`, params);

		// Publish tool call event
		await job.room.localParticipant?.publishData(
			new TextEncoder().encode(JSON.stringify(toolCallEvent)),
			{ reliable: true, topic: "tool_call" },
		);

		// Note: The actual execution happens in the frontend ToolDispatcher
		// We'll receive results via tool_result events if needed

		console.log(`✅ [Agent] Tool call dispatched: ${toolName}`);
		return {
			status: "SUCCESS",
			message: `Tool '${toolName}' dispatched successfully`,
			toolCallId: toolCallEvent.id,
		};
	} catch (error) {
		console.error(`❌ [Agent] Error dispatching tool call:`, error);
		return {
			status: "ERROR",
			message: `Failed to dispatch tool: ${error}`,
		};
	}
}

/**
 * Generate a UI component using Tambo's generative UI system
 */
export async function generateUIComponent(
	job: JobContext,
	componentType: string = "auto",
	prompt: string,
): Promise<ToolResult> {
	console.log(
		`🎨 [Agent] Tool "generate_ui_component" called for ${componentType}`,
	);

	return dispatchToolCall(job, "generate_ui_component", {
		componentType,
		prompt,
	});
}

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
export async function youtubeSearch(
	job: JobContext,
	query: string,
): Promise<ToolResult> {
	console.log('🎥 [Agent] Tool "youtube_search" called with query:', query);

	return dispatchToolCall(job, "youtube_search", {
		query,
	});
}

/**
 * Call an MCP (Model Context Protocol) tool
 */
export async function callMcpTool(
	job: JobContext,
	toolName: string,
	params: Record<string, unknown> = {},
): Promise<ToolResult> {
	console.log(`🔌 [Agent] Tool "mcp_tool" called: ${toolName}`);

	return dispatchToolCall(job, `mcp_${toolName}`, params);
}

/**
 * Tool registry for easy management
 */
export const AVAILABLE_TOOLS = [
	"do_nothing",
	"respond_with_voice",
	"generate_ui_component",
	"youtube_search",
	"mcp_tool",
] as const;

/**
 * Execute a tool by name with parameters
 */
export async function executeTool(
	toolName: ToolName,
	job: JobContext,
	params: Record<string, unknown> = {},
): Promise<ToolResult> {
	console.log(`🔧 [Agent] Executing tool: ${toolName} with params:`, params);

	switch (toolName) {
		case "do_nothing":
			return await doNothing();

		case "respond_with_voice":
			return await respondWithVoice(
				job,
				String(params.spoken_message || params.spokenMessage || ""),
				String(
					params.justification_for_speaking ||
						params.justificationForSpeaking ||
						"",
				),
			);

		case "generate_ui_component":
			return await generateUIComponent(
				job,
				String(params.component_type || params.componentType || "auto"),
				String(params.prompt || ""),
			);

		case "youtube_search":
			return await youtubeSearch(
				job,
				String(params.query || params.task_prompt || ""),
			);

		case "mcp_tool":
			return await callMcpTool(
				job,
				String(params.tool_name || params.toolName || ""),
				(params.params as Record<string, unknown>) || {},
			);

		default:
			return {
				status: "ERROR",
				message: `Unknown tool: ${toolName}`,
			};
	}
}

// For backward compatibility, export the old function names
export const generateYoutubeTaskPrompt = youtubeSearch;
export const sendTaskToFrontend = dispatchToolCall;
