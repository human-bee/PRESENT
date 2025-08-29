/**
 * Observability Bridge for Tool Call Events
 *
 * Provides centralized logging, monitoring, and debugging capabilities for the
 * 3-agent system. Captures all tool calls, results, and errors with rich context.
 */

import { Room } from 'livekit-client';
import { systemRegistry } from './system-registry';
import { createLogger } from './utils';
// Debug flag (use NEXT_PUBLIC_custom_DEBUG=true to enable verbose logging)
const DEBUG_OBSERVABILITY = process.env.NEXT_PUBLIC_custom_DEBUG === 'true';

export interface ToolCallEvent {
  id: string;
  timestamp: number;
  type:
  | 'tool_call'
  | 'tool_result'
  | 'tool_error'
  | 'decision'
  | 'resolve'
  | 'mcp_ready'
  | 'ui_mount';
  source: 'voice' | 'browser' | 'agent' | 'dispatcher' | 'ui' | 'system';
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
    recentEvents: [],
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
          const batch = this.dataQueue.splice(0, this.dataQueue.length);
          this.queueTimer = null;
          for (const pkt of batch) this.processDataPacket(pkt);
        }, 25);
      }
    });
  }

  private setupConsoleLogging() {
    this.on((event) => {
      try {
        const symbol =
          event.type === 'tool_call'
            ? '➡️'
            : event.type === 'tool_result'
              ? '✅'
              : event.type === 'tool_error'
                ? '❌'
                : '📍';
        // eslint-disable-next-line no-console
        console.log(symbol, `[Observability] ${event.type}`, event);
      } catch { }
    });
  }

  private addEvent(event: ToolCallEvent) {
    this.events.push(event);
    if (this.events.length > this.maxEvents) this.events.shift();
    this.metrics.recentEvents = this.events.slice(-20);
  }

  private updateMetrics(event: ToolCallEvent) {
    // Basic counters
    this.metrics.toolCallsByType[event.type] = (this.metrics.toolCallsByType[event.type] || 0) + 1;
    this.metrics.toolCallsBySource[event.source] =
      (this.metrics.toolCallsBySource[event.source] || 0) + 1;

    if (event.type === 'tool_call') this.metrics.totalToolCalls += 1;
    if (event.type === 'tool_result') this.metrics.successfulToolCalls += 1;
    if (event.type === 'tool_error') this.metrics.failedToolCalls += 1;

    // Update execution time average when a tool_result includes a duration
    if (typeof event.duration === 'number' && !Number.isNaN(event.duration)) {
      const prev = this.metrics.averageExecutionTime;
      const n = this.metrics.successfulToolCalls;
      this.metrics.averageExecutionTime = prev + (event.duration - prev) / Math.max(1, n);
    }
  }

  on(listener: (event: ToolCallEvent) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  logSummary() {
    this.logger.log('📊', {
      total: this.metrics.totalToolCalls,
      ok: this.metrics.successfulToolCalls,
      err: this.metrics.failedToolCalls,
      avgMs: this.metrics.averageExecutionTime,
      byType: this.metrics.toolCallsByType,
    });
  }

  private notify(event: ToolCallEvent) {
    this.listeners.forEach((l) => {
      try {
        l(event);
      } catch { }
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
      reasoning: message.payload?.context?.reasoning,
    };

    // Track pending tool call for duration calculation
    this.pendingToolCalls.set(message.id, {
      startTime: event.timestamp,
      event,
    });

    this.addEvent(event);
    this.updateMetrics(event);
    this.notify(event);
  }

  private trackToolResult(message: any) {
    const started = this.pendingToolCalls.get(message.toolCallId)?.startTime || Date.now();
    const event: ToolCallEvent = {
      id: message.id || message.toolCallId,
      timestamp: message.timestamp || Date.now(),
      type: 'tool_result',
      source: message.source || 'dispatcher',
      tool: message.tool || this.pendingToolCalls.get(message.toolCallId)?.event.tool,
      result: message.result,
      duration: (message.executionTime as number) ?? Date.now() - started,
    };
    this.addEvent(event);
    this.updateMetrics(event);
    this.notify(event);
    this.pendingToolCalls.delete(message.toolCallId);
  }

  private trackToolError(message: any) {
    const event: ToolCallEvent = {
      id: message.id || message.toolCallId,
      timestamp: message.timestamp || Date.now(),
      type: 'tool_error',
      source: message.source || 'dispatcher',
      tool: message.tool,
      error: message.error,
    };
    this.addEvent(event);
    this.updateMetrics(event);
    this.notify(event);
    this.pendingToolCalls.delete(message.toolCallId);
  }

  private trackDecision(message: any) {
    const event: ToolCallEvent = {
      id: message.id,
      timestamp: message.timestamp || Date.now(),
      type: 'decision',
      source: message.source || 'agent',
      intent: message.intent,
      reasoning: message.reasoning,
      context: message.context,
    };
    this.addEvent(event);
    this.updateMetrics(event);
    this.notify(event);
  }

  private trackMarker(type: ToolCallEvent['type'], message: any) {
    const event: ToolCallEvent = {
      id: message.id || message.requestId || `${type}-${Date.now()}`,
      timestamp: message.timestamp || Date.now(),
      type,
      source: message.source || (type === 'ui_mount' ? 'ui' : 'dispatcher'),
      tool: message.tool,
      context: message.context,
      result: message.result,
      duration: message.duration,
    };
    this.addEvent(event);
    this.updateMetrics(event);
    this.notify(event);
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
      recentEvents: [],
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
        case 'resolve':
        case 'mcp_ready':
        case 'ui_mount':
          this.trackMarker(message.type, message);
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
    (window as any).customObservability = globalObservabilityBridge;
  }

  return globalObservabilityBridge;
}

export function getObservabilityBridge(): ObservabilityBridge | null {
  return globalObservabilityBridge;
}
