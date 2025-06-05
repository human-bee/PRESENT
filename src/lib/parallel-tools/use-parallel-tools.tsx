/**
 * @file parallel-tools/use-parallel-tools.tsx
 * @description React hook for integrating parallel tool execution with Tambo components
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { useTamboComponentState, TamboTool } from '@tambo-ai/react';
import { z } from 'zod';
import { 
  ParallelToolCoordinator, 
  ParallelTamboTool, 
  ToolExecutionResult,
  ToolProgressUpdate,
  ExecutionMetrics
} from './index';

export interface ParallelToolsState {
  isExecuting: boolean;
  progress: ToolProgressUpdate | null;
  results: ToolExecutionResult[];
  metrics: ExecutionMetrics | null;
  errors: Error[];
  pendingApprovals: string[];
}

export interface UseParallelToolsOptions {
  onProgress?: (update: ToolProgressUpdate) => void;
  onComplete?: (results: ToolExecutionResult[]) => void;
  onError?: (error: Error) => void;
  stateKey?: string;
}

/**
 * Hook for using parallel tool execution in Tambo components
 */
export function useParallelTools(options: UseParallelToolsOptions = {}) {
  const { 
    onProgress, 
    onComplete, 
    onError,
    stateKey = 'parallel-tools'
  } = options;

  const coordinatorRef = useRef<ParallelToolCoordinator>();
  
  // Tambo state management
  const [state, setState] = useTamboComponentState<ParallelToolsState>(
    stateKey,
    {
      isExecuting: false,
      progress: null,
      results: [],
      metrics: null,
      errors: [],
      pendingApprovals: []
    }
  );

  // Initialize coordinator
  useEffect(() => {
    const coordinator = new ParallelToolCoordinator();
    coordinatorRef.current = coordinator;

    // Set up event listeners
    coordinator.on('toolStart', (data) => {
      const progressUpdate: ToolProgressUpdate = {
        type: 'tool_start',
        toolName: data.tool,
        groupIndex: data.groupIndex
      };
      
      setState(prev => ({
        ...prev,
        progress: progressUpdate
      }));
      
      onProgress?.(progressUpdate);
    });

    coordinator.on('toolComplete', (data) => {
      setState(prev => ({
        ...prev,
        results: [...prev.results, data.result]
      }));
    });

    coordinator.on('toolError', (data) => {
      setState(prev => ({
        ...prev,
        errors: [...prev.errors, data.error]
      }));
      onError?.(data.error);
    });

    coordinator.on('approvalRequired', (data) => {
      setState(prev => ({
        ...prev,
        pendingApprovals: [...prev.pendingApprovals, data.tool]
      }));
    });

    coordinator.on('groupComplete', () => {
      const metrics = coordinator.getExecutionMetrics();
      setState(prev => ({
        ...prev,
        metrics
      }));
    });

    coordinator.on('allComplete', (data) => {
      setState(prev => ({
        ...prev,
        isExecuting: false
      }));
      onComplete?.(data.results);
    });

    return () => {
      coordinator.removeAllListeners();
    };
  }, [setState, onError, onProgress, onComplete]);

  // Execute tools in parallel
  const executeParallel = useCallback(async (
    tools: ParallelTamboTool[], 
    userRequest: string
  ): Promise<ToolExecutionResult[]> => {
    if (!coordinatorRef.current) {
      throw new Error('Coordinator not initialized');
    }

    setState(prev => ({
      ...prev,
      isExecuting: true,
      results: [],
      errors: [],
      metrics: null
    }));

    try {
      const results = await coordinatorRef.current.executeParallel(tools, userRequest);
      return results;
    } catch (error) {
      setState(prev => ({
        ...prev,
        isExecuting: false,
        errors: [...prev.errors, error as Error]
      }));
      throw error;
    }
  }, [setState]);

  // Approve a pending tool execution
  const approveTool = useCallback((toolId: string) => {
    if (!coordinatorRef.current) return;
    
    coordinatorRef.current.approveTool(toolId);
    
    setState(prev => ({
      ...prev,
      pendingApprovals: prev.pendingApprovals.filter(id => id !== toolId)
    }));
  }, [setState]);

  // Clear all results and reset state
  const reset = useCallback(() => {
    setState(prev => ({
      ...prev,
      isExecuting: false,
      progress: null,
      results: [],
      metrics: null,
      errors: [],
      pendingApprovals: []
    }));
  }, [setState]);

  return {
    // State
    isExecuting: state?.isExecuting ?? false,
    results: state?.results ?? [],
    errors: state?.errors ?? [],
    metrics: state?.metrics ?? null,
    pendingApprovals: state?.pendingApprovals ?? [],
    state,
    
    // Actions
    executeParallel,
    approveTool,
    reset
  };
} 