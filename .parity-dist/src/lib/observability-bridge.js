/**
 * Observability Bridge for Tool Call Events
 *
 * Provides centralized logging, monitoring, and debugging capabilities for the
 * 3-agent system. Captures all tool calls, results, and errors with rich context.
 */
import { createLogger } from './utils';
// Debug flag (use NEXT_PUBLIC_custom_DEBUG=true to enable verbose logging)
const DEBUG_OBSERVABILITY = process.env.NEXT_PUBLIC_custom_DEBUG === 'true';
export class ObservabilityBridge {
    constructor(room) {
        this.logger = createLogger('ObservabilityBridge');
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
        this.queueMetrics = {
            enqueued: 0,
            completed: 0,
            failed: 0,
            avgDurationMs: 0,
        };
        this.maxEvents = 100; // Keep last 100 events in memory
        this.listeners = new Set();
        this.pendingToolCalls = new Map();
        // Queue incoming packets to avoid per-packet JSON.parse on busy rooms
        this.dataQueue = [];
        this.queueTimer = null;
        this.room = room;
        this.setupEventListeners();
        // Only enable verbose console logging when debug flag is on
        if (DEBUG_OBSERVABILITY) {
            this.setupConsoleLogging();
        }
    }
    setupEventListeners() {
        // Listen for LiveKit data channel events (batched)
        this.room.on('dataReceived', (data) => {
            this.dataQueue.push(data);
            if (!this.queueTimer) {
                this.queueTimer = setTimeout(() => {
                    const batch = this.dataQueue.splice(0, this.dataQueue.length);
                    this.queueTimer = null;
                    for (const pkt of batch)
                        this.processDataPacket(pkt);
                }, 25);
            }
        });
    }
    setupConsoleLogging() {
        this.on((event) => {
            try {
                const symbol = event.type === 'tool_call'
                    ? '➡️'
                    : event.type === 'tool_result'
                        ? '✅'
                        : event.type === 'tool_error'
                            ? '❌'
                            : '📍';
                // eslint-disable-next-line no-console
                console.log(symbol, `[Observability] ${event.type}`, event);
            }
            catch { }
        });
    }
    addEvent(event) {
        this.events.push(event);
        if (this.events.length > this.maxEvents)
            this.events.shift();
        this.metrics.recentEvents = this.events.slice(-20);
    }
    updateMetrics(event) {
        // Basic counters
        this.metrics.toolCallsByType[event.type] = (this.metrics.toolCallsByType[event.type] || 0) + 1;
        this.metrics.toolCallsBySource[event.source] =
            (this.metrics.toolCallsBySource[event.source] || 0) + 1;
        if (event.type === 'tool_call')
            this.metrics.totalToolCalls += 1;
        if (event.type === 'tool_result')
            this.metrics.successfulToolCalls += 1;
        if (event.type === 'tool_error')
            this.metrics.failedToolCalls += 1;
        // Update execution time average when a tool_result includes a duration
        if (typeof event.duration === 'number' && !Number.isNaN(event.duration)) {
            const prev = this.metrics.averageExecutionTime;
            const n = this.metrics.successfulToolCalls;
            this.metrics.averageExecutionTime = prev + (event.duration - prev) / Math.max(1, n);
        }
    }
    on(listener) {
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
            queue: this.queueMetrics,
        });
    }
    notify(event) {
        this.listeners.forEach((l) => {
            try {
                l(event);
            }
            catch { }
        });
    }
    trackToolCall(message) {
        const event = {
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
    trackToolResult(message) {
        const started = this.pendingToolCalls.get(message.toolCallId)?.startTime || Date.now();
        const event = {
            id: message.id || message.toolCallId,
            timestamp: message.timestamp || Date.now(),
            type: 'tool_result',
            source: message.source || 'dispatcher',
            tool: message.tool || this.pendingToolCalls.get(message.toolCallId)?.event.tool,
            result: message.result,
            duration: message.executionTime ?? Date.now() - started,
        };
        this.addEvent(event);
        this.updateMetrics(event);
        this.notify(event);
        this.pendingToolCalls.delete(message.toolCallId);
    }
    trackToolError(message) {
        const event = {
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
    trackDecision(message) {
        const event = {
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
    trackMarker(type, message) {
        const event = {
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
    addQueueEvent(event) {
        if (event.type === 'queued')
            this.queueMetrics.enqueued += 1;
        if (event.type === 'completed') {
            this.queueMetrics.completed += 1;
            if (typeof event.durationMs === 'number' && !Number.isNaN(event.durationMs)) {
                const prev = this.queueMetrics.avgDurationMs;
                const n = this.queueMetrics.completed;
                this.queueMetrics.avgDurationMs = prev + (event.durationMs - prev) / Math.max(1, n);
            }
        }
        if (event.type === 'failed')
            this.queueMetrics.failed += 1;
    }
    // ──────────────────────────────────────────────
    // Helper: process a single data packet
    // ──────────────────────────────────────────────
    processDataPacket(data) {
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
        }
        catch {
            // Non-JSON or malformed – ignore
        }
    }
}
// Global instance for easy access
let globalObservabilityBridge = null;
export function createObservabilityBridge(room) {
    if (globalObservabilityBridge) {
        return globalObservabilityBridge;
    }
    globalObservabilityBridge = new ObservabilityBridge(room);
    // Make it available globally for debugging
    if (typeof window !== 'undefined') {
        window.customObservability = globalObservabilityBridge;
    }
    return globalObservabilityBridge;
}
export function getObservabilityBridge() {
    return globalObservabilityBridge;
}
//# sourceMappingURL=observability-bridge.js.map