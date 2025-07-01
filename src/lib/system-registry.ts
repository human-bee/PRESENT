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
    available: false, // Will be set to true when MCP tool is discovered
    source: 'static'
  }
];

// Registry class to manage all capabilities
export class SystemRegistry {
  private capabilities: Map<string, SystemCapability> = new Map();
  private listeners: Set<(capabilities: SystemCapability[]) => void> = new Set();
  
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
}

// Global singleton instance
export const systemRegistry = new SystemRegistry();

// Helper to sync MCP tools when they're discovered
export function syncMcpToolsToRegistry(mcpTools: Array<{name: string, description: string}>) {
  // Map common MCP tools to agent tools
  const mcpToAgentMapping: Record<string, string> = {
    'searchVideos': 'youtube_search',
    'youtube_search': 'youtube_search',
    // Add more mappings as needed
  };
  
  mcpTools.forEach(tool => {
    const agentToolName = mcpToAgentMapping[tool.name];
    
    if (agentToolName) {
      // Update existing capability
      systemRegistry.setAvailability(agentToolName, true);
    } else {
      // Add new MCP tool capability
      systemRegistry.addCapability({
        id: `mcp_${tool.name}`,
        type: 'mcp_tool',
        name: tool.name,
        description: tool.description,
        mcpToolName: tool.name,
        agentToolName: `mcp_${tool.name}`,
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