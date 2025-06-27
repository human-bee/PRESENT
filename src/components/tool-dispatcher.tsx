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

/* eslint-disable @typescript-eslint/no-explicit-any */

import { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { useDataChannel, useRoomContext } from '@livekit/components-react';
import { useTamboThread, useTambo } from '@tambo-ai/react';

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
      source?: string;
      timestamp?: number;
      transcript?: string;
      summary?: string;
      speaker?: string;
      confidence?: number;
      reason?: string;
      intent?: 'youtube_search' | 'ui_component' | 'general';
      structuredContext?: {
        rawQuery?: string;
        wantsLatest?: boolean;
        wantsOfficial?: boolean;
        contentType?: string;
        artist?: string;
      };
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
  contextKey
}: ToolDispatcherProps) {
  const room = useRoomContext();
  const { sendThreadMessage } = useTamboThread();
  // Access toolRegistry via type cast to avoid TS property error when using older SDK versions
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-explicit-any
  const { toolRegistry = {} } = useTambo() as any;
  const pendingById = useRef(new Map<string, PendingTool>());
  const [isProcessing, setIsProcessing] = useState(false);
  
  // Use room name as context key to ensure thread/canvas sync
  const effectiveContextKey = contextKey || room?.name || 'canvas';
  
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
    log('📤 [ToolDispatcher] Sending message to Tambo:', message);
    
    await sendThreadMessage(message, {
      contextKey: effectiveContextKey,
      streamResponse: true,
    });
    
    log('✅ [ToolDispatcher] Message sent successfully');
  }, [sendThreadMessage, effectiveContextKey, log]);

  // Smart YouTube search helper
  const runYoutubeSmartSearch = useCallback(async (
    query: string,
    flags: {
      wantsLatest?: boolean;
      wantsOfficial?: boolean;
      contentType?: string;
      artist?: string;
    } = {}
  ) => {
    log('🎥 [ToolDispatcher] Running smart YouTube search:', { query, flags });

    try {
      // 1. Build search parameters for the MCP `searchVideos` tool
      const searchParams: Record<string, unknown> = {
        query,
        maxResults: 10,
      };

      if (flags.wantsLatest) {
        searchParams.order = 'date';
        const lastWeek = new Date();
        lastWeek.setDate(lastWeek.getDate() - 7);
        searchParams.publishedAfter = lastWeek.toISOString();
      }

      if (flags.contentType === 'music') {
        searchParams.videoCategoryId = '10'; // Music category
      }

      log('🔧 [ToolDispatcher] Calling MCP searchVideos with params:', searchParams);

      // 2. Execute the MCP tool directly
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const searchVideosTool: any = toolRegistry.get?.("searchVideos");
      if (!searchVideosTool) {
        throw new Error('searchVideos tool is not registered in Tambo');
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const searchResults: any = await searchVideosTool.execute(searchParams);

      // 3. Choose the best video – simple heuristic
      const bestVideo = (() => {
        const items = searchResults?.items || [];
        if (items.length === 0) return null;

        // If wantsOfficial, prioritise official channels
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const scored = items.map((item: any) => {
          const channelTitle: string = item.snippet?.channelTitle || '';
          const officialScore = flags.wantsOfficial && /official|vevo/i.test(channelTitle) ? 1000 : 0;
          const viewScore = Number(item.statistics?.viewCount || 0);
          return { item, score: officialScore + viewScore };
        });

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        scored.sort((a: any, b: any) => b.score - a.score);
        return scored[0].item;
      })();

      if (!bestVideo) {
        throw new Error('No suitable video found');
      }

      const videoId = bestVideo.id?.videoId || bestVideo.id;
      const videoTitle = bestVideo.snippet?.title || bestVideo.title || 'Selected Video';

      // 4. Send a message that directly instantiates YoutubeEmbed
      const embedMsg = `<<component name=\"YoutubeEmbed\" videoId=\"${videoId}\" title=\"${videoTitle.replace(/\"/g, '\\\"')}\" startTime={0} >>`;
      await sendTamboMessage(embedMsg);

      return {
        status: 'SUCCESS',
        message: 'YoutubeEmbed component created',
        videoId,
        videoTitle,
      };
    } catch (error) {
      log('❌ [ToolDispatcher] Smart YouTube search failed:', error);
      throw error;
    }
  }, [log, toolRegistry, sendTamboMessage]);

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
        
        // Extract context information first
        const context = payload.context;
        const aiSummary = context?.summary; // AI-generated summary from decision engine
        const originalTranscript = context?.transcript; // Full original transcript
        const speaker = context?.speaker || 'user';
        const confidence = context?.confidence;
        const reason = context?.reason;
        
        // Use AI summary if available, otherwise fall back to params
        const summary = aiSummary || prompt || task_prompt || `Generate a ${componentType} component`;
        
        // Build comprehensive message with both summary and transcript context
        let tamboMessage = summary;
        
        if (originalTranscript && originalTranscript !== summary) {
          tamboMessage = `${summary}

Additional Context:
• Speaker: ${speaker}
• Original transcript: "${originalTranscript}"

Please consider both the processed summary above and the original transcript context for the most accurate generation.`;
        }
        
        log('📤 [ToolDispatcher] Sending comprehensive message to Tambo:', {
          summary,
          aiSummary,
          originalTranscript,
          speaker,
          confidence,
          reason,
          messageLength: tamboMessage.length,
          hasTranscriptContext: !!originalTranscript && originalTranscript !== summary
        });
        
        // Send message through Tambo thread which will generate appropriate UI
        await sendTamboMessage(tamboMessage);
        
        result = {
          status: 'SUCCESS',
          message: 'UI component generation initiated',
          componentType,
          prompt: summary,
          context: {
            transcript: originalTranscript,
            speaker,
            confidence
          }
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
        // Handle YouTube search with smart filtering
        const params = payload.params as { query?: string; task_prompt?: string };
        const query = params.query || params.task_prompt || '';
        const context = payload.context;
        
        // Use structured context if available, otherwise fall back to query parsing
        let searchFlags: {
          wantsLatest?: boolean;
          wantsOfficial?: boolean;
          contentType?: string;
          artist?: string;
        } = {};
        
        if (context?.structuredContext) {
          // Use the enhanced context from Decision Engine
          searchFlags = {
            wantsLatest: context.structuredContext.wantsLatest,
            wantsOfficial: context.structuredContext.wantsOfficial,
            contentType: context.structuredContext.contentType,
            artist: context.structuredContext.artist
          };
          log('🎯 [ToolDispatcher] Using structured context for YouTube search:', searchFlags);
        } else {
          // Fall back to query parsing
          const queryLower = query.toLowerCase();
          searchFlags = {
            wantsLatest: queryLower.includes('latest') || queryLower.includes('newest') || 
                        queryLower.includes('recent') || queryLower.includes('new'),
            wantsOfficial: queryLower.includes('official') || queryLower.includes('vevo'),
            contentType: queryLower.includes('music') ? 'music' : 'video',
            artist: queryLower.includes('pinkpantheress') ? 'PinkPantheress' : ''
          };
          log('⚠️ [ToolDispatcher] No structured context, using query parsing:', searchFlags);
        }
        
        // Use the smart search helper
        result = await runYoutubeSmartSearch(query, searchFlags);
        
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