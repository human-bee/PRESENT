/**
 * Progressive Loading System
 *
 * Implements the "Instant Skeleton, Progressive Soul" pattern
 * where components appear instantly (<100ms) as skeletons,
 * then progressively enhance with real data.
 */
import { useEffect, useState, useCallback, useRef } from 'react';
// Loading states for progressive rendering
export var LoadingState;
(function (LoadingState) {
    LoadingState["SKELETON"] = "skeleton";
    LoadingState["PARTIAL"] = "partial";
    LoadingState["COMPLETE"] = "complete";
})(LoadingState || (LoadingState = {}));
// Progressive loading hook
export function useProgressiveLoading(dataFetcher, options = {}) {
    const { skeletonDelay = 0, partialDelay = 200, completeDelay = 500, showProgress = true, } = options;
    const [state, setState] = useState(LoadingState.SKELETON);
    const [data, setData] = useState(null);
    const [progress, setProgress] = useState({
        state: LoadingState.SKELETON,
        progress: 0,
        eta: completeDelay,
    });
    const [error, setError] = useState(null);
    const startTimeRef = useRef(Date.now());
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
        }
        catch (err) {
            if (isMountedRef.current) {
                setError(err);
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
function extractPartialData(fullData) {
    if (!fullData || typeof fullData !== 'object') {
        return fullData;
    }
    // For objects, return essential fields first
    // This is a simple implementation - could be customized per component
    const partial = {};
    const essentialKeys = ['id', 'name', 'title', 'temperature', 'value', 'status'];
    for (const key in fullData) {
        if (essentialKeys.includes(key)) {
            partial[key] = fullData[key];
        }
    }
    return partial;
}
export function getProgressRingProps({ progress, size = 40, strokeWidth = 3, color = '#3b82f6', }) {
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
export function getTransitionStyles(state, duration = 300) {
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
export const preloadedSkeletons = new Map();
export function preloadSkeleton(componentName, skeleton) {
    preloadedSkeletons.set(componentName, skeleton);
}
export function getPreloadedSkeleton(componentName) {
    return preloadedSkeletons.get(componentName) || null;
}
//# sourceMappingURL=progressive-loading.js.map