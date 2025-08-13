# Progressive Loading System

## 🚀 "Instant Skeleton, Progressive Soul"

This system implements progressive component loading where components appear instantly (<100ms) as skeletons, then progressively enhance with real data.

## Core Concept

Components transition through 3 states:
1. **Skeleton** (instant) - Beautiful loading placeholder
2. **Partial** (~200ms) - Basic data appears  
3. **Complete** (~500ms) - Fully enriched with all features

## Implementation Guide

### 1. Basic Usage

Add progressive loading to any component:

```tsx
import { useComponentProgressiveLoading, LoadingState } from "@/lib/with-progressive-loading";
import { LoadingWrapper, SkeletonPatterns } from "@/components/ui/loading-states";

export function MyComponent(props: Props) {
  // Add progressive loading state
  const { 
    state: loadingState, 
    updateState: setLoadingState 
  } = useComponentProgressiveLoading(null);
  
  // Simulate progressive loading on mount
  useEffect(() => {
    if (loadingState === LoadingState.SKELETON) {
      setTimeout(() => setLoadingState(LoadingState.PARTIAL), 150);
      setTimeout(() => setLoadingState(LoadingState.COMPLETE), 400);
    }
  }, [loadingState, setLoadingState]);
  
  // Wrap your component
  return (
    <LoadingWrapper
      state={loadingState}
      skeleton={SkeletonPatterns.card} // or custom skeleton
      showLoadingIndicator={true}
      loadingProgress={{
        state: loadingState,
        progress: loadingState === LoadingState.SKELETON ? 33 :
                 loadingState === LoadingState.PARTIAL ? 66 : 100,
        message: loadingState === LoadingState.SKELETON ? "Loading..." :
                loadingState === LoadingState.PARTIAL ? "Almost ready..." : "Complete!",
        eta: loadingState === LoadingState.SKELETON ? 400 :
             loadingState === LoadingState.PARTIAL ? 200 : 0,
      }}
    >
      {/* Your component content */}
    </LoadingWrapper>
  );
}
```

### 2. Custom Skeletons

Create custom skeleton patterns:

```tsx
const customSkeleton = (
  <div className="p-6 space-y-4">
    <Skeleton className="h-8 w-3/4" />
    <TextSkeleton lines={3} />
    <div className="flex space-x-2">
      <Skeleton className="h-10 w-24" />
      <Skeleton className="h-10 w-24" />
    </div>
  </div>
);

// Use in LoadingWrapper
<LoadingWrapper skeleton={customSkeleton} ...>
```

### 3. Available Skeleton Patterns

- `SkeletonPatterns.card` - Generic card layout
- `SkeletonPatterns.weather` - Weather forecast layout
- `SkeletonPatterns.timer` - Timer/clock layout
- `SkeletonPatterns.list(count)` - List with N items
- `SkeletonPatterns.form` - Form layout

### 4. Visual Effects

The system includes:
- **Shimmer effects** - Animated loading placeholders
- **Progress rings** - Circular progress indicators
- **Smooth transitions** - Fade/scale animations between states
- **Completion pulse** - Visual feedback when loading completes

### 5. Performance Tips

1. **Preload skeletons** for instant rendering
2. **Use partial data** from cache when available
3. **Optimize state transitions** to feel natural
4. **Background fetch** data while showing skeleton

## Examples

### Weather Component
Shows skeleton → temperature/location → full forecast with animations

### Timer Component  
Shows skeleton → timer display → controls and presets

### Action Items
Shows skeleton list → item count → full interactive list

## API Reference

### `useComponentProgressiveLoading<T>(initialData)`
Hook for managing progressive loading states.

### `LoadingWrapper` Props
- `state`: Current loading state
- `skeleton`: Skeleton component/pattern
- `showLoadingIndicator`: Show progress indicator
- `loadingProgress`: Progress details object

### `LoadingState` Enum
- `SKELETON` - Initial loading state
- `PARTIAL` - Partial data loaded
- `COMPLETE` - Fully loaded

## Best Practices

1. **Always show skeleton first** - Never show blank states
2. **Keep transitions smooth** - Use appropriate durations
3. **Match skeleton to content** - Skeleton should resemble final layout
4. **Provide feedback** - Show progress and ETA when possible
5. **Handle errors gracefully** - Show error states with retry options