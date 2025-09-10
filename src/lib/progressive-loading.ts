/**
 * Progressive Loading System
 *
 * Implements the "Instant Skeleton, Progressive Soul" pattern
 * where components appear instantly (<100ms) as skeletons,
 * then progressively enhance with real data.
 */

import { useEffect, useState, useCallback, useRef } from 'react';

// Loading states for progressive rendering
export enum LoadingState {
  SKELETON = 'skeleton', // Instant placeholder
  PARTIAL = 'partial', // Basic data loaded
  COMPLETE = 'complete', // Fully loaded
}

// Component loading states interface
export interface ComponentLoadingStates<T> {
  skeleton: React.ReactNode;
  partial: (data: Partial<T>) => React.ReactNode;
  complete: (data: T) => React.ReactNode;
}

// Progressive loading options
export interface ProgressiveLoadingOptions {
  skeletonDelay?: number; // Delay before showing skeleton (default: 0ms)
  partialDelay?: number; // Delay before partial state (default: 200ms)
  completeDelay?: number; // Delay before complete state (default: 500ms)
  showProgress?: boolean; // Show progress indicator
  animationDuration?: number; // Transition animation duration
}

// Loading progress data
export interface LoadingProgress {
  state: LoadingState;
  progress: number; // 0-100
  eta?: number; // Estimated time remaining in ms
  message?: string; // Loading message
}

// Progressive loading hook
export function useProgressiveLoading<T>(
  dataFetcher: () => Promise<T>,
  options: ProgressiveLoadingOptions = {},
): {
  state: LoadingState;
  data: Partial<T> | null;
  progress: LoadingProgress;
  error: Error | null;
  retry: () => void;
} {
  const {
    skeletonDelay = 0,
    partialDelay = 200,
    completeDelay = 500,
    showProgress = true,
  } = options;

  const [state, setState] = useState<LoadingState>(LoadingState.SKELETON);
  const [data, setData] = useState<Partial<T> | null>(null);
  const [progress, setProgress] = useState<LoadingProgress>({
    state: LoadingState.SKELETON,
    progress: 0,
    eta: completeDelay,
  });
  const [error, setError] = useState<Error | null>(null);

  const startTimeRef = useRef<number>(Date.now());
  const isMountedRef = useRef(true);

  const loadData = useCallback(async () => {
    try {
      startTimeRef.current = Date.now();
      setError(null);
      setState(LoadingState.SKELETON);
      setProgress({
        state: LoadingState.SKELETON,
        progress: 0,
        eta: completeDelay,
        message: 'Loading...',
      });

      // Simulate progressive loading stages
      const loadPromise = dataFetcher();

      // Skeleton stage (instant)
      setTimeout(() => {
        if (isMountedRef.current) {
          setProgress({
            state: LoadingState.SKELETON,
            progress: 33,
            eta: completeDelay - skeletonDelay,
            message: 'Preparing...',
          });
        }
      }, skeletonDelay);

      // Partial stage (200ms)
      setTimeout(() => {
        if (isMountedRef.current && state !== LoadingState.COMPLETE) {
          setState(LoadingState.PARTIAL);
          setProgress({
            state: LoadingState.PARTIAL,
            progress: 66,
            eta: completeDelay - partialDelay,
            message: 'Loading data...',
          });

          // In real implementation, this could be partial data from cache
          // or initial server response
          loadPromise.then((fullData) => {
            if (isMountedRef.current && state === LoadingState.PARTIAL) {
              // Set partial data (could be subset of full data)
              const partialData = extractPartialData(fullData);
              setData(partialData);
            }
          });
        }
      }, partialDelay);

      // Complete stage (500ms)
      const fullData = await loadPromise;
      const elapsed = Date.now() - startTimeRef.current;
      const remainingDelay = Math.max(0, completeDelay - elapsed);

      setTimeout(() => {
        if (isMountedRef.current) {
          setState(LoadingState.COMPLETE);
          setData(fullData);
          setProgress({
            state: LoadingState.COMPLETE,
            progress: 100,
            eta: 0,
            message: 'Complete!',
          });
        }
      }, remainingDelay);
    } catch (err) {
      if (isMountedRef.current) {
        setError(err as Error);
        setState(LoadingState.COMPLETE);
        setProgress({
          state: LoadingState.COMPLETE,
          progress: 0,
          eta: 0,
          message: 'Error loading',
        });
      }
    }
  }, [dataFetcher, skeletonDelay, partialDelay, completeDelay, state]);

  useEffect(() => {
    isMountedRef.current = true;
    loadData();

    return () => {
      isMountedRef.current = false;
    };
  }, []);

  return {
    state,
    data,
    progress,
    error,
    retry: loadData,
  };
}

// Helper to extract partial data from full data
function extractPartialData<T>(fullData: T): Partial<T> {
  if (!fullData || typeof fullData !== 'object') {
    return fullData as Partial<T>;
  }

  // For objects, return essential fields first
  // This is a simple implementation - could be customized per component
  const partial: Partial<T> = {};
  const essentialKeys = ['id', 'name', 'title', 'temperature', 'value', 'status'];

  for (const key in fullData) {
    if (essentialKeys.includes(key)) {
      partial[key as keyof T] = fullData[key as keyof T];
    }
  }

  return partial;
}

// Progress ring component helper
export interface ProgressRingProps {
  progress: number;
  size?: number;
  strokeWidth?: number;
  color?: string;
}

export function getProgressRingProps({
  progress,
  size = 40,
  strokeWidth = 3,
  color = '#3b82f6',
}: ProgressRingProps) {
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  const offset = circumference - (progress / 100) * circumference;

  return {
    size,
    viewBox: `0 0 ${size} ${size}`,
    strokeWidth,
    radius,
    circumference,
    strokeDasharray: `${circumference} ${circumference}`,
    strokeDashoffset: offset,
    color,
  };
}

// Animation helper for smooth transitions
export function getTransitionStyles(state: LoadingState, duration = 300) {
  const baseTransition = `all ${duration}ms cubic-bezier(0.4, 0, 0.2, 1)`;

  switch (state) {
    case LoadingState.SKELETON:
      return {
        opacity: 0.5,
        transform: 'scale(0.98)',
        transition: baseTransition,
      };
    case LoadingState.PARTIAL:
      return {
        opacity: 0.8,
        transform: 'scale(0.99)',
        transition: baseTransition,
      };
    case LoadingState.COMPLETE:
      return {
        opacity: 1,
        transform: 'scale(1)',
        transition: baseTransition,
      };
  }
}

// Preload common component shells
export const preloadedSkeletons = new Map<string, React.ReactNode>();

export function preloadSkeleton(componentName: string, skeleton: React.ReactNode) {
  preloadedSkeletons.set(componentName, skeleton);
}

export function getPreloadedSkeleton(componentName: string): React.ReactNode | null {
  return preloadedSkeletons.get(componentName) || null;
}
