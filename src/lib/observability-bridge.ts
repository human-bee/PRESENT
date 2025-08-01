/**
 * Observability Bridge for Tool Call Events
 * 
 * Provides centralized logging, monitoring, and debugging capabilities for the 
 * 3-agent system. Captures all tool calls, results, and errors with rich context.
 */

import { Room } from 'livekit-client';
import { systemRegistry } from './system-registry';
import { createLogger } from './utils';
// Debug flag (use NEXT_PUBLIC_TAMBO_DEBUG=true to enable verbose logging)
const DEBUG_OBSERVABILITY = process.env.NEXT_PUBLIC_TAMBO_DEBUG === 'true';

export interface ToolCallEvent {
  id: string;
  timestamp: number;
  type: 'tool_call' | 'tool_result' | 'tool_error' | 'decision';
  source: 'voice' | 'browser' | 'agent' | 'dispatcher';
  tool?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: string;
  context?: Record<string, unknown>;
  duration?: number;
  priority?: number;
  intent?: string;
  reasoning?: string;
}

export interface ObservabilityMetrics {
  totalToolCalls: number;
  successfulToolCalls: number;
  failedToolCalls: number;
  averageExecutionTime: number;
  toolCallsByType: Record<string, number>;
  toolCallsBySource: Record<string, number>;
  recentEvents: ToolCallEvent[];
}

export class ObservabilityBridge {
  private room: Room;
  private logger = createLogger('ObservabilityBridge');
  private events: ToolCallEvent[] = [];
  private metrics: ObservabilityMetrics = {
    totalToolCalls: 0,
    successfulToolCalls: 0,
    failedToolCalls: 0,
    averageExecutionTime: 0,
    toolCallsByType: {},
    toolCallsBySource: {},
    recentEvents: []
  };
  private maxEvents = 100; // Keep last 100 events in memory
  private listeners: Set<(event: ToolCallEvent) => void> = new Set();
  private pendingToolCalls = new Map<string, { startTime: number; event: ToolCallEvent }>();
  // Queue incoming packets to avoid per-packet JSON.parse on busy rooms
  private dataQueue: Uint8Array[] = [];
  private queueTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(room: Room) {
    this.room = room;
    this.setupEventListeners();
    // Only enable verbose console logging when debug flag is on
    if (DEBUG_OBSERVABILITY) {
      this.setupConsoleLogging();
    }
  }

  private setupEventListeners() {
    // Listen for LiveKit data channel events (batched)
    this.room.on('dataReceived', (data) => {
      this.dataQueue.push(data);
      if (!this.queueTimer) {
        this.queueTimer = setTimeout(() => {
          const packets = this.dataQueue;
          this.dataQueue = [];
          this.queueTimer = null;
          packets.forEach((pkt) => this.processDataPacket(pkt));
        }, DEBUG_OBSERVABILITY ? 20 : 100); // quicker flush when debugging
      }
    });

    // Listen for SystemRegistry state changes
    systemRegistry.onState((envelope) => {
      if (envelope.kind === 'tool_result' || envelope.kind === 'tool_error') {
        this.trackSystemRegistryEvent(envelope);
      }
    });
  }

