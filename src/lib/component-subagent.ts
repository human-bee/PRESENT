/**
 * Component Sub-Agent System
 *
 * Each custom component gets its own sub-agent that:
 * 1. Loads instantly with skeleton
 * 2. Reads context from thread/transcript
 * 3. Makes autonomous MCP calls
 * 4. Progressively updates component state
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { usecustomThread } from '@custom-ai/react';
import { LoadingState } from './progressive-loading';
import { LinearMcpClient } from './linear-mcp-client';

// Sub-agent configuration
export interface SubAgentConfig {
  componentName: string;
  mcpTools: string[]; // Which MCP tools this component can use
  initialContext?: any; // Static context (e.g. API keys)
  contextExtractor: (thread: any) => any; // Extract relevant context from thread
  dataEnricher: (context: any, mcpTools: any) => Promise<any>[]; // Define enrichment pipeline
}

// Sub-agent state
export interface SubAgentState {
  loadingState: LoadingState;
  context: any;
  enrichedData: Record<string, any>;
  errors: Record<string, Error>;
  mcpActivity: Record<string, boolean>;
}

/**
 * Hook that creates a sub-agent for a component
 */
export function useComponentSubAgent(config: SubAgentConfig) {
  const { thread } = usecustomThread();
  const [state, setState] = useState<SubAgentState>({
    loadingState: LoadingState.SKELETON,
    context: config.initialContext || null,
    enrichedData: {},
    errors: {},
    mcpActivity: {},
  });

  const [tools, setTools] = useState<any>(null);

  useEffect(() => {
    let mounted = true;

    const init = async () => {
      try {
        // Pass initialContext to getMCPTools so it has access to API keys immediately
        const mcpTools = await getMCPTools(config.mcpTools || [], config.initialContext);

        if (mounted) {
          setTools(mcpTools);
        }
      } catch (err) {
        console.error('[useComponentSubAgent] Tool initialization failed:', err);
      }
    };

    init();

    return () => {
      mounted = false;
    };
  }, [JSON.stringify(config.mcpTools), JSON.stringify(config.initialContext)]); // Stable dependency for toolsetting

  const enrichmentQueue = useRef<Promise<any>[]>([]);
  const isMounted = useRef(true);

  // Runtime guard: disable automatic subagent execution in development by default
  // Enable by setting NEXT_PUBLIC_SUBAGENT_AUTORUN=true
  // In production builds, autorun remains enabled unless explicitly disabled
  const autorunEnabled = ((): boolean => {
    const env = process.env.NEXT_PUBLIC_SUBAGENT_AUTORUN;
    if (env === 'true') return true;
    if (env === 'false') return false;
    // Default to TRUE in development for now to fix the loading issue
    return process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'development';
  })();

  // Stabilize config to prevent infinite re-renders
  const stableConfig = useRef(config);
  const configKey = `${config.componentName}-${JSON.stringify(config.mcpTools)}-${JSON.stringify(config.initialContext)}`;
  useEffect(() => {
    stableConfig.current = config;
  }, [configKey]); // Stable dependency

  // Extract context from thread
  const extractContext = useCallback(() => {
    // Start with initial context
    let context = { ...stableConfig.current.initialContext };

    if (thread && stableConfig.current.contextExtractor) {
      try {
        const extracted = stableConfig.current.contextExtractor(thread);
        context = { ...context, ...extracted };
      } catch (error) {
        console.error(
          `[SubAgent ${stableConfig.current.componentName}] Context extraction failed:`,
          error,
        );
        if (isMounted.current) {
          setState((prev) => ({
            ...prev,
            errors: { ...prev.errors, contextExtraction: error as Error },
          }));
        }
      }
    }

    if (isMounted.current) {
      setState((prev) => ({
        ...prev,
        context,
        loadingState: LoadingState.PARTIAL,
      }));
    }
    return context;
  }, [thread]);

  // Execute MCP enrichment pipeline
  const enrichData = useCallback(async (context: any) => {
    if (!context || !stableConfig.current.dataEnricher) {
      return;
    }

    try {
      // Get available MCP tools
      const mcpTools = await getMCPTools(stableConfig.current.mcpTools, context);

      // Create enrichment promises
      const enrichmentPromises = stableConfig.current.dataEnricher(context, mcpTools);
      enrichmentQueue.current = enrichmentPromises;

      // Track MCP activity
      enrichmentPromises.forEach((promise, index) => {
        const toolName = stableConfig.current.mcpTools[index];
        if (isMounted.current) {
          setState((prev) => ({
            ...prev,
            mcpActivity: { ...prev.mcpActivity, [toolName]: true },
          }));
        }

        // Execute enrichment
        promise
          .then((result) => {
            if (isMounted.current) {
              setState((prev) => ({
                ...prev,
                enrichedData: { ...prev.enrichedData, [toolName]: result },
                mcpActivity: { ...prev.mcpActivity, [toolName]: false },
              }));
            }
          })
          .catch((error) => {
            if (isMounted.current) {
              setState((prev) => ({
                ...prev,
                errors: { ...prev.errors, [toolName]: error },
                mcpActivity: { ...prev.mcpActivity, [toolName]: false },
              }));
            }
          });
      });

      // Wait for all enrichments to complete
      await Promise.allSettled(enrichmentPromises);

      if (isMounted.current) {
        setState((prev) => ({
          ...prev,
          loadingState: LoadingState.COMPLETE,
        }));
      }
    } catch (error) {
      console.error(`[SubAgent ${stableConfig.current.componentName}] Enrichment failed:`, error);
      if (isMounted.current) {
        setState((prev) => ({
          ...prev,
          errors: { ...prev.errors, dataEnrichment: error as Error },
        }));
      }
    }
  }, []);

  // Thread change tracking with deep comparison
  const lastThreadRef = useRef<any>(null);
  const hasRunRef = useRef(false);
  const componentIdRef = useRef(`${config.componentName}-${Date.now()}-${Math.random()}`);
  const mountTimeRef = useRef(Date.now());

  // Deep compare threads to prevent unnecessary re-runs
  const threadHasChanged = useCallback(() => {
    if (!lastThreadRef.current && !thread) return false;
    if (!lastThreadRef.current && thread) return true;
    if (lastThreadRef.current && !thread) return true;

    // Compare thread IDs if available
    if (lastThreadRef.current?.id !== thread?.id) return true;

    // Compare message counts
    const oldCount = lastThreadRef.current?.messages?.length || 0;
    const newCount = thread?.messages?.length || 0;
    if (oldCount !== newCount) return true;

    // Compare last message content
    const oldLastMsg = lastThreadRef.current?.messages?.[oldCount - 1];
    const newLastMsg = thread?.messages?.[newCount - 1];
    if (oldLastMsg?.id !== newLastMsg?.id) return true;

    return false;
  }, [thread]);

  // Check if component needs initial load (even with same thread)
  // Using refs to avoid dependency on state
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const needsInitialLoad = useCallback(() => {
    // If we haven't run yet, we need to load
    if (!hasRunRef.current) return true;

    // Access state through ref to avoid dependency
    const currentState = stateRef.current;

    // If we have no data yet, we need to load
    if (
      Object.keys(currentState.enrichedData).length === 0 &&
      currentState.loadingState === LoadingState.SKELETON
    ) {
      return true;
    }

    // If component was just mounted (within 100ms), force load
    if (Date.now() - mountTimeRef.current < 100) {
      return true;
    }

    return false;
  }, []); // No dependencies!

  // Track if we're currently loading to prevent double-loads
  const isLoadingRef = useRef(false);

  // Main effect: Context extraction → Data enrichment
  useEffect(() => {
    // Respect autorun guard
    if (!autorunEnabled) {
      // Still expose refresh/forceReload for manual triggering
      // but do not auto-run on mount or thread changes
      return;
    }

    // Prevent multiple simultaneous loads
    if (isLoadingRef.current) {
      return;
    }

    const shouldLoad = threadHasChanged() || needsInitialLoad();

    // Skip if we don't need to load
    if (!shouldLoad && hasRunRef.current) {
      console.log(`[SubAgent ${componentIdRef.current}] No changes detected, skipping load`);
      return;
    }

    console.log(
      `[SubAgent ${componentIdRef.current}] Loading data - threadChanged: ${threadHasChanged()}, needsInitial: ${needsInitialLoad()}`,
    );

    isLoadingRef.current = true;

    lastThreadRef.current = thread
      ? {
        id: thread.id,
        messages: thread.messages?.map((m: any) => ({ id: m.id, content: m.content })),
      }
      : null;

    hasRunRef.current = true;
    isMounted.current = true;

    // Reset state if thread changed OR if we need initial load
    if (shouldLoad) {
      setState((prev) => ({
        ...prev,
        loadingState: LoadingState.SKELETON,
        context: config.initialContext || null,
        enrichedData: {},
        errors: {},
        mcpActivity: {},
      }));
    }

    // Component-specific delay to prevent thundering herd
    const delay = 50 + Math.random() * 100; // 50-150ms random delay
    const timeoutId = setTimeout(() => {
      if (isMounted.current) {
        const context = extractContext();
        if (context) {
          console.log(`[SubAgent ${componentIdRef.current}] Enriching data with context:`, context);
          enrichData(context).finally(() => {
            isLoadingRef.current = false;
          });
        } else {
          isLoadingRef.current = false;
        }
      } else {
        isLoadingRef.current = false;
      }
    }, delay);

    return () => {
      clearTimeout(timeoutId);
      isMounted.current = false;
      isLoadingRef.current = false;
      // Cancel any pending enrichments
      enrichmentQueue.current = [];
    };
  }, [thread]); // Only depend on thread - other functions are stable

  // Remove the auto-refresh effect to prevent infinite loops
  // This was causing issues by creating circular dependencies

  return {
    ...state,
    refresh: () => {
      console.log(`[SubAgent ${componentIdRef.current}] Manual refresh requested`);
      hasRunRef.current = false; // Reset to force reload
      const context = extractContext();
      if (context) enrichData(context);
    },
    forceReload: () => {
      console.log(`[SubAgent ${componentIdRef.current}] Force reload requested`);
      mountTimeRef.current = Date.now(); // Reset mount time
      hasRunRef.current = false; // Reset run flag
      setState({
        loadingState: LoadingState.SKELETON,
        context: config.initialContext || null,
        enrichedData: {},
        errors: {},
        mcpActivity: {},
      });
      // Trigger reload on next tick
      setTimeout(() => {
        const context = extractContext();
        if (context) enrichData(context);
      }, 0);
    },
    trigger: async (actionPayload: any) => {
      console.log(`[SubAgent ${componentIdRef.current}] Triggered with payload:`, actionPayload);
      const context = extractContext();
      // Merge action payload into context
      const triggerContext = { ...context, ...actionPayload };
      if (triggerContext) {
        await enrichData(triggerContext);
      }
    }
  };
}

