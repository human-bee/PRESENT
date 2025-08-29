# Simplified Component Architecture

## The Problem We Solved

The original architecture was over-engineered with too many layers:

```
Tool → ToolDispatcher → Bus → ComponentStore → Bus → ToolDispatcher → Tool
```

This created:

- ❌ **Multiple failure points** - any break in the chain caused failures
- ❌ **State fragmentation** - components existed in multiple places
- ❌ **Complex async coordination** - timeouts, race conditions
- ❌ **Poor debugging experience** - hard to trace issues  
- ❌ **Brittle system** - adding features was difficult

## The New Simplified Approach

Instead of fighting React's patterns, we now use them directly:

```
Tool → ComponentRegistry → Component (direct state update)
```

### Key Components

#### 1. Simple Component Registry (`src/lib/component-registry.ts`)

```typescript
// Global component store using simple Map + React patterns
class ComponentStore {
  private components = new Map<string, ComponentInfo>();
  private listeners: Set<() => void> = new Set();

  // Direct operations - no complex async coordination
  register(info: ComponentInfo) { /* ... */ }
  async update(messageId: string, patch: Record<string, unknown>) { /* ... */ }
  list(contextKey?: string): ComponentInfo[] { /* ... */ }
}
```

#### 2. Direct Tools (`src/lib/custom.ts`)

```typescript
export const uiUpdateTool: customTool = {
  tool: async (componentId: string, patch: Record<string, unknown>) => {
    // Direct update - no bus, no dispatcher
    const result = await ComponentRegistry.update(componentId, patch);
    return result;
  }
};

export const listComponentsTool: customTool = {
  tool: async () => {
    // Direct access - no timeouts, no complex routing
    const components = ComponentRegistry.list();
    return { status: 'SUCCESS', components };
  }
};
```

#### 3. Component Integration Hook

```typescript
// Components register themselves and get automatic AI update handling
export function useComponentRegistration(
  messageId: string,
  componentType: string,
  props: Record<string, unknown>,
  contextKey: string,
  updateCallback?: (patch: Record<string, unknown>) => void
) {
  // Simple React patterns - useEffect + callbacks
}
```

## How It Works

### 1. Component Registration

When a component mounts, it registers itself:

```typescript
function MyTimer({ messageId, initialMinutes }) {
  const handleAIUpdate = useCallback((patch) => {
    if ('initialMinutes' in patch) {
      setTimer(patch.initialMinutes * 60);
    }
  }, []);

  useComponentRegistration(
    messageId,
    'Timer',
    { initialMinutes },
    'default',
    handleAIUpdate
  );
}
```

### 2. AI Tool Execution

```typescript
// 1. AI calls list_components
const components = await listComponentsTool();
// Returns: [{ messageId: "msg_ABC123", componentType: "Timer", props: {...} }]

// 2. AI calls ui_update with correct messageId
const result = await uiUpdateTool("msg_ABC123", { initialMinutes: 10 });
// Component instantly updates via callback!
```

### 3. State Flow

```
AI Request → Tool → ComponentRegistry → Component Callback → React State Update
```

## Benefits

### ✅ **Simplicity**

- Single source of truth (ComponentRegistry)
- Direct function calls (no async bus coordination)  
- Standard React patterns (useEffect, callbacks, state)

### ✅ **Reliability**

- No timeouts or race conditions
- Clear error messages with available component IDs
- Immediate feedback on success/failure

### ✅ **Developer Experience**

- Easy to debug (simple call stack)
- Easy to test (direct function calls)
- Easy to extend (add new component types)

### ✅ **Performance**

- No unnecessary bus traffic
- Direct state updates
- Minimal re-renders

## Migration Path

### From Old System

```typescript
// Old: Complex bus system
bus.send('component_list_request', { timestamp: Date.now() });
bus.on('component_list_response', (response) => { /* ... */ });
```

### To New System

```typescript
// New: Direct calls
const components = ComponentRegistry.list();
```

### For Components

```typescript
// Old: Complex bus listeners
useEffect(() => {
  const off = bus.on('ui_update', (msg) => {
    if (msg.componentId === myId) {
      // Update logic
    }
  });
  return off;
}, []);

// New: Simple registration
useComponentRegistration(messageId, 'MyComponent', props, context, updateCallback);
```

## Example: Timer Update Flow

1. **User**: "change timer to 10 minutes"
2. **AI calls list_components**:

   ```json
   {
     "status": "SUCCESS",
     "components": [{
       "messageId": "msg_timer_123",
       "componentType": "RetroTimer", 
       "props": { "initialMinutes": 5 }
     }]
   }
   ```

3. **AI calls ui_update**:

   ```typescript
   uiUpdateTool("msg_timer_123", { "initialMinutes": 10 })
   ```

4. **Component receives update**:

   ```typescript
   handleAIUpdate({ initialMinutes: 10 }) // → setState({ timeLeft: 600 })
   ```

5. **Timer instantly updates to 10 minutes** ✅

## Why This Works Better

### **React-First Philosophy**

Instead of creating a distributed system for what is fundamentally local state management, we use React's built-in patterns:

- Context for global state
- useEffect for lifecycle management  
- Callbacks for communication
- Direct function calls for actions

### **Principle of Least Surprise**

Every operation does exactly what you expect:

- `list_components()` → returns components
- `update_component(id, patch)` → updates component
- No hidden timeouts, retries, or async coordination

### **Single Responsibility**

- **ComponentRegistry**: Manages component state
- **Tools**: Handle AI requests
- **Components**: Render UI and handle updates
- **Bus System**: Only for cross-participant communication (voice agent ↔ browser)

## Next Steps

1. **Test the new system** with timer updates
2. **Migrate other components** to use `useComponentRegistration`
3. **Remove old bus-based component list code** from message-thread-collapsible.tsx
4. **Update existing components** to use the simplified patterns
5. **Add more sophisticated update handling** (validation, rollback, etc.)

The goal is to have a system that "just works" and is easy to understand, debug, and extend.