  private setupConsoleLogging() {
    // Enhanced console logging with color coding
    this.onEvent((event) => {
      const timestamp = new Date(event.timestamp).toISOString();
      const colors = {
        tool_call: '#2563eb',     // Blue
        tool_result: '#16a34a',   // Green  
        tool_error: '#dc2626',    // Red
        decision: '#7c3aed'       // Purple
      };
      
      const color = colors[event.type] || '#6b7280';
      const icon = {
        tool_call: '🔧',
        tool_result: '✅',
        tool_error: '❌',
        decision: '🧠'
      }[event.type] || '📊';
      
      console.groupCollapsed(
        `%c${icon} [${event.source.toUpperCase()}] ${event.type.toUpperCase()}`,
        `color: ${color}; font-weight: bold;`
      );
      
      console.log(`%cTimestamp: ${timestamp}`, 'color: #6b7280;');
      console.log(`%cID: ${event.id}`, 'color: #6b7280;');
      
      if (event.tool) {
        console.log(`%cTool: ${event.tool}`, 'color: #059669;');
      }
      
      if (event.params) {
        console.log(`%cParams:`, 'color: #0891b2;', event.params);
      }
      
      if (event.result) {
        console.log(`%cResult:`, 'color: #16a34a;', event.result);
      }
      
      if (event.error) {
        console.log(`%cError: ${event.error}`, 'color: #dc2626;');
      }
      
      if (event.duration) {
        console.log(`%cDuration: ${event.duration}ms`, 'color: #7c3aed;');
      }
      
      if (event.context) {
        console.log(`%cContext:`, 'color: #ea580c;', event.context);
      }
      
      console.groupEnd();
    });
  }

  private trackToolCall(message: any) {
    const event: ToolCallEvent = {
      id: message.id,
      timestamp: message.timestamp || Date.now(),
      type: 'tool_call',
      source: message.source || 'unknown',
      tool: message.payload?.tool,
      params: message.payload?.params,
      context: message.payload?.context,
      priority: message.payload?.context?.priority,
      intent: message.payload?.context?.intent,
      reasoning: message.payload?.context?.reasoning
    };
    
    // Track pending tool call for duration calculation
    this.pendingToolCalls.set(message.id, {
      startTime: event.timestamp,
      event
    });
    
    this.addEvent(event);
    this.updateMetrics(event);
  }

  private trackToolResult(message: any) {
    const event: ToolCallEvent = {
      id: message.id || message.toolCallId,
      timestamp: message.timestamp || Date.now(),
      type: 'tool_result',
      source: 'browser',
      result: message.result,
      duration: message.executionTime
    };
    
    // Calculate duration if we have the original tool call
    const pending = this.pendingToolCalls.get(event.id);
    if (pending) {
      event.duration = event.timestamp - pending.startTime;
      event.tool = pending.event.tool;
      event.params = pending.event.params;
      this.pendingToolCalls.delete(event.id);
    }
    
    this.addEvent(event);
    this.updateMetrics(event);
  }

  private trackToolError(message: any) {
    const event: ToolCallEvent = {
      id: message.id || message.toolCallId,
      timestamp: message.timestamp || Date.now(),
      type: 'tool_error',
      source: 'browser',
      error: message.error
    };
    
    // Calculate duration if we have the original tool call
    const pending = this.pendingToolCalls.get(event.id);
    if (pending) {
      event.duration = event.timestamp - pending.startTime;
      event.tool = pending.event.tool;
      event.params = pending.event.params;
      this.pendingToolCalls.delete(event.id);
    }
    
    this.addEvent(event);
    this.updateMetrics(event);
  }

  private trackDecision(message: any) {
    const event: ToolCallEvent = {
      id: message.id,
      timestamp: message.timestamp || Date.now(),
      type: 'decision',
      source: 'agent',
      context: {
        decision: message.payload?.decision,
        participantId: message.payload?.participantId,
        originalText: message.payload?.originalText
      }
    };
    
    this.addEvent(event);
    this.updateMetrics(event);
  }

  private trackSystemRegistryEvent(envelope: any) {
    const event: ToolCallEvent = {
      id: envelope.id,
      timestamp: envelope.ts,
      type: envelope.kind === 'tool_result' ? 'tool_result' : 'tool_error',
      source: envelope.origin || 'system',
      result: envelope.kind === 'tool_result' ? envelope.payload.result : undefined,
      error: envelope.kind === 'tool_error' ? envelope.payload.error : undefined
    };
    
    this.addEvent(event);
    this.updateMetrics(event);
  }

  private addEvent(event: ToolCallEvent) {
    this.events.push(event);
    
    // Keep only the most recent events
    if (this.events.length > this.maxEvents) {
      this.events = this.events.slice(-this.maxEvents);
    }
    
    // Update recent events in metrics
    this.metrics.recentEvents = this.events.slice(-10);
    
    // Notify listeners
    this.listeners.forEach(listener => listener(event));
  }