// Cache for the Linear client to avoid reconnecting on every tool call
// Use window in browser to survive hot module reloading in development
declare global {
  interface Window {
    __linearMcpClient?: LinearMcpClient;
    __linearMcpClientKey?: string;
    __linearMcpClientPromise?: Promise<LinearMcpClient>;
  }
}

function getLinearClientInstance(): LinearMcpClient | null {
  if (typeof window !== 'undefined') {
    return window.__linearMcpClient || null;
  }
  return null;
}

function getLinearClientKey(): string | null {
  if (typeof window !== 'undefined') {
    return window.__linearMcpClientKey || null;
  }
  return null;
}

function setLinearClientInstance(client: LinearMcpClient, apiKey: string): void {
  if (typeof window !== 'undefined') {
    window.__linearMcpClient = client;
    window.__linearMcpClientKey = apiKey;
  }
}

// Get or create Linear client with mutex to prevent race conditions
async function getOrCreateLinearClient(apiKey: string): Promise<LinearMcpClient> {
  // Check if we already have a valid client for this key
  const existingClient = getLinearClientInstance();
  const existingKey = getLinearClientKey();
  
  if (existingClient && existingKey === apiKey) {
    console.log('[Linear] Reusing existing MCP client');
    return existingClient;
  }
  
  // Check if there's already a creation in progress
  if (typeof window !== 'undefined' && window.__linearMcpClientPromise) {
    console.log('[Linear] Waiting for existing client creation');
    const client = await window.__linearMcpClientPromise;
    // Verify the key matches after waiting
    if (getLinearClientKey() === apiKey) {
      return client;
    }
    // Key changed, need to create new client
  }
  
  // Create new client with lock
  console.log('[Linear] Creating new MCP client');
  const creationPromise = (async () => {
    const client = new LinearMcpClient(apiKey);
    setLinearClientInstance(client, apiKey);
    return client;
  })();
  
  if (typeof window !== 'undefined') {
    window.__linearMcpClientPromise = creationPromise;
  }
  
  try {
    const client = await creationPromise;
    return client;
  } finally {
    // Clear the promise after creation completes
    if (typeof window !== 'undefined') {
      window.__linearMcpClientPromise = undefined;
    }
  }
}

