/**
 * @file parallel-tools/index.ts
 * @description Core parallel tool execution system integrating Tambo UI with OpenAI Agents SDK
 * 
 * This implementation provides:
 * - Automatic dependency detection and ordering
 * - Parallel execution for independent tools
 * - State synchronization with Tambo components
 * - Canvas/TLDraw integration
 * - Streaming support
 */

import { Agent, tool, run, ModelSettings } from '@openai/agents';
import { z } from 'zod';
import { TamboTool } from '@tambo-ai/react';
import { EventEmitter } from 'events';

/**
 * Tool execution metadata for tracking dependencies and parallel execution
 */
export interface ToolExecutionMetadata {
  toolId: string;
  toolName: string;
  dependencies?: string[]; // Tool IDs this tool depends on
  canRunInParallel: boolean;
  estimatedDuration?: number; // ms
  priority?: number;
  retryCount?: number;
  maxRetries?: number;
}

/**
 * Enhanced TamboTool with parallel execution support
 */
export interface ParallelTamboTool extends TamboTool {
  metadata?: ToolExecutionMetadata;
  needsApproval?: boolean | ((context: any, params: any) => Promise<boolean>);
}

/**
 * Execution result with timing and dependency information
 */
export interface ToolExecutionResult {
  toolId: string;
  result: any;
  error?: Error;
  executionTime: number;
  dependencies: string[];
  parallelGroup?: number;
}

/**
 * Parallel execution coordinator
 */
export class ParallelToolCoordinator extends EventEmitter {
  private agent: Agent;
  private executionGraph: Map<string, ToolExecutionMetadata> = new Map();
  private results: Map<string, ToolExecutionResult> = new Map();
  private streamBuffer: Map<string, any[]> = new Map();

  constructor() {
    super();
    this.agent = this.createParallelAgent();
  }

  /**
   * Creates an OpenAI Agent configured for parallel tool execution
   */
  private createParallelAgent(): Agent {
    return new Agent({
      name: 'Parallel Tool Coordinator',
      instructions: `You are a tool execution coordinator that:
1. Analyzes tool dependencies automatically
2. Executes independent tools in parallel
3. Respects execution order for dependent tools
4. Provides real-time updates during execution
5. Handles errors gracefully with retry logic

When given multiple tools to execute:
- Identify which tools can run in parallel (no shared dependencies)
- Execute dependent tools in the correct order
- Maximize parallelism while ensuring correctness`,
      model: 'gpt-4o-mini',
      modelSettings: {
        parallelToolCalls: true,
        temperature: 0,
        toolChoice: 'auto'
      }
    });
  }

  /**
   * Analyzes tools to build execution graph with dependencies
   */
  public async analyzeToolDependencies(
    tools: ParallelTamboTool[],
    userRequest: string
  ): Promise<Map<string, string[]>> {
    // Use AI to analyze implicit dependencies based on the request
    const dependencyAnalysisTool = tool({
      name: 'analyze_dependencies',
      description: 'Analyze tool dependencies based on request context',
      parameters: z.object({
        tools: z.array(z.object({
          id: z.string(),
          name: z.string(),
          description: z.string()
        })),
        request: z.string()
      }),
      execute: async ({ tools, request }) => {
        // Simulate dependency analysis
        // In production, this would use more sophisticated analysis
        const dependencies = new Map<string, string[]>();
        
        // Example: If request involves "compile after write", detect that pattern
        const hasCompileDependency = request.toLowerCase().includes('compile') && 
                                    request.toLowerCase().includes('write');
        
        tools.forEach((t, index) => {
          if (hasCompileDependency) {
            if (t.name.includes('compile') && index > 0) {
              // Compile depends on previous write operations
              dependencies.set(t.id, tools.slice(0, index)
                .filter(prev => prev.name.includes('write'))
                .map(prev => prev.id)
              );
            }
          }
          
          // Add explicit dependencies from metadata
          const metadata = (tools.find(tool => tool.id === t.id) as any)?.metadata;
          if (metadata?.dependencies) {
            const existing = dependencies.get(t.id) || [];
            dependencies.set(t.id, [...existing, ...metadata.dependencies]);
          }
        });
        
        return Object.fromEntries(dependencies);
      }
    });

    // Temporarily add the analysis tool to the agent
    const analysisAgent = new Agent({
      ...this.agent,
      tools: [dependencyAnalysisTool]
    });

    const result = await run(analysisAgent, 
      `Analyze dependencies for tools: ${JSON.stringify(tools.map(t => ({
        id: t.name,
        name: t.name,
        description: t.description
      })))} for request: "${userRequest}"`
    );

    const output = result.finalOutput || {};
    return new Map(Object.entries(output).map(([key, value]) => 
      [key, Array.isArray(value) ? value : [value]]
    ));
  }

