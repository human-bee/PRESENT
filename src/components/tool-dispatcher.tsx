/**
 * ToolDispatcher - Unified Tool Execution System
 * 
 * AGENT #3 of 3 in the Tambo Architecture
 * =======================================
 * This is the TOOL DISPATCHER that runs in the browser as a React component.
 * 
 * Responsibilities:
 * - Receive tool calls from the Voice Agent
 * - Route to appropriate handlers (Tambo UI, MCP tools, built-in)
 * - Execute tools through the unified SystemRegistry
 * - Manage execution state and prevent duplicates
 * - Publish results back to the Voice Agent
 * - Sync discovered MCP tools to SystemRegistry
 * 
 * Data Flow:
 * 1. Voice Agent publishes tool_call event
 * 2. This dispatcher receives and validates
 * 3. Routes through SystemRegistry.executeTool()
 * 4. Executes via Tambo/MCP/built-in handler
 * 5. Publishes tool_result back to Voice Agent
 * 
 * Key Features:
 * - Circuit breaker prevents duplicate executions
 * - Dynamic tool discovery and registration
 * - Smart YouTube search with context
 * - Real-time state synchronization
 * 
 * This replaces the fragmented RPC approach with a unified event-driven system.
 * See docs/THREE_AGENT_ARCHITECTURE.md for complete details.
 */

"use client";

/* eslint-disable @typescript-eslint/no-explicit-any */

import { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { useRoomContext } from '@livekit/components-react';
import { useTamboThread, useTambo } from '@tambo-ai/react';
import { createLiveKitBus } from '../lib/livekit-bus';
import { useContextKey } from './RoomScopedProviders';
import { createLogger } from '../lib/utils';
import { CircuitBreaker } from '../lib/circuit-breaker';
import { systemRegistry, syncMcpToolsToRegistry } from '../lib/system-registry';

// Generate unique IDs without external dependency
const generateId = () => `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

// Create logger for consistent logging
const logger = createLogger('ToolDispatcher');

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
  status: 'pending' | 'executing' | 'completed' | 'failed' | 'error';
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
  contextKey: propContextKey
}: ToolDispatcherProps) {
  const room = useRoomContext();
  const { sendThreadMessage } = useTamboThread();
  const roomContextKey = useContextKey();
  const { toolRegistry = {} } = useTambo() as any;
  const pendingById = useRef(new Map<string, PendingTool>());
  const [isProcessing, setIsProcessing] = useState(false);
  
  // Log helper using centralized logger - moved before useEffect
  const log = useCallback((...args: unknown[]) => {
    if (enableLogging) {
      logger.log(...args);
    }
  }, [enableLogging]);
  
  // Sync MCP tools to system registry when they change
  useEffect(() => {
    if (!toolRegistry) return;
    
    // Extract all tools from registry
    const allTools: Array<{name: string, description: string}> = [];
    
    // Handle both Map-style and object registries
    if (toolRegistry instanceof Map) {
      // Map-style registry
      toolRegistry.forEach((tool: any, name: string) => {
        allTools.push({ 
          name, 
          description: tool.description || tool.name || name 
        });
      });
    } else if (typeof toolRegistry === 'object') {
      // Object-style registry
      Object.entries(toolRegistry).forEach(([name, tool]: [string, any]) => {
        allTools.push({ 
          name, 
          description: tool.description || tool.name || name 
        });
      });
    }
    
    // Sync to system registry
    if (allTools.length > 0) {
      log('🔄 [ToolDispatcher] Syncing tools to system registry:', allTools.length, 'tools');
      syncMcpToolsToRegistry(allTools);
    }
  }, [toolRegistry, log]);
  
  // Use circuit breaker for duplicate detection
  const circuitBreaker = useRef(new CircuitBreaker({
    duplicateWindow: 3000,     // 3 seconds for duplicate tool calls
    completedWindow: 30000,    // 30 seconds for completed calls
    cooldownWindow: 5000       // 5 seconds general cooldown
  }));
  
  // Use room name as context key to ensure thread/canvas sync
  const effectiveContextKey = propContextKey || roomContextKey || room?.name || 'canvas';

  const bus = createLiveKitBus(room);
  
  // Expose system capabilities via data channel for agent to query
  useEffect(() => {
    if (!room || !bus) return;
    
    const handleCapabilityQuery = (data: Uint8Array) => {
      try {
        const message = JSON.parse(new TextDecoder().decode(data));
        
        if (message.type === 'capability_query') {
          log('📊 [ToolDispatcher] Agent requesting capability list');
          
          // Get current capabilities from system registry
          const capabilities = systemRegistry.exportForAgent();
          
          // Send back via data channel
          const response = {
            type: 'capability_list',
            capabilities,
            timestamp: Date.now()
          };
          
          bus.send('capability_list', response);
          log('✅ [ToolDispatcher] Sent capability list to agent:', capabilities.tools.length, 'tools');
        }
      } catch (error) {
        // Ignore non-JSON messages
      }
    };
    
    // Listen for capability queries
    room.on('dataReceived', handleCapabilityQuery);
    
    return () => {
      room.off('dataReceived', handleCapabilityQuery);
    };
  }, [room, bus, log]);

  // Publish tool result back to agent
  const publishToolResult = useCallback(async (toolCallId: string, result: unknown) => {
    const resultEvent: ToolResultEvent = {
      id: generateId(),
      toolCallId,
      type: 'tool_result',
      result,
      timestamp: Date.now(),
      executionTime: Date.now() - (pendingById.current.get(toolCallId)?.timestamp || Date.now()),
    };

    bus.send(TOOL_TOPICS.TOOL_RESULT, resultEvent);

    log('📤 Published tool result:', { toolCallId, executionTime: resultEvent.executionTime });
  }, [bus, log]);

  // Publish tool error back to agent
  const publishToolError = useCallback(async (toolCallId: string, error: Error | string) => {
    const errorEvent: ToolErrorEvent = {
      id: generateId(),
      toolCallId,
      type: 'tool_error',
      error: error instanceof Error ? error.message : error,
      timestamp: Date.now(),
    };

    bus.send(TOOL_TOPICS.TOOL_ERROR, errorEvent);

    log('❌ Published tool error:', { toolCallId, error: errorEvent.error });
  }, [bus, log]);

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
      // Use simple parameters that most YouTube MCP implementations support
      const searchParams: Record<string, unknown> = {
        q: query, // Most YouTube APIs use 'q' not 'query'
        maxResults: 10,
        part: 'snippet,statistics', // Common requirement
        type: 'video'
      };

      // Add optional parameters only if supported
      if (flags.wantsLatest) {
        searchParams.order = 'date';
      }

      if (flags.contentType === 'music') {
        searchParams.videoCategoryId = '10'; // Music category
      }

      log('🔧 [ToolDispatcher] Calling MCP searchVideos with params:', searchParams);

      // 2. Route to the actual MCP tool using system registry mapping
      const routing = systemRegistry.getToolRouting('youtube_search');
      const mcpToolName = routing?.mcpToolName || 'searchVideos'; // Default fallback
      
      // Check if MCP tool is available in Tambo's registry
      const searchVideosTool = (() => {
        // Handle both Map-style (toolRegistry.get) and plain object registries
        const reg: any = toolRegistry;
        if (typeof reg?.get === 'function') return reg.get(mcpToolName);
        return reg?.[mcpToolName];
      })();
      
      if (!searchVideosTool) {
        // Fallback: try the direct youtube_search name
        const fallbackTool = (() => {
          const reg: any = toolRegistry;
          if (typeof reg?.get === 'function') return reg.get('youtube_search');
          return reg?.['youtube_search'];
        })();
        
        if (!fallbackTool) {
          // Final fallback - create a mock YouTube search result
          log('⚠️ [ToolDispatcher] No YouTube MCP configured, using mock result');
          
          // Create a mock video result to demonstrate the functionality
          const mockVideoId = 'dQw4w9WgXcQ'; // Classic video ID as placeholder
          const mockTitle = `Mock Result: ${query}`;
          
          // Send the YouTube embed component directly
          const embedMsg = `<<component name=\"YoutubeEmbed\" videoId=\"${mockVideoId}\" title=\"${mockTitle}\" startTime={0} >>`;
          await sendTamboMessage(embedMsg);
          
          return {
            status: 'SUCCESS',
            message: 'YouTube search unavailable - showing placeholder video. Configure MCP at /mcp-config',
            videoId: mockVideoId,
            videoTitle: mockTitle,
            note: 'This is a placeholder. Please configure YouTube MCP server for real search results.'
          };
        }
        
        // Use the fallback tool
        const searchResults: any = await fallbackTool.execute(searchParams);
        return searchResults;
      }
      
      // Execute the MCP tool
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
    } catch (error: any) {
      log('❌ [ToolDispatcher] Smart YouTube search failed:', error);
      
      // Provide helpful error messages
      if (error.message?.includes('not registered')) {
        throw new Error(
          'YouTube search requires MCP configuration. ' +
          'Please go to /mcp-config and add a YouTube MCP server URL.'
        );
      }
      
      throw error;
    }
  }, [log, toolRegistry, sendTamboMessage]);

  // Execute tool call
  const executeToolCall = useCallback(async (event: ToolCallEvent) => {
    const { id, payload } = event;
    
    // Check for duplicate by ID
    if (pendingById.current.has(id)) {
      log('⚠️ Duplicate tool call ignored:', id);
      return;
    }
    
    // ALSO check for duplicate by tool + params combination (fixes multiple AI assistant messages)
    const toolSignature = JSON.stringify({ tool: payload.tool, params: payload.params });
    const existingCall = Array.from(pendingById.current.values()).find(
      pending => JSON.stringify({ tool: pending.tool, params: pending.params }) === toolSignature &&
      (Date.now() - pending.timestamp) < 3000 // Within 3 seconds
    );
    
    if (existingCall) {
      log('🚫 Duplicate tool+params combination ignored:', payload.tool, 'within 3 seconds');
      return;
    }
    
    // Check if this exact call was recently completed
    if (circuitBreaker.current.isRecentlyCompleted(toolSignature)) {
      log('🛑 Rejected repeating COMPLETED tool call within 30s window:', payload.tool);
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
      
      // Route to appropriate handler – prefer new unified registry flow
      let result: unknown;

      // 0️⃣ Unified execution via SystemRegistry – will resolve to Tambo/MCP
      try {
        result = await systemRegistry.executeTool(
          {
            id,
            name: payload.tool,
            args: payload.params,
            origin: 'browser',
          },
          { tamboRegistry: toolRegistry }
        );

        await publishToolResult(id, result);
        pendingTool.status = 'completed';
        circuitBreaker.current.markCompleted(JSON.stringify({ tool: payload.tool, params: payload.params }));
        return; // unified path handled
      } catch (registryErr) {
        // Fallback to legacy built-in handling below if registry couldn't execute
        log('ℹ️ [ToolDispatcher] Unified registry execution failed, falling back. Reason:', registryErr);
      }

      // --- Legacy fallbacks kept for backwards-compat ---

      const builtIns = new Set([
        'generate_ui_component',
        'youtube_search',
        'respond_with_voice',
        'do_nothing',
        'ui_update',
        'list_components'
      ]);

      const tamboTool = (() => {
        const reg: any = toolRegistry;
        if (typeof reg?.get === 'function') return reg.get(payload.tool);
        return reg?.[payload.tool];
      })();

      if (payload.tool === 'ui_update' || payload.tool === 'list_components') {
        // Call the actual Tambo tools to get proper error messages!
        log('🔧 [ToolDispatcher] Calling Tambo tool:', payload.tool);
        log('🔍 [ToolDispatcher] Tool registry structure:', {
          registryType: typeof toolRegistry,
          hasGet: typeof toolRegistry?.get === 'function',
          keys: toolRegistry ? Object.keys(toolRegistry) : 'no registry',
          registryKeys: toolRegistry instanceof Map ? Array.from(toolRegistry.keys()) : 'not a Map'
        });
        log('🔍 [ToolDispatcher] Looking for tool:', payload.tool, 'found:', !!tamboTool);
        
        try {
          if (!tamboTool) {
            // Try to import the tools directly as fallback
            log('🔧 [ToolDispatcher] Tool not found in registry, trying direct import...');
            const { uiUpdateTool, listComponentsTool } = await import('@/lib/tambo');
            
            const directTool = payload.tool === 'ui_update' ? uiUpdateTool : listComponentsTool;
            
            if (!directTool) {
              throw new Error(`Tool ${payload.tool} not found in registry or direct import. Available registry tools: ${toolRegistry ? Object.keys(toolRegistry).join(', ') : 'none'}`);
            }
            
            log('✅ [ToolDispatcher] Found tool via direct import');
            
            // Use the directly imported tool
            if (payload.tool === 'ui_update') {
              const componentId = payload.params.componentId || payload.params.param1;
              const patch = payload.params.patch || payload.params.param2;
              
              log('🔍 [ToolDispatcher] Direct UI Update Parameters:', {
                originalParams: payload.params,
                extractedComponentId: componentId,
                extractedPatch: patch,
                patchType: typeof patch,
                patchKeys: patch ? Object.keys(patch) : 'no patch'
              });
              
              result = await directTool.tool(componentId, patch);
              
              // If successful, also send the update via bus for UI sync
              bus.send('ui_update', { 
                componentId, 
                patch, 
                timestamp: Date.now() 
              });
            } else {
              result = await directTool.tool();
            }
            
            pendingTool.status = 'completed';
            await publishToolResult(id, result);
            // ✅ Mark signature as completed to block further repeats
            circuitBreaker.current.markCompleted(toolSignature);
            return;
          }
          
          // Extract parameters for ui_update
          if (payload.tool === 'ui_update') {
            const componentId = payload.params.componentId || payload.params.param1;
            const patch = payload.params.patch || payload.params.param2;
            
            log('🔍 [ToolDispatcher] UI Update Parameters:', {
              originalParams: payload.params,
              extractedComponentId: componentId,
              extractedPatch: patch,
              patchType: typeof patch,
              patchKeys: patch ? Object.keys(patch) : 'no patch'
            });
            
            // Call the actual Tambo tool - it will throw detailed errors!
            result = await tamboTool.tool(componentId, patch);
            
            // If successful, also send the update via bus for UI sync
            bus.send('ui_update', { 
              componentId, 
              patch, 
              timestamp: Date.now() 
            });
            
          } else {
            // list_components has no parameters
            result = await tamboTool.tool();
          }
          
          pendingTool.status = 'completed';
          await publishToolResult(id, result);
          // ✅ Mark signature as completed to block further repeats
          circuitBreaker.current.markCompleted(toolSignature);
          return;
          
        } catch (error) {
          // The Tambo tool threw an error with detailed guidance!
          pendingTool.status = 'error';
          const errorMessage = error instanceof Error ? error.message : String(error);
          
          // Send the FULL educational error back to the AI!
          await publishToolResult(id, { 
            status: 'ERROR',
            error: errorMessage,
            detailedError: errorMessage // Include full error for AI learning
          });
          
          log('📚 [ToolDispatcher] Tambo tool error (educational):', errorMessage);
          return;
        }
      }

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
        const params = payload.params as { query?: string; task_prompt?: string; prompt?: string };
        
        // Extract a clean search query - prefer task_prompt or prompt over the raw query
        // which might contain conversation context
        let query = params.task_prompt || params.prompt || params.query || '';
        
        // If query contains conversation context, extract the actual search intent
        if (query.includes('CONVERSATION CONTEXT:')) {
          // Extract from the summary/prompt instead
          const context = payload.context;
          const summary = context?.summary || '';
          
          // Extract search terms from the summary
          if (summary.includes('Search YouTube for')) {
            // Extract everything after "Search YouTube for"
            const searchMatch = summary.match(/Search YouTube for (.+?)(?:\.|$)/i);
            if (searchMatch) {
              query = searchMatch[1].trim();
            }
          } else if (summary) {
            query = summary;
          }
          
          // Clean up the query further
          query = query
            .replace(/,?\s*as previously requested\.?/i, '')
            .replace(/from this band/i, 'latest music videos')
            .replace(/from the past week/i, 'latest')
            .trim();
        }
        
        log('🎯 [ToolDispatcher] Cleaned YouTube search query:', { original: params.query, cleaned: query });
        
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

  // Subscribe via bus to tool_call events
  useEffect(() => {
    const off = bus.on(TOOL_TOPICS.TOOL_CALL, async (raw) => {
      try {
        const event = raw as ToolCallEvent;
        log('📨 Received tool call:', event);
        await executeToolCall(event);
      } catch (error) {
        log('❌ Error processing tool call:', error);
      }
    });
    return off;
  }, [bus, executeToolCall, log]);

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

  // ──────────────────────────────────────────────
  // Heartbeat / state reconciliation (optional)
  // ──────────────────────────────────────────────
  useEffect(() => {
    const interval = setInterval(() => {
      const payload = {
        type: 'state_ping',
        pendingToolCount: pendingById.current.size,
        timestamp: Date.now(),
      };
      bus.send('state_ping', payload);
    }, 15000);

    // Listen for peer pings and log discrepancies
    const off = bus.on('state_ping', (msg: any) => {
      if (msg?.type === 'state_ping') {
        const delta = Math.abs((pendingById.current.size || 0) - (msg.pendingToolCount || 0));
        if (delta > 1) {
          log('⚠️ State mismatch (pending tools delta):', delta);
        }
      }
    });

    return () => {
      clearInterval(interval);
      off();
    };
  }, [bus, log]);

  // Phase 4: Start LiveKitStateBridge for real-time shared state sync
  useEffect(() => {
    if (!room) return;
    
    // Dynamic import to avoid ESM issues
    import('@/lib/livekit-state-bridge').then(({ LiveKitStateBridge }) => {
      const bridge = new LiveKitStateBridge(room);
      bridge.start();
    }).catch(console.error);
    
    return () => {
      // livekit-js has no dispose for events; rely on room closure
    };
  }, [room]);

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