/**
 * Get MCP tools by name - integrates with actual MCP system
 */
async function getMCPTools(toolNames: string[], context?: any): Promise<Record<string, any>> {
  const tools: Record<string, any> = {};
  console.log('[getMCPTools] called with:', {
    toolNames,
    context,
    hasKey: !!context?.linearApiKey,
    keyType: typeof context?.linearApiKey,
    keyLen: context?.linearApiKey?.length
  });

  // Try to get actual MCP tools from window if available
  const mcpTools = (window as any).__custom_mcp_tools || {};
  const mcpToolNames = Object.keys(mcpTools);
  const normalize = (s: string) =>
    s
      .toLowerCase()
      .replace(/^mcp_/, '')
      .replace(/[^a-z0-9]/g, '');

  for (const name of toolNames) {
    // Special handling for Linear if API key is present
    if (name === 'linear' && context?.linearApiKey) {
      tools[name] = {
        execute: async (params: any) => {
          try {
            // Get or create client with mutex to prevent race conditions
            const client = await getOrCreateLinearClient(context.linearApiKey);

            // Use the client's smart execution to handle tool mapping
            const action = params?.tool || params?.action || 'list_issues';
            const actionParams = params?.params || params;

            console.log('[Linear] executeAction:', { action, actionParams, rawParams: params });
            return await client.executeAction(action, actionParams);

          } catch (error) {
            console.error('[MCP] Linear API call failed:', error);
            return { error: error instanceof Error ? error.message : 'Unknown error' };
          }
        }
      };
      continue;
    }

    // Use actual MCP tool if available
    if (mcpTools[name]) {
      tools[name] = mcpTools[name];
      continue;
    }

    // Try prefixed name (mcp_weather)
    const prefixed = `mcp_${name}`;
    if (mcpTools[prefixed]) {
      tools[name] = mcpTools[prefixed];
      continue;
    }

    // Fuzzy alias resolution: pick first tool whose normalized name includes requested name
    const requested = normalize(name);
    const matchKey = mcpToolNames.find((k) => normalize(k).includes(requested));
    if (matchKey && mcpTools[matchKey]) {
      tools[name] = mcpTools[matchKey];
      continue;
    }

    // Fallback to calling through window.callMcpTool if available, otherwise mock
    tools[name] = {
      execute: async (params: any) => {
        // Always use mock in development (localhost) to avoid MCP timeout
        const isLocalhost = typeof window !== 'undefined' && window.location.hostname === 'localhost';

        if (isLocalhost && ['weather', 'analytics'].includes(name)) {
          // Fall through to mock switch below
        } else if (typeof window !== 'undefined' && (window as any).callMcpTool) {
          try {
            return await (window as any).callMcpTool(name, params);
          } catch (error) {
            console.warn(`[MCP Debug] MCP call failed for ${name}:`, error);
          }
        }


        // Mock responses for development
        switch (name) {
          case 'weather':
            return mockWeatherData(params);
          case 'search':
            return mockSearchData(params);
          case 'analytics':
            return mockAnalyticsData(params);
          case 'linear':
            return { error: 'Linear MCP tool unavailable. Provide LINEAR_API_KEY or ensure MCP tools are injected.' };
          default:
            return { data: `Result from ${name}` };
        }
      },
    };
  }

  return tools;
}