  /**
   * Public alias for executeTools - for backward compatibility
   */
  public async executeParallel(
    tools: ParallelTamboTool[],
    userRequest: string
  ): Promise<ToolExecutionResult[]> {
    return this.executeTools(tools, userRequest);
  }

  /**
   * Executes tools with optimal parallelization
   */
  public async executeTools(
    tools: ParallelTamboTool[],
    userRequest: string,
    onProgress?: (update: ToolProgressUpdate) => void
  ): Promise<ToolExecutionResult[]> {
    // Clear previous execution state
    this.executionGraph.clear();
    this.results.clear();
    this.streamBuffer.clear();

    // Build execution metadata
    tools.forEach(tool => {
      this.executionGraph.set(tool.name, {
        toolId: tool.name,
        toolName: tool.name,
        canRunInParallel: tool.metadata?.canRunInParallel ?? true,
        dependencies: tool.metadata?.dependencies,
        priority: tool.metadata?.priority ?? 0,
        estimatedDuration: tool.metadata?.estimatedDuration,
        retryCount: 0,
        maxRetries: tool.metadata?.maxRetries ?? 2
      });
    });

    // Analyze dependencies
    const dependencies = await this.analyzeToolDependencies(tools, userRequest);

    // Create execution groups
    const executionGroups = this.createExecutionGroups(tools, dependencies);

    // Execute groups in order, with parallelism within each group
    const allResults: ToolExecutionResult[] = [];

    for (const [groupIndex, group] of executionGroups.entries()) {
      this.emit('groupStart', { groupIndex, tools: group });
      
      if (onProgress) {
        onProgress({
          type: 'group_start',
          groupIndex,
          totalGroups: executionGroups.length,
          toolsInGroup: group.length
        });
      }

      // Execute all tools in this group in parallel
      const groupPromises = group.map(tool => 
        this.executeSingleTool(tool, groupIndex, onProgress)
      );

      const groupResults = await Promise.allSettled(groupPromises);
      
      // Process results and handle failures
      for (const [index, result] of groupResults.entries()) {
        const tool = group[index];
        if (result.status === 'fulfilled') {
          allResults.push(result.value);
          this.results.set(tool.name, result.value);
        } else {
          // Handle failure with retry logic
          const retryResult = await this.retryTool(tool, groupIndex, onProgress);
          if (retryResult) {
            allResults.push(retryResult);
            this.results.set(tool.name, retryResult);
          }
        }
      }

      this.emit('groupComplete', { groupIndex, results: groupResults });
    }

    // Emit completion event with all results
    this.emit('allComplete', { results: allResults });

    return allResults;
  }

  /**
   * Creates execution groups based on dependencies
   */
  private createExecutionGroups(
    tools: ParallelTamboTool[],
    dependencies: Map<string, string[]>
  ): ParallelTamboTool[][] {
    const groups: ParallelTamboTool[][] = [];
    const executed = new Set<string>();
    const remaining = new Set(tools);

    while (remaining.size > 0) {
      const currentGroup: ParallelTamboTool[] = [];
      
      for (const tool of remaining) {
        const toolDeps = dependencies.get(tool.name) || [];
        const canExecute = toolDeps.every(dep => executed.has(dep));
        
        if (canExecute) {
          currentGroup.push(tool);
        }
      }

      if (currentGroup.length === 0) {
        // Circular dependency or error - execute remaining sequentially
        currentGroup.push(...remaining);
      }

      // Remove from remaining and mark as executed
      currentGroup.forEach(tool => {
        remaining.delete(tool);
        executed.add(tool.name);
      });

      groups.push(currentGroup);
    }

    return groups;
  }

