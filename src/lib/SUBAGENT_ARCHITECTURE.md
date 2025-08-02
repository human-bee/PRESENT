# Component Sub-Agent Architecture

## The Real Progressive Loading System

This implements the true vision from PRE-111: Components that appear instantly and self-hydrate with data through their own sub-agents.

## 🧠 Core Concept

Each Tambo component has its own **sub-agent** that:
1. **Loads instantly** - Component appears as skeleton in <100ms
2. **Reads context** - Extracts relevant info from thread/transcript
3. **Fetches data autonomously** - Makes its own MCP calls
4. **Updates progressively** - Enriches component as data arrives

## 🏗️ Architecture

```
Tambo Thread/Transcript
        ↓
Component Creation (instant skeleton)
        ↓
Sub-Agent Activation
        ├→ Context Extraction
        ├→ MCP Tool Selection
        ├→ Parallel Data Fetching
        └→ Progressive State Updates
```

## 💻 Implementation

### 1. Component with Sub-Agent

```tsx
export function WeatherForecast(props: WeatherForecastProps) {
  // Sub-agent handles all data fetching
  const subAgent = useComponentSubAgent({
    componentName: "WeatherForecast",
    mcpTools: ["weather", "forecast", "alerts"],
    
    // Extract context from thread
    contextExtractor: (thread) => {
      const lastMessage = thread.messages?.[thread.messages.length - 1];
      const location = extractLocation(lastMessage?.content);
      return { location, requestType: "current" };
    },
    
    // Define data enrichment pipeline
    dataEnricher: (context, tools) => [
      tools.weather.execute({ location: context.location }),
      tools.forecast.execute({ location: context.location }),
      tools.alerts.execute({ location: context.location }),
    ],
  });
  
  // Component renders immediately with skeleton
  // Then progressively fills with data
  return (
    <LoadingWrapper state={subAgent.loadingState}>
      {/* Use enriched data as it arrives */}
      <WeatherDisplay 
        data={subAgent.enrichedData.weather}
        forecast={subAgent.enrichedData.forecast}
      />
    </LoadingWrapper>
  );
}
```

### 2. Sub-Agent State Flow

```typescript
// Initial State (0ms)
{
  loadingState: LoadingState.SKELETON,
  context: null,
  enrichedData: {},
  mcpActivity: {},
}

// After Context Extraction (50ms)  
{
  loadingState: LoadingState.PARTIAL,
  context: { location: "San Francisco" },
  enrichedData: {},
  mcpActivity: { weather: true, forecast: true },
}

// As Data Arrives (200-500ms)
{
  loadingState: LoadingState.COMPLETE,
  context: { location: "San Francisco" },
  enrichedData: {
    weather: { temp: 72, condition: "Sunny" },
    forecast: { periods: [...] },
  },
  mcpActivity: { weather: false, forecast: false },
}
```

### 3. MCP Integration

The sub-agent system integrates with MCP tools:

```typescript
// Real MCP tool execution
if (window.callMcpTool) {
  const result = await window.callMcpTool("weather", {
    action: "get_current",
    location: "San Francisco"
  });
}

// Automatic fallback for development
else {
  const result = await mockWeatherData({ location: "San Francisco" });
}
```

## 🎯 Benefits

1. **True Progressive Loading** - Not just visual, actual data flows
2. **Decoupled Architecture** - Components don't wait for Tambo
3. **Autonomous Data Fetching** - Each component manages its own data
4. **Context-Aware** - Components understand the conversation
5. **Fault Tolerant** - Individual MCP failures don't break the component

## 📊 Performance Metrics

- **Skeleton Render**: <100ms (instant)
- **Context Extraction**: ~50ms
- **First Data**: ~200ms (partial state)
- **Full Enrichment**: ~500ms (all MCP calls complete)

## 🔧 Creating New Components with Sub-Agents

1. **Define the sub-agent config**:
```typescript
const config: SubAgentConfig = {
  componentName: "MyComponent",
  mcpTools: ["tool1", "tool2"],
  contextExtractor: (thread) => extractRelevantInfo(thread),
  dataEnricher: (context, tools) => [
    tools.tool1.execute(context),
    tools.tool2.execute(context),
  ],
};
```

2. **Use in your component**:
```tsx
const subAgent = useComponentSubAgent(config);
```

3. **Render with progressive data**:
```tsx
<LoadingWrapper state={subAgent.loadingState}>
  <YourComponent data={subAgent.enrichedData} />
</LoadingWrapper>
```

## 🚀 Advanced Features

### MCP Activity Indicators
Show users which data sources are active:
```tsx
<MCPStatusPanel
  activities={subAgent.mcpActivity}
  errors={subAgent.errors}
  enrichedData={subAgent.enrichedData}
/>
```

### Error Handling
Sub-agents handle errors gracefully:
- Failed MCP calls don't crash the component
- Errors are tracked and displayed
- Fallback data can be provided

### Refresh Capability
Components can re-fetch data:
```tsx
<button onClick={subAgent.refresh}>
  Refresh Data
</button>
```

## 🎨 The Magic

This architecture creates the "magical" experience where:
- Components appear instantly (no blank states)
- Data flows in progressively (users see progress)
- Each component is intelligent (has its own sub-agent)
- The system feels alive and responsive

No more waiting for props from Tambo - components take control of their own destiny!