// Mock data generators for testing
function mockWeatherData(params: any) {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve({
        location: params.location || 'San Francisco, CA',
        temperature: Math.floor(Math.random() * 30 + 50),
        condition: ['Sunny', 'Cloudy', 'Rainy'][Math.floor(Math.random() * 3)],
        humidity: Math.floor(Math.random() * 40 + 40),
      });
    }, 500);
  });
}

function mockSearchData(params: any) {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve({
        query: params.query,
        results: Array(5)
          .fill(null)
          .map((_, i) => ({
            title: `Result ${i + 1} for "${params.query}"`,
            url: `https://example.com/${i}`,
          })),
      });
    }, 300);
  });
}

function mockAnalyticsData(params: any) {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve({
        metric: params.metric,
        value: Math.floor(Math.random() * 1000),
        trend: Math.random() > 0.5 ? 'up' : 'down',
      });
    }, 400);
  });
}

/**
 * Create a sub-agent configuration for common component types
 */
export const SubAgentPresets = {
  weather: {
    componentName: 'WeatherForecast',
    mcpTools: ['weather', 'forecast', 'alerts'],
    contextExtractor: (thread: any) => {
      // Extract location from thread messages
      const lastMessage = thread.messages?.[thread.messages.length - 1];
      let text = '';

      // Safely extract text content
      if (lastMessage?.content) {
        text =
          typeof lastMessage.content === 'string'
            ? lastMessage.content
            : JSON.stringify(lastMessage.content);
      }

      // Look for location mentions
      const locationMatch = text.match(/weather (?:for|in) ([^,]+(?:, \w{2})?)/i);
      const allowCurrentLocation = process.env.NEXT_PUBLIC_ALLOW_CURRENT_LOCATION === 'true';
      return {
        location: locationMatch?.[1] || (allowCurrentLocation ? 'Current Location' : undefined),
        requestedView: text.includes('forecast') ? 'weekly' : 'current',
      };
    },
    dataEnricher: (context: any, tools: any) => {
      // Do not call tools without a concrete location
      if (!context?.location) return [];
      const location = context.location;
      return [
        tools.weather?.execute({ location }),
        tools.forecast?.execute({ location, days: 7 }),
        tools.alerts?.execute({ location }),
      ];
    },
  },

  actionItems: {
    componentName: 'ActionItemTracker',
    mcpTools: ['linear', 'github', 'calendar'],
    contextExtractor: (thread: any) => {
      // Extract action items from conversation
      const messages = thread.messages || [];
      const actionKeywords = ['todo', 'action', 'task', 'need to', 'should', 'must'];

      return {
        extractedItems: messages
          .filter((m: any) => {
            const content = typeof m.content === 'string' ? m.content : '';
            return actionKeywords.some((k) => content.toLowerCase().includes(k));
          })
          .map((m: any) => (typeof m.content === 'string' ? m.content : '')),
        meetingContext: messages[0]?.content
          ? typeof messages[0].content === 'string'
            ? messages[0].content
            : 'General Tasks'
          : 'General Tasks',
      };
    },
    dataEnricher: (context: any, tools: any) => [
      tools.linear?.execute({ action: 'list_issues' }),
      tools.github?.execute({ action: 'list_issues' }),
      tools.calendar?.execute({ action: 'upcoming_events' }),
    ],
  },

  dashboard: {
    componentName: 'Dashboard',
    mcpTools: ['analytics', 'metrics', 'alerts'],
    contextExtractor: (thread: any) => {
      const lastMessage = thread.messages?.[thread.messages.length - 1];
      const content = lastMessage?.content
        ? typeof lastMessage.content === 'string'
          ? lastMessage.content
          : 'overview'
        : 'overview';

      return {
        requestedMetrics: content,
        timeRange: '24h',
      };
    },
    dataEnricher: (context: any, tools: any) => [
      tools.analytics?.execute({ metric: 'visitors', range: context.timeRange }),
      tools.metrics?.execute({ type: 'performance', range: context.timeRange }),
      tools.alerts?.execute({ severity: 'all' }),
    ],
  },

  kanban: {
    componentName: 'LinearKanbanBoard',
    mcpTools: ['linear'],
    contextExtractor: (thread: any) => {
      const lastMessage = thread.messages?.[thread.messages.length - 1];
      let text = '';

      if (lastMessage?.content) {
        text =
          typeof lastMessage.content === 'string'
            ? lastMessage.content
            : JSON.stringify(lastMessage.content);
      }

      // Look for team mentions
      const teamMatch = text.match(/team[:\s]+([^,\s]+)/i);
      return {
        requestedTeam: teamMatch?.[1] || 'Personal',
        showCompleted: text.toLowerCase().includes('completed'),
      };
    },
    dataEnricher: (context: any, tools: any) => [
      tools.linear?.execute({
        action: 'list_issues',
        teamName: context.requestedTeam,
        includeCompleted: context.showCompleted,
      }),
    ],
  },

  mermaidStream: {
    componentName: 'Mermaid (stream)',
    mcpTools: ['search'],
    contextExtractor: (thread: any) => {
      const last = thread?.messages?.[thread.messages.length - 1];
      const text = last?.content && typeof last.content === 'string' ? last.content : '';
      // Extract a simple graph skeleton from the conversation as a seed
      const wantsSequence = /sequence|steps|process/i.test(text);
      const wantsFlow = /flow|graph|diagram/i.test(text) || !wantsSequence;
      const seed = wantsFlow
        ? 'graph TD; Start-->Decision; Decision-->|Yes|OK; Decision-->|No|Retry;'
        : 'sequenceDiagram\nparticipant A\nparticipant B\nA->>B: Hello\nB-->>A: World';
      return { seed };
    },
    dataEnricher: (context: any, tools: any) => {
      // Prefer fast streaming model via external MCP in future; for now, no-op
      return [];
    },
  },
};
