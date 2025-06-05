"use client";

/**
 * @file client-wrapper.tsx
 * @description Client-side wrapper for parallel tools to avoid SSR/Edge Runtime issues
 */

import dynamic from 'next/dynamic';
import { ComponentType } from 'react';

// Dynamically import parallel tools only on client side
export const ParallelToolsProvider = dynamic(
  () => import('./use-parallel-tools').then(mod => ({ 
    default: ({ children }: { children: React.ReactNode }) => <>{children}</> 
  })),
  {
    ssr: false,
    loading: () => <div>Loading parallel tools...</div>
  }
);

// Client-side only hook
export const useParallelTools = dynamic(
  () => import('./use-parallel-tools').then(mod => mod.useParallelTools),
  {
    ssr: false,
  }
) as any; // Type assertion to avoid SSR type issues

// Client-side only coordinator
export const ParallelToolCoordinator = dynamic(
  () => import('./index').then(mod => mod.ParallelToolCoordinator),
  {
    ssr: false,
  }
) as any;

// Re-export types that are safe for SSR
export type {
  ParallelToolsState,
  UseParallelToolsOptions,
  ToolExecutionResult,
  ToolProgressUpdate,
  ExecutionMetrics,
  ParallelTamboTool
} from './index';

// Safe mock for SSR
export const useParallelToolsSSR = () => ({
  isExecuting: false,
  results: [],
  errors: [],
  metrics: null,
  pendingApprovals: [],
  state: null,
  executeParallel: async () => [],
  approveTool: () => {},
  reset: () => {}
}); 