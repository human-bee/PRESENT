# Parallel Tool Execution Integration Guide

This guide explains how to use the new parallel tool execution system that integrates Tambo UI with OpenAI Agents JS.

## Overview

The parallel tool execution system provides:

- **Automatic Dependency Detection**: Tools that depend on each other are automatically ordered
- **Parallel Execution**: Independent tools run concurrently for faster results
- **State Synchronization**: Full integration with Tambo's state management
- **Canvas Integration**: Components automatically register with the tldraw canvas
- **Streaming Support**: Real-time progress updates during execution
- **Human-in-the-Loop**: Approval workflows for sensitive operations

## Architecture

```
┌─────────────────────┐
│   Tambo Component   │
│  (React + State)    │
└──────────┬──────────┘
           │
   ┌───────▼───────┐
   │ useParallel   │
   │     Tools     │
   │   (Hook)      │
   └───────┬───────┘
           │
┌──────────▼──────────┐
│ ParallelTool        │
│   Coordinator       │
│ (OpenAI Agents)     │
└──────────┬──────────┘
           │
    ┌──────▼──────┐
    │  Canvas     │
    │ Integration │
    └─────────────┘
```

## Edge Runtime Compatibility

⚠️ **Important**: The OpenAI Agents package is not compatible with Next.js Edge Runtime. To resolve this:

### Current Status
- ✅ **Build**: Successfully compiles
- ✅ **Development**: No runtime errors
- ❌ **Edge Runtime**: Temporarily disabled for parallel tools

### Solutions Implemented

1. **Webpack Configuration** (`next.config.ts`):
   ```typescript
   // Exclude OpenAI agents from server bundles
   if (isServer) {
     config.externals = config.externals || [];
     config.externals.push('@openai/agents');
   }
   ```

2. **Client-Side Only Loading** (`client-wrapper.tsx`):
   ```typescript
   export const useParallelTools = dynamic(
     () => import('./use-parallel-tools').then(mod => mod.useParallelTools),
     { ssr: false }
   );
   ```

3. **Component Registration**:
   ```typescript
   // Temporarily commented out in tambo.ts
   // Will be re-enabled with edge-compatible implementation
   ```

## Usage

### 1. Basic Parallel Execution

```typescript
import { useParallelTools } from '@/lib/parallel-tools/client-wrapper';

function MyComponent() {
  const { executeParallel, isExecuting, results } = useParallelTools();
  
  const runParallelTools = async () => {
    const tools = [
      {
        name: 'research_topic_1',
        description: 'Research AI trends',
        tool: async () => { /* research logic */ },
        metadata: { canRunInParallel: true }
      },
      {
        name: 'research_topic_2', 
        description: 'Research blockchain',
        tool: async () => { /* research logic */ },
        metadata: { canRunInParallel: true }
      }
    ];
    
    await executeParallel(tools, "Research these topics");
  };
  
  return (
    <div>
      <button onClick={runParallelTools} disabled={isExecuting}>
        {isExecuting ? 'Executing...' : 'Start Research'}
      </button>
      {results.map(result => (
        <div key={result.toolId}>{result.result}</div>
      ))}
    </div>
  );
}
```

### 2. With Progress Tracking

```typescript
const { executeParallel, isExecuting, metrics } = useParallelTools({
  onProgress: (update) => {
    console.log(`Tool ${update.toolName} - ${update.type}`);
  },
  onComplete: (results) => {
    console.log(`Completed ${results.length} tools`);
  }
});
```

### 3. Canvas Integration

```typescript
// Components automatically register with canvas
useEffect(() => {
  window.dispatchEvent(
    new CustomEvent('tambo:showComponent', {
      detail: {
        messageId: `parallel-demo-${Date.now()}`,
        component: <ParallelToolsDemo />
      }
    })
  );
}, []);
```

## Performance Benefits

The parallel execution system can provide significant performance improvements:

- **2-5x speedup** for independent operations
- **Intelligent grouping** based on dependencies
- **Resource optimization** with configurable concurrency limits
- **Execution metrics** for performance monitoring

## Roadmap

### Short Term (Next 2-4 weeks)
- [ ] Create edge-runtime compatible version using Web Workers
- [ ] Re-enable ParallelResearchPanel component
- [ ] Add more tool templates and examples

### Medium Term (1-2 months)
- [ ] Integration with more MCP servers
- [ ] Advanced dependency detection algorithms
- [ ] Custom tool marketplace

### Long Term (3+ months)
- [ ] Distributed execution across multiple agents
- [ ] ML-powered execution optimization
- [ ] Integration with external compute resources

## Troubleshooting

### Common Issues

1. **"Cannot find module @openai/agents"**
   - Ensure package is installed: `npm install @openai/agents`
   - Check import paths use client-wrapper

2. **Edge Runtime Errors**
   - Use client-side wrapper: `import { useParallelTools } from '@/lib/parallel-tools/client-wrapper'`
   - Ensure components have `"use client"` directive

3. **Canvas Integration Issues**
   - Verify TamboProvider is wrapping your app
   - Check canvas event listeners are properly set up

### Debug Mode

Enable debug logging:
```typescript
const coordinator = new ParallelToolCoordinator();
coordinator.on('*', (eventName, data) => {
  console.log(`[ParallelTools] ${eventName}:`, data);
});
```

## Contributing

When adding new parallel tool capabilities:

1. **Test edge runtime compatibility**
2. **Add comprehensive error handling**
3. **Include progress tracking**
4. **Document dependencies clearly**
5. **Add integration tests**

## Next Steps

1. **Try the Demo**: Once re-enabled, use the ParallelResearchPanel component
2. **Create Custom Tools**: Build your own parallel-capable tools
3. **Monitor Performance**: Use the built-in metrics to optimize execution
4. **Provide Feedback**: Help us improve the system based on your use cases

---

*This implementation provides a foundation for powerful parallel AI tool coordination while maintaining compatibility with your existing Tambo and Canvas infrastructure.* 