# Single Source of Truth Implementation Plan

## Problem Statement

Currently, we have multiple disconnected systems that each maintain their own understanding of available capabilities:

1. **LiveKit Agent Worker** (Node.js) - Hardcoded list of tools it can call
2. **Decision Engine** - Hardcoded intent detection patterns
3. **ToolDispatcher** (Browser) - Expects certain tools and routes
4. **MCP Servers** - Dynamically loaded tools unknown to the agent
5. **Tambo Components** - Dynamically registered components unknown to the agent

This causes issues like:
- Agent calls `youtube_search` but ToolDispatcher expects MCP `searchVideos`
- New MCP tools aren't available to the agent
- New components require manual updates to multiple files
- Decision engine doesn't know about new capabilities

## Solution: System Registry

Create a centralized `SystemRegistry` that maintains all capabilities and can be accessed by all parts of the system.

### Phase 1: Registry Infrastructure ✅
- [x] Create `system-registry.ts` with capability model
- [x] Define capability types (tool, component, mcp_tool)
- [x] Implement registry class with add/remove/update methods
- [x] Add sync helpers for MCP and Tambo components

### Phase 2: Browser Integration
- [ ] Update ToolDispatcher to use SystemRegistry for routing
- [ ] Update MCP provider to sync discovered tools to registry
- [ ] Update Tambo provider to sync components to registry
- [ ] Create capability sync endpoint for agent to query

### Phase 3: Agent Integration
- [ ] Update agent to fetch capabilities on startup
- [ ] Update decision engine to use dynamic intents/keywords
- [ ] Update tool list to be dynamic based on registry
- [ ] Add periodic capability refresh

### Phase 4: UI Integration
- [ ] Create capability dashboard showing all available tools/components
- [ ] Add capability status indicators
- [ ] Show which capabilities are available where
- [ ] Add capability testing interface

## Implementation Details

### 1. Capability Model
```typescript
interface SystemCapability {
  id: string;
  type: 'tool' | 'component' | 'mcp_tool';
  name: string;
  description: string;
  agentToolName?: string;      // How agent calls it
  mcpToolName?: string;         // Actual MCP tool name
  componentName?: string;       // Tambo component name
  intents?: string[];          // Decision engine patterns
  keywords?: string[];         // Trigger keywords
  examples?: string[];         // Usage examples
  available: boolean;          // Currently available?
  source: 'static' | 'mcp' | 'dynamic';
}
```

### 2. Sync Flow

```
Browser Startup:
1. Load static capabilities
2. Discover MCP tools → sync to registry
3. Discover Tambo components → sync to registry
4. Expose registry via endpoint/data channel

Agent Startup:
1. Connect to room
2. Query capability registry
3. Configure decision engine with dynamic intents
4. Configure available tools dynamically
```

### 3. Tool Name Mapping

Handle mismatches between different naming conventions:
- Agent: `youtube_search`
- MCP: `searchVideos`
- Component: `YoutubeEmbed`

Registry maintains these mappings to route correctly.

### 4. Real-time Updates

When capabilities change:
1. Registry notifies all listeners
2. Browser updates available tools
3. Agent receives update via data channel
4. Decision engine reconfigures

## Benefits

1. **Single Source of Truth**: One place defines what's available
2. **Dynamic Discovery**: New tools/components automatically available
3. **Consistent Naming**: Registry handles name mapping
4. **Better Debugging**: Can see all capabilities in one place
5. **Easier Extension**: Add new capabilities without touching multiple files

## Migration Path

1. Start with YouTube search as test case
2. Move other tools to registry gradually
3. Eventually remove all hardcoded tool lists
4. Make agent fully dynamic based on registry 