  private updateMetrics(event: ToolCallEvent) {
    this.metrics.totalToolCalls++;
    
    if (event.type === 'tool_result') {
      this.metrics.successfulToolCalls++;
    } else if (event.type === 'tool_error') {
      this.metrics.failedToolCalls++;
    }
    
    // Update tool call counts by type
    if (event.tool) {
      this.metrics.toolCallsByType[event.tool] = (this.metrics.toolCallsByType[event.tool] || 0) + 1;
    }
    
    // Update tool call counts by source
    this.metrics.toolCallsBySource[event.source] = (this.metrics.toolCallsBySource[event.source] || 0) + 1;
    
    // Update average execution time
    if (event.duration) {
      const totalDuration = this.metrics.averageExecutionTime * (this.metrics.successfulToolCalls + this.metrics.failedToolCalls - 1);
      this.metrics.averageExecutionTime = (totalDuration + event.duration) / (this.metrics.successfulToolCalls + this.metrics.failedToolCalls);
    }
  }

  // Public API
  onEvent(listener: (event: ToolCallEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getMetrics(): ObservabilityMetrics {
    return { ...this.metrics };
  }

  getEvents(): ToolCallEvent[] {
    return [...this.events];
  }

  getEventsByTool(tool: string): ToolCallEvent[] {
    return this.events.filter(event => event.tool === tool);
  }

  getEventsBySource(source: string): ToolCallEvent[] {
    return this.events.filter(event => event.source === source);
  }

  getRecentErrors(): ToolCallEvent[] {
    return this.events.filter(event => event.type === 'tool_error').slice(-5);
  }

  getPendingToolCalls(): string[] {
    return Array.from(this.pendingToolCalls.keys());
  }

  // Debug helpers
  logSummary() {
    // Only log if there are issues or many pending calls
    const recentErrors = this.getRecentErrors().length;
    const pendingCalls = this.getPendingToolCalls().length;
    
    if (recentErrors > 0 || pendingCalls > 3) {
      console.log(`🔍 ${this.metrics.totalToolCalls} calls, ${recentErrors} errors, ${pendingCalls} pending`);
    }
  }

  exportEvents(): string {
    return JSON.stringify(this.events, null, 2);
  }

  clear() {
    this.events = [];
    this.metrics = {
      totalToolCalls: 0,
      successfulToolCalls: 0,
      failedToolCalls: 0,
      averageExecutionTime: 0,
      toolCallsByType: {},
      toolCallsBySource: {},
      recentEvents: []
    };
    this.pendingToolCalls.clear();
    this.logger.log('📊 Observability data cleared');
  }

  // ──────────────────────────────────────────────
  // Helper: process a single data packet
  // ──────────────────────────────────────────────
  private processDataPacket(data: Uint8Array) {
    try {
      const message = JSON.parse(new TextDecoder().decode(data));
      switch (message.type) {
        case 'tool_call':
          this.trackToolCall(message);
          break;
        case 'tool_result':
          this.trackToolResult(message);
          break;
        case 'tool_error':
          this.trackToolError(message);
          break;
        case 'decision':
          this.trackDecision(message);
          break;
        default:
          break;
      }
    } catch {
      // Non-JSON or malformed – ignore
    }
  }
}

// Global instance for easy access
let globalObservabilityBridge: ObservabilityBridge | null = null;

export function createObservabilityBridge(room: Room): ObservabilityBridge {
  if (globalObservabilityBridge) {
    return globalObservabilityBridge;
  }
  
  globalObservabilityBridge = new ObservabilityBridge(room);
  
  // Make it available globally for debugging
  if (typeof window !== 'undefined') {
    (window as any).tamboObservability = globalObservabilityBridge;
  }
  
  return globalObservabilityBridge;
}

export function getObservabilityBridge(): ObservabilityBridge | null {
  return globalObservabilityBridge;
} 