/**
 * MCP Bridge - Connects components to existing MCP infrastructure
 * 
 * This bridges the gap between components and the MCP tools that Tambo already uses.
 * We're NOT reinventing the wheel - just exposing existing functionality to components.
 */

import { useTamboClient } from "@tambo-ai/react";
import { useCallback } from "react";

// Global MCP tool registry populated by the Tool Dispatcher
declare global {
	interface Window {
		__tambo_mcp_tools?: Record<string, any>;
		__tambo_tool_dispatcher?: {
			executeMCPTool: (toolName: string, params: any) => Promise<any>;
		};
		__mcp_ready_promise?: Promise<void>;
		callMcpTool?: (toolName: string, params: any) => Promise<any>;
	}
}

let resolveReady: (() => void) | null = null;

/**
 * Initialize the MCP bridge - called once when app starts
 * This connects components to the same MCP infrastructure Tambo uses
 */
export function initializeMCPBridge() {
	if (typeof window === 'undefined') return;

	if (!window.__mcp_ready_promise) {
		window.__mcp_ready_promise = new Promise<void>((resolve) => {
			resolveReady = resolve;
		});
	}

	// Create the bridge function that components will use
	window.callMcpTool = async (toolName: string, params: any) => {

		// Option 1: Use Tool Dispatcher if available
		if (window.__tambo_tool_dispatcher?.executeMCPTool) {
			return window.__tambo_tool_dispatcher.executeMCPTool(toolName, params);
		}

		// Option 2: Send via Tambo message (existing pattern)
		const event = new CustomEvent("tambo:executeMCPTool", {
			detail: {
				tool: toolName.startsWith('mcp_') ? toolName : `mcp_${toolName}`,
				params,
				origin: 'component-subagent'
			}
		});
		
		window.dispatchEvent(event);

		// Return a promise that resolves when we get a response
		return new Promise((resolve, reject) => {
			const responseHandler = (e: any) => {
				const { tool, result, error, resolved } = e.detail || {};
				const normalize = (s: string) => (s || '').toLowerCase().replace(/^mcp_/, '').trim();
				const requested = normalize(toolName);
				const responded = normalize(tool);
				const resolvedKey = normalize(resolved || '');

				// Match if the responded tool (or resolved key) matches requested (ignoring mcp_ prefix)
				if (responded === requested || (!!resolvedKey && resolvedKey === requested)) {
					window.removeEventListener('tambo:mcpToolResponse', responseHandler);
					if (error) reject(error);
					else resolve(result);
				}
			};

			window.addEventListener('tambo:mcpToolResponse', responseHandler);

			// Timeout after 30 seconds
			setTimeout(() => {
				window.removeEventListener('tambo:mcpToolResponse', responseHandler);
				reject(new Error(`MCP tool ${toolName} timed out`));
			}, 30000);
		});
	};

	console.log('[MCP Bridge] Initialized - components can now call MCP tools directly');
}

/** Expose a readiness promise so dispatchers can gate on MCP being available */
export async function waitForMcpReady(timeoutMs = 150): Promise<boolean> {
	if (typeof window === 'undefined') return true;
	try {
		const ready = window.__mcp_ready_promise;
		if (!ready) return true; // nothing to wait on
		await Promise.race([
			ready,
			new Promise((_, reject) => setTimeout(() => reject(new Error('mcp_ready_timeout')), timeoutMs))
		]);
		return true;
	} catch {
		return false;
	}
}

/** Mark MCP as ready (called when tools synced and registry available) */
export function markMcpReady() {
	if (typeof window === 'undefined') return;
	if (resolveReady) {
		resolveReady();
		resolveReady = null;
		console.log('[MCP Bridge] Ready');
	}
}

/**
 * Hook for components to call MCP tools directly
 * Uses the same infrastructure as Tambo
 */
export function useMCPTool() {
	const tambo = useTamboClient();

	const callTool = useCallback(async (toolName: string, params: any) => {
		// Ensure we have the prefix
		const fullToolName = toolName.startsWith('mcp_') ? toolName : `mcp_${toolName}`;
		
		console.log(`[useMCPTool] Calling ${fullToolName} with params:`, params);

		try {
			// Try direct window call first
			if (typeof window !== 'undefined' && window.callMcpTool) {
				return await window.callMcpTool(toolName, params);
			}

			// Fallback: Send as Tambo message
			if (tambo) {
				await tambo.sendMessage(`Execute MCP tool ${fullToolName} with params: ${JSON.stringify(params)}`);
				return { status: 'sent', message: 'MCP tool request sent via Tambo' };
			}

			throw new Error('No MCP bridge available');
		} catch (error) {
			console.error(`[useMCPTool] Error calling ${fullToolName}:`, error);
			throw error;
		}
	}, [tambo]);

	return { callTool };
}

/**
 * Register MCP tools for direct component access
 * Called by Tool Dispatcher when MCP tools are available
 */
export function registerMCPTools(tools: Record<string, any>) {
	if (typeof window === 'undefined') return;
	window.__tambo_mcp_tools = tools;
	console.log('[MCP Bridge] Registered MCP tools:', Object.keys(tools));
	// Mark ready once tools registered
	try { markMcpReady(); } catch {}
}
