/**
 * System Registry - Single Source of Truth
 * 
 * Centralized registry for all system capabilities that need to be synchronized across:
 * - LiveKit Agent Worker (tools it can call)
 * - Decision Engine (intents it should detect) 
 * - ToolDispatcher (how to route tool calls)
 * - MCP Servers (dynamically loaded tools)
 * - Tambo Components (available UI components)
 * 
 * This solves the distributed knowledge problem where each part of the system
 * has its own understanding of available capabilities.
 */

export interface SystemCapability {
  id: string;
  type: 'tool' | 'component' | 'mcp_tool';
  name: string;
  description: string;
  
  // For tools - how the agent should call it
  agentToolName?: string;
  
  // For MCP tools - the actual MCP tool name
  mcpToolName?: string;
  
  // For components - the Tambo component name
  componentName?: string;
  
  // Decision engine hints
  intents?: string[];
  keywords?: string[];
  
  // Examples for the agent
  examples?: string[];
  
  // Whether this is currently available
  available: boolean;
  
  // Source of this capability
  source: 'static' | 'mcp' | 'dynamic';
}

// Static capabilities that are always available
export const STATIC_CAPABILITIES: SystemCapability[] = [
  {
    id: 'generate_ui_component',
    type: 'tool',
    name: 'Generate UI Component',
    description: 'Create any UI component from Tambo registry',
    agentToolName: 'generate_ui_component',
    intents: ['ui_generation', 'create_component'],
    keywords: ['create', 'generate', 'make', 'build', 'show', 'display'],
    examples: [
      'Create a timer',
      'Show me a weather widget',
      'Build a chart for this data'
    ],
    available: true,
    source: 'static'
  },
  {
    id: 'get_documents',
    type: 'tool',
    name: 'Get Documents',
    description: 'Retrieve list of all available documents from the document store',
    agentToolName: 'get_documents',
    intents: ['document_retrieval', 'list_documents'],
    keywords: ['documents', 'scripts', 'files', 'containment breach', 'show document', 'get document'],
    examples: [
      'Show me available documents',
      'Get the containment breach script',
      'What documents are available?'
    ],
    available: true,
    source: 'static'
  },
  {
    id: 'youtube_search',
    type: 'tool', 
    name: 'YouTube Search',
    description: 'Search and embed YouTube videos',
    agentToolName: 'youtube_search',
    mcpToolName: 'searchVideos', // Maps to the actual MCP tool name
    intents: ['youtube_search', 'video_search'],
    keywords: ['youtube', 'video', 'watch', 'play', 'show video', 'latest', 'newest', 'tiktok', 'tutorial'],
    examples: [
      'Show me the latest React tutorial',
      'Play Pink Pantheress newest video',
      'Find official music video',
      'Show me TikTok trends videos'
    ],
    available: true, // Enable by default since we have fallback handling
    source: 'static'
  }
];

// Registry class to manage all capabilities
export class SystemRegistry {
  private capabilities: Map<string, SystemCapability> = new Map();
  private listeners: Set<(capabilities: SystemCapability[]) => void> = new Set();
  
  // --- Phase 4 state sync --------------------------------------------------
  // Each state kind maintains last known version so we can implement
  // last-write-wins idempotency. Persisting to memory is sufficient for
  // browser runtime; server/agent can persist elsewhere. In the future this
  // could be migrated to redis / kv.
  private stateSnapshot: Map<string, unknown> = new Map(); // key = StateEnvelope.id
  private stateListeners: Set<(envelope: unknown) => void> = new Set();
  
  constructor() {
    // Load static capabilities
    STATIC_CAPABILITIES.forEach(cap => {
      this.capabilities.set(cap.id, cap);
    });
  }
  
  // Add a new capability (e.g., from MCP discovery)
  addCapability(capability: SystemCapability) {
    this.capabilities.set(capability.id, capability);
    this.notifyListeners();
  }
  
  // Remove a capability
  removeCapability(id: string) {
    this.capabilities.delete(id);
    this.notifyListeners();
  }
  
  // Update capability availability
  setAvailability(id: string, available: boolean) {
    const cap = this.capabilities.get(id);
    if (cap) {
      cap.available = available;
      this.notifyListeners();
    }
  }
  
  // Get all capabilities
  getAllCapabilities(): SystemCapability[] {
    return Array.from(this.capabilities.values());
  }
  
  // Get capabilities by type
  getCapabilitiesByType(type: SystemCapability['type']): SystemCapability[] {
    return this.getAllCapabilities().filter(cap => cap.type === type);
  }
  
  // Get available agent tools
  getAgentTools(): string[] {
    return this.getAllCapabilities()
      .filter(cap => cap.available && cap.agentToolName)
      .map(cap => cap.agentToolName!);
  }
  
  // Get decision engine configuration
  getDecisionEngineConfig() {
    const capabilities = this.getAllCapabilities().filter(cap => cap.available);
    
    return {
      intents: capabilities.flatMap(cap => cap.intents || []),
      keywords: capabilities.flatMap(cap => cap.keywords || []),
      examples: capabilities.flatMap(cap => cap.examples || [])
    };
  }
  
  // Get tool routing info (agent name -> actual tool name mapping)
  getToolRouting(agentToolName: string): { mcpToolName?: string; componentName?: string } | null {
    const capability = Array.from(this.capabilities.values()).find(
      cap => cap.agentToolName === agentToolName
    );
    
    if (!capability) return null;
    
    return {
      mcpToolName: capability.mcpToolName,
      componentName: capability.componentName
    };
  }
  
