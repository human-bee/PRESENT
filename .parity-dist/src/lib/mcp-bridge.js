/**
 * MCP Bridge - Connects components to existing MCP infrastructure
 *
 * This bridges the gap between components and the MCP tools that custom already uses.
 * We're NOT reinventing the wheel - just exposing existing functionality to components.
 */
import { usecustomClient } from '@custom-ai/react';
import { useCallback } from 'react';
import { createLogger } from '@/lib/utils';
let resolveReady = null;
/**
 * Initialize the MCP bridge - called once when app starts
 * This connects components to the same MCP infrastructure custom uses
 */
export function initializeMCPBridge() {
    if (typeof window === 'undefined')
        return;
    if (!window.__mcp_ready_promise) {
        window.__mcp_ready_promise = new Promise((resolve) => {
            resolveReady = resolve;
        });
    }
    // Create the bridge function that components will use
    window.callMcpTool = async (toolName, params) => {
        // Option 1: Use Tool Dispatcher if available
        if (window.__custom_tool_dispatcher?.executeMCPTool) {
            return window.__custom_tool_dispatcher.executeMCPTool(toolName, params);
        }
        // Option 2: Send via custom message (existing pattern)
        const event = new CustomEvent('custom:executeMCPTool', {
            detail: {
                tool: toolName.startsWith('mcp_') ? toolName : `mcp_${toolName}`,
                params,
                origin: 'component-subagent',
            },
        });
        window.dispatchEvent(event);
        // Return a promise that resolves when we get a response
        return new Promise((resolve, reject) => {
            const responseHandler = (e) => {
                const { tool, result, error, resolved } = e.detail || {};
                const normalize = (s) => (s || '').toLowerCase().replace(/^mcp_/, '').trim();
                const requested = normalize(toolName);
                const responded = normalize(tool);
                const resolvedKey = normalize(resolved || '');
                // Match if the responded tool (or resolved key) matches requested (ignoring mcp_ prefix)
                if (responded === requested || (!!resolvedKey && resolvedKey === requested)) {
                    window.removeEventListener('custom:mcpToolResponse', responseHandler);
                    if (error)
                        reject(error);
                    else
                        resolve(result);
                }
            };
            window.addEventListener('custom:mcpToolResponse', responseHandler);
            // Timeout after 30 seconds
            setTimeout(() => {
                window.removeEventListener('custom:mcpToolResponse', responseHandler);
                reject(new Error(`MCP tool ${toolName} timed out`));
            }, 30000);
        });
    };
    try {
        const logger = createLogger('MCP');
        logger.once('bridge_init', '[MCP Bridge] Initialized - components can now call MCP tools directly');
    }
    catch { }
}
/** Expose a readiness promise so dispatchers can gate on MCP being available */
export async function waitForMcpReady(timeoutMs = 150) {
    if (typeof window === 'undefined')
        return true;
    try {
        const ready = window.__mcp_ready_promise;
        if (!ready)
            return true; // nothing to wait on
        await Promise.race([
            ready,
            new Promise((_, reject) => setTimeout(() => reject(new Error('mcp_ready_timeout')), timeoutMs)),
        ]);
        return true;
    }
    catch {
        return false;
    }
}
/** Mark MCP as ready (called when tools synced and registry available) */
export function markMcpReady() {
    if (typeof window === 'undefined')
        return;
    if (resolveReady) {
        resolveReady();
        resolveReady = null;
        try {
            const logger = createLogger('MCP');
            logger.info('[MCP Bridge] Ready');
        }
        catch { }
    }
}
/**
 * Hook for components to call MCP tools directly
 * Uses the same infrastructure as custom
 */
export function useMCPTool() {
    const custom = usecustomClient();
    const callTool = useCallback(async (toolName, params) => {
        // Ensure we have the prefix
        const fullToolName = toolName.startsWith('mcp_') ? toolName : `mcp_${toolName}`;
        const logger = createLogger('MCP');
        logger.debug(`[useMCPTool] Calling ${fullToolName} with params:`, params);
        try {
            // Try direct window call first
            if (typeof window !== 'undefined' && window.callMcpTool) {
                return await window.callMcpTool(toolName, params);
            }
            // Fallback: Send as custom message
            if (custom) {
                await custom.sendMessage(`Execute MCP tool ${fullToolName} with params: ${JSON.stringify(params)}`);
                return { status: 'sent', message: 'MCP tool request sent via custom' };
            }
            throw new Error('No MCP bridge available');
        }
        catch (error) {
            const logger = createLogger('MCP');
            logger.error(`[useMCPTool] Error calling ${fullToolName}:`, error);
            throw error;
        }
    }, [custom]);
    return { callTool };
}
/**
 * Register MCP tools for direct component access
 * Called by Tool Dispatcher when MCP tools are available
 */
export function registerMCPTools(tools) {
    if (typeof window === 'undefined')
        return;
    window.__custom_mcp_tools = tools;
    try {
        const logger = createLogger('MCP');
        logger.info('[MCP Bridge] Registered MCP tools:', Object.keys(tools));
    }
    catch { }
    // Mark ready once tools registered
    try {
        markMcpReady();
    }
    catch { }
}
//# sourceMappingURL=mcp-bridge.js.map