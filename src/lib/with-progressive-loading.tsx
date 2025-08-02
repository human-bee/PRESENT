/**
 * Higher-Order Component for Progressive Loading
 * 
 * Wraps any component with progressive loading capabilities
 */

"use client";

import React, { ComponentType, useState, useEffect } from "react";
import { useProgressiveLoading, LoadingState, ComponentLoadingStates } from "./progressive-loading";
import { LoadingWrapper, Skeleton, SkeletonPatterns } from "@/components/ui/loading-states";

// Re-export LoadingState for component usage
export { LoadingState } from "./progressive-loading";

export interface WithProgressiveLoadingOptions<P> {
  // Function to fetch data for the component
  dataFetcher?: (props: P) => Promise<any>;
  
  // Custom loading states
  loadingStates?: ComponentLoadingStates<any>;
  
  // Default skeleton to use
  skeletonType?: keyof typeof SkeletonPatterns | React.ReactNode;
  
  // Loading options
  loadingOptions?: {
    skeletonDelay?: number;
    partialDelay?: number;
    completeDelay?: number;
    showProgress?: boolean;
  };
  
  // Component name for debugging
  componentName?: string;
}

/**
 * HOC that adds progressive loading to any component
 */
export function withProgressiveLoading<P extends object>(
  Component: ComponentType<P>,
  options: WithProgressiveLoadingOptions<P> = {}
) {
  const {
    dataFetcher,
    loadingStates,
    skeletonType = "card",
    loadingOptions = {},
    componentName = Component.displayName || Component.name || "Component",
  } = options;

  const WrappedComponent = (props: P) => {
    // If no data fetcher provided, just render the component
    if (!dataFetcher) {
      return <Component {...props} />;
    }

    // Use progressive loading hook
    const { state, data, progress, error } = useProgressiveLoading(
      () => dataFetcher(props),
      loadingOptions
    );

    // Get skeleton
    const skeleton = React.useMemo(() => {
      if (React.isValidElement(skeletonType)) {
        return skeletonType;
      }
      if (typeof skeletonType === "string" && skeletonType in SkeletonPatterns) {
        const pattern = SkeletonPatterns[skeletonType as keyof typeof SkeletonPatterns];
        return typeof pattern === "function" ? pattern() : pattern;
      }
      return <Skeleton className="h-64 w-full" />;
    }, [skeletonType]);

    // Handle error state
    if (error) {
      return (
        <div className="p-6 text-center">
          <p className="text-red-400">Error loading {componentName}</p>
          <p className="text-sm text-slate-400 mt-2">{error.message}</p>
        </div>
      );
    }

    // Use custom loading states if provided
    if (loadingStates) {
      switch (state) {
        case LoadingState.SKELETON:
          return <>{loadingStates.skeleton}</>;
        case LoadingState.PARTIAL:
          return <>{loadingStates.partial(data || {})}</>;
        case LoadingState.COMPLETE:
          return <>{loadingStates.complete(data || {})}</>;
      }
    }

    // Default rendering with loading wrapper
    return (
      <LoadingWrapper
        state={state}
        skeleton={skeleton}
        loadingProgress={progress}
        showLoadingIndicator={loadingOptions.showProgress !== false}
      >
        <Component {...props} {...(data || {})} />
      </LoadingWrapper>
    );
  };

  WrappedComponent.displayName = `WithProgressiveLoading(${componentName})`;
  
  return WrappedComponent;
}

/**
 * Hook for components that want to manage their own progressive loading
 */
export function useComponentProgressiveLoading<T>(
  initialData: T | null = null
): {
  state: LoadingState;
  data: T | null;
  updateState: (state: LoadingState) => void;
  updateData: (data: Partial<T>) => void;
  simulateProgression: () => void;
} {
  const [state, setState] = useState<LoadingState>(
    initialData ? LoadingState.COMPLETE : LoadingState.SKELETON
  );
  const [data, setData] = useState<T | null>(initialData);

  const updateState = (newState: LoadingState) => setState(newState);
  
  const updateData = (partialData: Partial<T>) => {
    setData(current => ({
      ...current,
      ...partialData,
    } as T));
  };

  // Simulate natural progression through states
  const simulateProgression = () => {
    setState(LoadingState.SKELETON);
    
    setTimeout(() => setState(LoadingState.PARTIAL), 200);
    setTimeout(() => setState(LoadingState.COMPLETE), 500);
  };

  return {
    state,
    data,
    updateState,
    updateData,
    simulateProgression,
  };
}

/**
 * Component decorator for class components
 */
export function ProgressiveLoading<P extends object>(
  options: WithProgressiveLoadingOptions<P> = {}
) {
  return function (Component: ComponentType<P>) {
    return withProgressiveLoading(Component, options);
  };
}