  // Subscribe to changes
  subscribe(listener: (capabilities: SystemCapability[]) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  
  private notifyListeners() {
    const capabilities = this.getAllCapabilities();
    this.listeners.forEach(listener => listener(capabilities));
  }
  
  // Export current state for agent/decision engine
  exportForAgent() {
    const capabilities = this.getAllCapabilities().filter(cap => cap.available);
    
    return {
      tools: capabilities
        .filter(cap => cap.agentToolName)
        .map(cap => ({
          name: cap.agentToolName,
          description: cap.description,
          examples: cap.examples
        })),
      decisionEngine: {
        intents: Object.fromEntries(
          capabilities
            .filter(cap => cap.intents && cap.intents.length > 0)
            .map(cap => [cap.agentToolName || cap.id, cap.intents!])
        ),
        keywords: Object.fromEntries(
          capabilities
            .filter(cap => cap.keywords && cap.keywords.length > 0)
            .map(cap => [cap.agentToolName || cap.id, cap.keywords!])
        )
      }
    };
  }

  // -----------------------------------------------------------------------
  //  Phase 4 – State helpers
  // -----------------------------------------------------------------------

  /** Store incoming state update after conflict resolution */
  ingestState<T = unknown>(envelope: import('./shared-state').StateEnvelope<T>) {
    const existing: import('./shared-state').StateEnvelope<T> | undefined =
      this.stateSnapshot.get(envelope.id) as any;

    if (existing && existing.version >= envelope.version) {
      // Ignore stale or duplicate update
      return;
    }

    // Persist and notify listeners
    this.stateSnapshot.set(envelope.id, envelope);
    this.stateListeners.forEach(l => l(envelope));
  }

  /** Retrieve latest snapshot for given id */
  getState<T = unknown>(id: string): import('./shared-state').StateEnvelope<T> | undefined {
    return this.stateSnapshot.get(id) as any;
  }

  /** Subscribe to state updates */
  onState(listener: (envelope: import('./shared-state').StateEnvelope<any>) => void) {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  /** Dump full snapshot (e.g., for new participant) */
  getSnapshot() {
    return Array.from(this.stateSnapshot.values());
  }

  // -----------------------------------------------------------------------
  //  Phase 5 – Unified tool execution wrapper
  // -----------------------------------------------------------------------

  /**
   * Execute a tool call agnostic of where the actual implementation lives.
   * The resolution order is:
   *   1. supplied override executor
   *   2. Tambo tool registry (browser)
   *   3. MCP mapping via capability
   */
  async executeTool(call: {
    id: string;
    name: string;
    args: Record<string, unknown>;
    origin?: string;
  },
  // optional injection for unit tests or server-side execution
  options: {
    tamboRegistry?: any;
  } = {}) {
    const { name } = call;

    // Look up capability mapping first – may translate agent name ➜ mcp name
    const routing = this.getToolRouting(name);

    const registry = options.tamboRegistry as any;

    // 1) direct registry lookup
    const directTool = (() => {
      if (!registry) return undefined;
      if (typeof registry?.get === 'function') return registry.get(name);
      return registry?.[name];
    })();

    let impl: any = directTool;

    // 2) fallback to mcpToolName
    if (!impl && routing?.mcpToolName && registry) {
      impl = typeof registry.get === 'function' ? registry.get(routing.mcpToolName) : registry[routing.mcpToolName];
    }

    if (!impl) {
      throw new Error(`Tool '${name}' is not registered in Tambo registry`);
    }

    const started = Date.now();
    try {
      const result = await impl.execute?.(call.args) ?? await impl(call.args);
      // Emit tool_result state
      this.ingestState({
        id: call.id,
        kind: 'tool_result',
        payload: { ok: true, result },
        version: 1,
        ts: Date.now(),
        origin: call.origin || 'browser',
      });
      return result;
    } catch (err: any) {
      this.ingestState({
        id: call.id,
        kind: 'tool_error',
        payload: { ok: false, error: err.message || String(err) },
        version: 1,
        ts: Date.now(),
        origin: call.origin || 'browser',
      });
      throw err;
    } finally {
      // Could log execution time here
      // console.debug(`[SystemRegistry] Tool '${name}' executed in`, Date.now()-started, 'ms');
    }
  }
}

// Global singleton instance
export const systemRegistry = new SystemRegistry();

// Helper to sync MCP tools when they're discovered
export function syncMcpToolsToRegistry(mcpTools: Array<{name: string, description: string}>) {
  // Map common MCP tools to agent tools
  const mcpToAgentMapping: Record<string, string> = {
    'searchVideos': 'youtube_search',
    'youtube_search': 'youtube_search',
    'weather': 'mcp_weather',
    'forecast': 'mcp_forecast',
    'alerts': 'mcp_alerts',
    // Add more mappings as needed
  };
  
  mcpTools.forEach(tool => {
    const normalized = tool.name.replace(/^mcp_/, '');
    const agentToolName = mcpToAgentMapping[normalized];
    
    if (agentToolName) {
      // Update existing capability
      systemRegistry.setAvailability(agentToolName, true);
    } else {
      // Add new MCP tool capability
      systemRegistry.addCapability({
        id: `mcp_${normalized}`,
        type: 'mcp_tool',
        name: normalized,
        description: tool.description,
        mcpToolName: normalized,
        agentToolName: `mcp_${normalized}`,
        available: true,
        source: 'mcp'
      });
    }
  });
}

// Helper to sync Tambo components to registry
export function syncTamboComponentsToRegistry(components: Array<{name: string, description: string}>) {
  components.forEach(component => {
    systemRegistry.addCapability({
      id: `component_${component.name}`,
      type: 'component',
      name: component.name,
      description: component.description,
      componentName: component.name,
      available: true,
      source: 'dynamic'
    });
  });
} 