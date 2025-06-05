/**
 * @file parallel-research-panel.tsx
 * @description Component demonstrating parallel tool execution with canvas integration
 */

"use client";

import React, { useEffect, useState } from 'react';
import { z } from 'zod';
import { useTamboComponentState } from '@tambo-ai/react';
import { useParallelTools, useParallelToolsSSR } from '@/lib/parallel-tools/client-wrapper';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Loader2, CheckCircle, XCircle, Clock, AlertCircle } from 'lucide-react';

export const parallelResearchPanelSchema = z.object({
  topics: z.array(z.string()).describe('Topics to research in parallel'),
  enableParallel: z.boolean().optional().describe('Enable parallel execution'),
  maxConcurrency: z.number().optional().describe('Maximum concurrent operations'),
  autoExecute: z.boolean().optional().describe('Automatically start research on mount'),
});

export type ParallelResearchPanelProps = z.infer<typeof parallelResearchPanelSchema>;

interface ResearchState {
  canvasComponentId?: string;
  executionHistory: ExecutionRecord[];
  totalExecutions: number;
  averageSpeedup: number;
}

interface ExecutionRecord {
  timestamp: Date;
  toolCount: number;
  parallelGroups: number;
  totalTime: number;
  speedup: number;
}

export function ParallelResearchPanel({
  topics = [],
  enableParallel = true,
  maxConcurrency = 3,
  autoExecute = false,
}: ParallelResearchPanelProps) {
  const [state, setState] = useTamboComponentState<ResearchState>(
    `parallel-research-${topics.join('-')}`,
    {
      executionHistory: [],
      totalExecutions: 0,
      averageSpeedup: 0,
    }
  );

  // Use client-side hook with SSR fallback
  const [isClient, setIsClient] = useState(false);
  
  useEffect(() => {
    setIsClient(true);
  }, []);

  const parallelToolsHook = isClient ? useParallelTools : useParallelToolsSSR;
  
  const {
    isExecuting,
    results,
    errors,
    metrics,
    pendingApprovals,
    executeParallel,
    approveTool,
    state: parallelState,
  } = parallelToolsHook({
    onComplete: (results: any) => {
      // Update canvas with results
      if (state?.canvasComponentId) {
        window.dispatchEvent(
          new CustomEvent('tambo:updateCanvasComponent', {
            detail: {
              componentId: state.canvasComponentId,
              updates: { results },
            },
          })
        );
      }
    },
  });

  // Auto-execute on mount if requested
  useEffect(() => {
    if (autoExecute && topics.length > 0 && !isExecuting) {
      handleExecuteResearch();
    }
  }, [autoExecute, topics.length]);

  // Register with canvas on mount
  useEffect(() => {
    const componentId = `parallel-research-${Date.now()}`;
    setState(prev => ({ ...prev, canvasComponentId: componentId }));

    window.dispatchEvent(
      new CustomEvent('tambo:showComponent', {
        detail: {
          messageId: componentId,
          component: <ParallelResearchPanel {...{ topics, enableParallel, maxConcurrency }} />,
        },
      })
    );

    return () => {
      window.dispatchEvent(
        new CustomEvent('tambo:removeCanvasComponent', {
          detail: { componentId },
        })
      );
    };
  }, []);

  const handleExecuteResearch = async () => {
    const startTime = Date.now();

    // Create parallel tools for each topic
    const researchTools = topics.map((topic, index) => ({
      name: `research_${topic.replace(/\s+/g, '_')}`,
      description: `Research information about ${topic}`,
      tool: async () => {
        // Simulate research with varying durations
        await new Promise(resolve => 
          setTimeout(resolve, Math.random() * 2000 + 1000)
        );
        return {
          topic,
          findings: `Research findings for ${topic}...`,
          sources: Math.floor(Math.random() * 5) + 1,
          confidence: Math.random(),
        };
      },
      inputSchema: z.object({}),
      metadata: {
        toolId: `research_${index}`,
        toolName: `research_${topic}`,
        canRunInParallel: enableParallel,
        estimatedDuration: 2000,
        priority: topics.length - index,
      },
    }));

    try {
      await executeParallel(
        researchTools,
        `Research these topics: ${topics.join(', ')}`
      );

      const executionTime = Date.now() - startTime;
      const sequentialEstimate = topics.length * 2000; // Estimated sequential time
      const speedup = sequentialEstimate / executionTime;

      // Update execution history
      if (metrics) {
        const record: ExecutionRecord = {
          timestamp: new Date(),
          toolCount: metrics.totalTools,
          parallelGroups: metrics.parallelGroups,
          totalTime: executionTime,
          speedup,
        };

        setState(prev => ({
          ...prev,
          executionHistory: [...prev.executionHistory, record],
          totalExecutions: prev.totalExecutions + 1,
          averageSpeedup: 
            (prev.averageSpeedup * prev.totalExecutions + speedup) / 
            (prev.totalExecutions + 1),
        }));
      }
    } catch (error) {
      console.error('Research execution failed:', error);
    }
  };

  const getProgressPercentage = () => {
    if (!isExecuting || !metrics) return 0;
    return (metrics.successfulTools / metrics.totalTools) * 100;
  };

  return (
    <Card className="w-full max-w-4xl">
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>Parallel Research Panel</span>
          <div className="flex gap-2">
            {enableParallel && (
              <Badge variant="secondary">
                Parallel Mode
              </Badge>
            )}
            {state?.averageSpeedup > 1 && (
              <Badge variant="success">
                {state.averageSpeedup.toFixed(1)}x Speedup
              </Badge>
            )}
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Execution Controls */}
        <div className="flex gap-2">
          <Button
            onClick={handleExecuteResearch}
            disabled={isExecuting || topics.length === 0}
            className="flex-1"
          >
            {isExecuting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Researching...
              </>
            ) : (
              'Start Research'
            )}
          </Button>
          {pendingApprovals.length > 0 && (
            <Button
              variant="outline"
              onClick={() => pendingApprovals.forEach(approveTool)}
            >
              Approve All ({pendingApprovals.length})
            </Button>
          )}
        </div>

        {/* Progress Indicator */}
        {isExecuting && (
          <div className="space-y-2">
            <Progress value={getProgressPercentage()} />
            <div className="text-sm text-muted-foreground">
              {parallelState?.progress?.type === 'group_start' && (
                <span>
                  Processing group {(parallelState.progress.groupIndex || 0) + 1} of{' '}
                  {parallelState.progress.totalGroups}
                </span>
              )}
              {parallelState?.progress?.type === 'tool_start' && (
                <span>Executing: {parallelState.progress.toolName}</span>
              )}
            </div>
          </div>
        )}

        {/* Execution Metrics */}
        {metrics && !isExecuting && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="text-center">
              <div className="text-2xl font-bold">{metrics.totalTools}</div>
              <div className="text-sm text-muted-foreground">Total Tools</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold">{metrics.parallelGroups}</div>
              <div className="text-sm text-muted-foreground">Parallel Groups</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold">
                {(metrics.totalExecutionTime / 1000).toFixed(1)}s
              </div>
              <div className="text-sm text-muted-foreground">Total Time</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold">
                {(metrics.averageExecutionTime / 1000).toFixed(1)}s
              </div>
              <div className="text-sm text-muted-foreground">Avg per Tool</div>
            </div>
          </div>
        )}

        {/* Results Display */}
        <div className="space-y-2">
          {results.map((result, index) => (
            <div
              key={result.toolId}
              className="flex items-center justify-between p-3 border rounded-lg"
            >
              <div className="flex items-center gap-2">
                {result.error ? (
                  <XCircle className="h-4 w-4 text-destructive" />
                ) : (
                  <CheckCircle className="h-4 w-4 text-success" />
                )}
                <span className="font-medium">{result.toolId}</span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                {result.parallelGroup !== undefined && (
                  <Badge variant="outline">Group {result.parallelGroup + 1}</Badge>
                )}
                <span className="text-muted-foreground">
                  {(result.executionTime / 1000).toFixed(1)}s
                </span>
              </div>
            </div>
          ))}
        </div>

        {/* Errors Display */}
        {errors.length > 0 && (
          <div className="space-y-2">
            {errors.map((error, index) => (
              <div
                key={index}
                className="flex items-start gap-2 p-3 border border-destructive/50 rounded-lg bg-destructive/10"
              >
                <AlertCircle className="h-4 w-4 text-destructive mt-0.5" />
                <div className="text-sm">{error.message}</div>
              </div>
            ))}
          </div>
        )}

        {/* Execution History */}
        {state?.executionHistory.length > 0 && (
          <div className="mt-4 pt-4 border-t">
            <h4 className="text-sm font-medium mb-2">Execution History</h4>
            <div className="space-y-1">
              {state.executionHistory.slice(-3).map((record, index) => (
                <div
                  key={index}
                  className="flex items-center justify-between text-sm text-muted-foreground"
                >
                  <span>
                    <Clock className="inline h-3 w-3 mr-1" />
                    {new Date(record.timestamp).toLocaleTimeString()}
                  </span>
                  <span>
                    {record.toolCount} tools in {record.parallelGroups} groups
                  </span>
                  <span className="font-medium">
                    {record.speedup.toFixed(1)}x speedup
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
} 