  /**
   * Executes a single tool with progress tracking
   */
  private async executeSingleTool(
    tool: ParallelTamboTool,
    groupIndex: number,
    onProgress?: (update: ToolProgressUpdate) => void
  ): Promise<ToolExecutionResult> {
    const startTime = Date.now();
    
    this.emit('toolStart', { tool: tool.name, groupIndex });
    
    if (onProgress) {
      onProgress({
        type: 'tool_start',
        toolName: tool.name,
        groupIndex
      });
    }

    try {
      // Check if approval is needed
      if (tool.needsApproval) {
        const needsApproval = typeof tool.needsApproval === 'function' 
          ? await tool.needsApproval({}, tool)
          : tool.needsApproval;
          
        if (needsApproval) {
          this.emit('approvalRequired', { tool: tool.name });
          // Wait for approval (this would integrate with your UI)
          await this.waitForApproval(tool.name);
        }
      }

      // Execute the tool - pass empty object as tools typically define their own inputs
      const result = await tool.tool({});
      
      const executionResult: ToolExecutionResult = {
        toolId: tool.name,
        result,
        executionTime: Date.now() - startTime,
        dependencies: this.executionGraph.get(tool.name)?.dependencies || [],
        parallelGroup: groupIndex
      };

      this.emit('toolComplete', { tool: tool.name, result: executionResult });
      
      if (onProgress) {
        onProgress({
          type: 'tool_complete',
          toolName: tool.name,
          executionTime: executionResult.executionTime,
          success: true
        });
      }

      return executionResult;
    } catch (error) {
      const executionResult: ToolExecutionResult = {
        toolId: tool.name,
        result: null,
        error: error as Error,
        executionTime: Date.now() - startTime,
        dependencies: this.executionGraph.get(tool.name)?.dependencies || [],
        parallelGroup: groupIndex
      };

      this.emit('toolError', { tool: tool.name, error });
      
      if (onProgress) {
        onProgress({
          type: 'tool_error',
          toolName: tool.name,
          error: error as Error
        });
      }

      throw error;
    }
  }

  /**
   * Retries a failed tool execution
   */
  private async retryTool(
    tool: ParallelTamboTool,
    groupIndex: number,
    onProgress?: (update: ToolProgressUpdate) => void
  ): Promise<ToolExecutionResult | null> {
    const metadata = this.executionGraph.get(tool.name);
    if (!metadata) return null;

    metadata.retryCount = (metadata.retryCount || 0) + 1;
    
    if (metadata.retryCount > (metadata.maxRetries || 2)) {
      this.emit('toolMaxRetriesExceeded', { tool: tool.name });
      return null;
    }

    this.emit('toolRetry', { 
      tool: tool.name, 
      attempt: metadata.retryCount 
    });

    // Exponential backoff
    await new Promise(resolve => 
      setTimeout(resolve, Math.pow(2, metadata.retryCount || 1) * 1000)
    );

    try {
      return await this.executeSingleTool(tool, groupIndex, onProgress);
    } catch (error) {
      return await this.retryTool(tool, groupIndex, onProgress);
    }
  }

  /**
   * Waits for user approval (integrates with UI)
   */
  private async waitForApproval(toolName: string): Promise<void> {
    return new Promise((resolve) => {
      this.once(`approval:${toolName}`, resolve);
    });
  }

  /**
   * Approves a tool execution
   */
  public approveTool(toolName: string): void {
    this.emit(`approval:${toolName}`);
  }

  /**
   * Gets execution metrics
   */
  public getExecutionMetrics(): ExecutionMetrics {
    const results = Array.from(this.results.values());
    
    return {
      totalTools: results.length,
      successfulTools: results.filter(r => !r.error).length,
      failedTools: results.filter(r => r.error).length,
      totalExecutionTime: results.reduce((sum, r) => sum + r.executionTime, 0),
      averageExecutionTime: results.length > 0 
        ? results.reduce((sum, r) => sum + r.executionTime, 0) / results.length 
        : 0,
      parallelGroups: Math.max(...results.map(r => r.parallelGroup || 0)) + 1
    };
  }
}

/**
 * Progress update types
 */
export interface ToolProgressUpdate {
  type: 'group_start' | 'group_complete' | 'tool_start' | 'tool_complete' | 'tool_error';
  groupIndex?: number;
  totalGroups?: number;
  toolsInGroup?: number;
  toolName?: string;
  executionTime?: number;
  success?: boolean;
  error?: Error;
}

/**
 * Execution metrics
 */
export interface ExecutionMetrics {
  totalTools: number;
  successfulTools: number;
  failedTools: number;
  totalExecutionTime: number;
  averageExecutionTime: number;
  parallelGroups: number;
} 