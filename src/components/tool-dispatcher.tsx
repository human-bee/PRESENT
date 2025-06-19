/**
 * ToolDispatcher - Unified Tool Execution System
 * 
 * Centralizes all tool calls from the voice agent into a single dispatcher
 * that routes to appropriate handlers (Tambo UI, MCP tools, or direct actions).
 * 
 * ARCHITECTURE:
 * - Listens for tool_call events via LiveKit data channels (not RPC)
 * - Manages pending tool executions to prevent duplicates
 * - Publishes results back via data channel for agent consumption
 * - Integrates with existing Tambo thread system for UI generation
 * - Routes MCP tool calls through the MCP provider
 * 
 * This replaces the fragmented RPC approach with a unified event-driven system.
 */

"use client";

import { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { useDataChannel, useRoomContext } from '@livekit/components-react';
import { useTamboThreadInput } from '@tambo-ai/react';

// Generate unique IDs without external dependency
const generateId = () => `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

// Event types for the unified system
export const TOOL_TOPICS = {
  TRANSCRIPT: 'transcription',     // Existing topic for transcripts
  TOOL_CALL: 'tool_call',          // New: Agent requests tool execution
  TOOL_RESULT: 'tool_result',      // New: Tool execution results
  TOOL_ERROR: 'tool_error',        // New: Tool execution errors
  UI_UPDATE: 'ui_update',          // New: UI component updates
} as const;

// Tool call event structure
interface ToolCallEvent {
  id: string;
  roomId: string;
  type: 'tool_call';
  payload: {
    tool: string;
    params: Record<string, unknown>;
    context?: {
      transcript?: string;
      confidence?: number;
      speaker?: string;
    };
  };
  timestamp: number;
  source: 'voice' | 'text' | 'system';
}

// Tool result event structure
interface ToolResultEvent {
  id: string;
  toolCallId: string;
  type: 'tool_result';
  result: unknown;
  timestamp: number;
  executionTime?: number;
}

// Tool error event structure
interface ToolErrorEvent {
  id: string;
  toolCallId: string;
  type: 'tool_error';
  error: string;
  timestamp: number;
}

// Pending tool tracking
interface PendingTool {
  id: string;
  timestamp: number;
  status: 'pending' | 'executing' | 'completed' | 'failed';
  tool: string;
  params: Record<string, unknown>;
}

// Context for tool dispatcher
interface ToolDispatcherContextValue {
  pendingTools: Map<string, PendingTool>;
  executeToolCall: (event: ToolCallEvent) => Promise<void>;
  isProcessing: boolean;
}

const ToolDispatcherContext = createContext<ToolDispatcherContextValue>({
  pendingTools: new Map(),
  executeToolCall: async () => {},
  isProcessing: false,
});

export const useToolDispatcher = () => useContext(ToolDispatcherContext);

interface ToolDispatcherProps {
  children: React.ReactNode;
  enableLogging?: boolean;
  maxPendingAge?: number; // Max age for pending tools in ms
  contextKey?: string; // Context key for Tambo thread
}

export function ToolDispatcher({ 
  children, 
  enableLogging = true,
  maxPendingAge = 30000, // 30 seconds
  contextKey = 'canvas'
}: ToolDispatcherProps) {
  const room = useRoomContext();
  const { setValue, submit } = useTamboThreadInput(contextKey); // Use thread input to send messages
  const pendingById = useRef(new Map<string, PendingTool>());
  const [isProcessing, setIsProcessing] = useState(false);
  
  // Log helper with proper typing
  const log = useCallback((...args: unknown[]) => {
    if (enableLogging) {
      console.log('[ToolDispatcher]', ...args);
    }
  }, [enableLogging]);

  // Publish tool result back to agent
  const publishToolResult = useCallback(async (toolCallId: string, result: unknown) => {
    if (!room) return;
    
    const resultEvent: ToolResultEvent = {
      id: generateId(),
      toolCallId,
      type: 'tool_result',
      result,
      timestamp: Date.now(),
      executionTime: Date.now() - (pendingById.current.get(toolCallId)?.timestamp || Date.now()),
    };
    
    await room.localParticipant?.publishData(
      new TextEncoder().encode(JSON.stringify(resultEvent)),
      { reliable: true, topic: TOOL_TOPICS.TOOL_RESULT }
    );
    
    log('📤 Published tool result:', { toolCallId, executionTime: resultEvent.executionTime });
  }, [room, log]);

  // Publish tool error back to agent
  const publishToolError = useCallback(async (toolCallId: string, error: Error | string) => {
    if (!room) return;
    
    const errorEvent: ToolErrorEvent = {
      id: generateId(),
      toolCallId,
      type: 'tool_error',
      error: error instanceof Error ? error.message : error,
      timestamp: Date.now(),
    };
    
    await room.localParticipant?.publishData(
      new TextEncoder().encode(JSON.stringify(errorEvent)),
      { reliable: true, topic: TOOL_TOPICS.TOOL_ERROR }
    );
    
    log('❌ Published tool error:', { toolCallId, error: errorEvent.error });
  }, [room, log]);

  // Helper to send message through Tambo
  const sendTamboMessage = useCallback(async (message: string) => {
    setValue(message);
    await submit({
      contextKey,
      streamResponse: true,
    });
  }, [setValue, submit, contextKey]);

  // Execute tool call
  const executeToolCall = useCallback(async (event: ToolCallEvent) => {
    const { id, payload } = event;
    
    // Check for duplicate
    if (pendingById.current.has(id)) {
      log('⚠️ Duplicate tool call ignored:', id);
      return;
    }
    
    // Track pending execution
    const pendingTool: PendingTool = {
      id,
      timestamp: Date.now(),
      status: 'pending',
      tool: payload.tool,
      params: payload.params,
    };
    pendingById.current.set(id, pendingTool);
    
    try {
      setIsProcessing(true);
      pendingTool.status = 'executing';
      log('🔧 Executing tool:', payload.tool, payload.params);
      
      // Route to appropriate handler
      let result: unknown;
      
      if (payload.tool === 'generate_ui_component') {
        // Use Tambo thread system for UI generation
        const params = payload.params as { componentType?: string; prompt?: string; task_prompt?: string };
        const { componentType = 'auto', prompt, task_prompt } = params;
        
        // Get the prompt text from various possible fields
        const userPrompt = prompt || task_prompt || `Generate a ${componentType} component`;
        
        // Send message through Tambo thread which will generate appropriate UI
        // Tambo already knows about all components including timers, charts, etc.
        await sendTamboMessage(userPrompt);
        
        result = {
          status: 'SUCCESS',
          message: 'UI component generation initiated',
          componentType,
          prompt: userPrompt,
        };
        
      } else if (payload.tool.startsWith('mcp_')) {
        // Route to MCP provider through Tambo's registered tools
        // The MCP tools are registered with Tambo, so we send as a message
        const toolName = payload.tool;
        const params = payload.params;
        
        // Format as a tool call message for Tambo
        const toolCallMessage = `Execute ${toolName} with params: ${JSON.stringify(params)}`;
        await sendTamboMessage(toolCallMessage);
        
        result = {
          status: 'SUCCESS',
          message: `MCP tool ${toolName} execution initiated`,
        };
        
      } else if (payload.tool === 'youtube_search') {
        // Handle YouTube search
        const params = payload.params as { query?: string; task_prompt?: string };
        await sendTamboMessage(params.query || params.task_prompt || 'Search YouTube');
        
        result = {
          status: 'SUCCESS',
          message: 'YouTube search initiated',
        };
        
      } else if (payload.tool === 'respond_with_voice' || payload.tool === 'do_nothing') {
        // These are no-op tools for the agent
        result = {
          status: 'SUCCESS',
          message: `Tool ${payload.tool} acknowledged`,
        };
        
      } else {
        // Unknown tool
        throw new Error(`Unknown tool: ${payload.tool}`);
      }
      
      pendingTool.status = 'completed';
      await publishToolResult(id, result);
      
    } catch (error) {
      log('❌ Tool execution failed:', error);
      pendingTool.status = 'failed';
      await publishToolError(id, error as Error);
    } finally {
      setIsProcessing(false);
    }
  }, [sendTamboMessage, publishToolResult, publishToolError, log]);

  // Subscribe to tool_call events
  useDataChannel(TOOL_TOPICS.TOOL_CALL, async (message) => {
    try {
      const event: ToolCallEvent = JSON.parse(new TextDecoder().decode(message.payload));
      log('📨 Received tool call:', event);
      await executeToolCall(event);
    } catch (error) {
      log('❌ Error processing tool call:', error);
    }
  });

  // Clean up old pending tools
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      for (const [id, tool] of pendingById.current.entries()) {
        if (now - tool.timestamp > maxPendingAge) {
          log('🧹 Cleaning up old pending tool:', id);
          pendingById.current.delete(id);
        }
      }
    }, 5000); // Check every 5 seconds
    
    return () => clearInterval(interval);
  }, [maxPendingAge, log]);

  // Log dispatcher status
  useEffect(() => {
    log('🚀 ToolDispatcher initialized');
    return () => log('👋 ToolDispatcher unmounted');
  }, [log]);

  const contextValue: ToolDispatcherContextValue = {
    pendingTools: pendingById.current,
    executeToolCall,
    isProcessing,
  };

  return (
    <ToolDispatcherContext.Provider value={contextValue}>
      {children}
    </ToolDispatcherContext.Provider>
  );
}

// Export types for use in other components
export type { ToolCallEvent, ToolResultEvent, ToolErrorEvent, PendingTool }; 