"use client";

import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { Room } from 'livekit-client';
import type { Editor } from '@tldraw/tldraw';
import { useToolRegistry } from './useToolRegistry';
import { useToolQueue } from './useToolQueue';
import type { ToolCall, ToolParameters, ToolRunResult } from '../utils/toolTypes';
import { TOOL_STEWARD_DELAY_MS, TOOL_STEWARD_WINDOW_MS } from '../utils/constants';
import type { ToolEventsApi } from './useToolEvents';
import { ComponentRegistry } from '@/lib/component-registry';
import { applyEnvelope } from '@/components/tool-dispatcher/handlers/tldraw-actions';
import { logJourneyEvent } from '@/lib/journey-logger';
import { fetchWithSupabaseAuth } from '@/lib/supabase/auth-headers';
import { createLogger } from '@/lib/logging';
import { deriveRequestCorrelation } from '@/lib/agents/shared/request-correlation';
import type { JsonObject } from '@/lib/utils/json-schema';
import {
  parseDecisionMessage,
  parseStewardTriggerMessage,
  parseToolCallMessage,
  type StewardTriggerMessage,
} from '@/lib/livekit/protocol';
import { ACTION_VERSION, AgentActionEnvelopeSchema } from '@/lib/canvas-agent/contract/types';
import { useRoomExecutor } from '@/hooks/use-room-executor';
import {
  shouldDeferToolCallWhenNotExecutor,
  shouldExecuteIncomingToolCall,
} from './tool-call-execution-guard';
import {
  hasExceededServerErrorBudget,
  readTaskTraceId,
  resolveDispatchRoom,
} from './steward-task-utils';

type ToolMetricEntry = {
  callId: string;
  tool: string;
  messageIds: Set<string>;
  metaByMessage: Map<string, { componentType?: string }>;
  sendContextTs?: number;
  sendGeneratedAt?: number;
  arriveAt?: number;
  arrivePerf?: number;
  loggedMessages: Set<string>;
};

type DeferredToolCallEntry = {
  call: ToolCall;
  roomKey: string;
  enqueuedAt: number;
};

interface UseToolRunnerOptions {
  contextKey?: string;
  events: ToolEventsApi;
  room?: Room;
  stewardEnabled: boolean;
}

export interface ToolRunnerApi {
  executeToolCall: (call: ToolCall) => Promise<ToolRunResult>;
  queue: ReturnType<typeof useToolQueue>;
}

export function useToolRunner(options: UseToolRunnerOptions): ToolRunnerApi {
  const { contextKey, events, room, stewardEnabled } = options;
  const executor = useRoomExecutor(room);
  const queue = useToolQueue();
  const logger = useMemo(() => createLogger('ToolDispatcher:runner'), []);
  const runtimeMetricsFlag = typeof window !== 'undefined' && window.__presentDispatcherMetrics === true;
  const metricsEnabled =
    process.env.NEXT_PUBLIC_TOOL_DISPATCHER_METRICS === 'true' || runtimeMetricsFlag;
  const metricsByCallRef = useRef<Map<string, ToolMetricEntry>>(new Map());
  const messageToCallsRef = useRef<Map<string, Set<string>>>(new Map());
  const processedToolCallIdsRef = useRef<Map<string, number>>(new Map());
  const deferredToolCallsRef = useRef<Map<string, DeferredToolCallEntry>>(new Map());
  const DEFERRED_TOOL_CALL_TTL_MS = 20_000;
  const DEFERRED_TOOL_CALL_MAX = 128;
  const metricsAdapter = useMemo(() => {
    if (!metricsEnabled) return undefined;
    return {
      associateCallWithMessage: (
        callId: string,
        messageId: string,
        meta?: { tool: string; componentType?: string },
      ) => {
        const trimmedId = (messageId || '').trim();
        if (!trimmedId) return;
        let entry = metricsByCallRef.current.get(callId);
        if (!entry) {
          entry = {
            callId,
            tool: meta?.tool || 'unknown',
            messageIds: new Set(),
            metaByMessage: new Map(),
            loggedMessages: new Set(),
          };
          metricsByCallRef.current.set(callId, entry);
        } else if (meta?.tool) {
          entry.tool = meta.tool;
        }
        entry.messageIds.add(trimmedId);
        entry.metaByMessage.set(trimmedId, { componentType: meta?.componentType });
        if (entry.sendContextTs === undefined) {
          entry.sendContextTs = Date.now();
        }
        if (entry.arriveAt === undefined) {
          entry.arriveAt = Date.now();
        }
        const existingSet = messageToCallsRef.current.get(trimmedId);
        if (existingSet) {
          existingSet.add(callId);
        } else {
          messageToCallsRef.current.set(trimmedId, new Set([callId]));
        }
      },
      markPaintForMessage: (
        messageId: string,
        meta?: { tool: string; componentType?: string },
      ) => {
        const trimmedId = (messageId || '').trim();
        if (!trimmedId) return;
        const callSet = messageToCallsRef.current.get(trimmedId);
        if (!callSet || callSet.size === 0) return;
        callSet.forEach((callId) => {
          const entry = metricsByCallRef.current.get(callId);
          if (!entry) return;
          if (!entry.messageIds.has(trimmedId)) {
            entry.messageIds.add(trimmedId);
          }
          if (meta?.componentType && !entry.metaByMessage.has(trimmedId)) {
            entry.metaByMessage.set(trimmedId, { componentType: meta.componentType });
          }
          if (!entry.loggedMessages.has(trimmedId)) {
            const paintAt = Date.now();
            const nowPerf = typeof performance !== 'undefined' ? performance.now() : undefined;
            const paintMs =
              nowPerf !== undefined && entry.arrivePerf !== undefined
                ? Math.max(0, Math.round(nowPerf - entry.arrivePerf))
                : entry.arriveAt !== undefined
                  ? Math.max(0, paintAt - entry.arriveAt)
                  : undefined;
            const sendTs = entry.sendContextTs ?? entry.sendGeneratedAt;
            const networkMs =
              sendTs !== undefined && entry.arriveAt !== undefined
                ? Math.max(0, entry.arriveAt - sendTs)
                : undefined;
            const details = {
              callId,
              tool: entry.tool,
              messageId: trimmedId,
              componentType: entry.metaByMessage.get(trimmedId)?.componentType,
              tSend: sendTs ?? null,
              tArrive: entry.arriveAt ?? null,
              tPaint: paintAt,
              dtNetworkMs: networkMs,
              dtPaintMs: paintMs,
            };
            try {
              logger.info('metrics', details);
            } catch {}
            if (typeof window !== 'undefined') {
              try {
                window.dispatchEvent(new CustomEvent('present:tool_metrics', { detail: details }));
              } catch {}
            }
            try {
              logJourneyEvent({
                eventType: 'tool_metrics',
                source: 'dispatcher',
                tool: entry.tool,
                durationMs: details.dtPaintMs,
                payload: {
                  messageId: trimmedId,
                  componentType: details.componentType,
                  dtPaintMs: details.dtPaintMs,
                  dtNetworkMs: details.dtNetworkMs,
                  tSend: details.tSend,
                  tArrive: details.tArrive,
                  tPaint: details.tPaint,
                },
              });
            } catch {}
            entry.loggedMessages.add(trimmedId);
            if (entry.messageIds.size === entry.loggedMessages.size) {
              metricsByCallRef.current.delete(callId);
            }
          }
        });
        messageToCallsRef.current.delete(trimmedId);
      },
    };
  }, [metricsEnabled, logger]);
  const registry = useToolRegistry({ contextKey, metrics: metricsAdapter });
  const {
    emitRequest,
    emitDone,
    emitError,
    emitEditorAction,
    log,
    bus,
  } = events;
  const STEWARD_TASK_POLL_TIMEOUT_MS = 30_000;
  const STEWARD_TASK_POLL_INITIAL_DELAY_MS = 300;
  const STEWARD_TASK_POLL_MAX_DELAY_MS = 1_500;
  const STEWARD_TASK_POLL_MAX_SERVER_ERRORS = 5;

  const stewardPendingRef = useRef(false);
  const queuedRunRef = useRef<
    { room: string; docId: string; windowMs?: number; options?: { mode?: 'auto' | 'fast' | 'slow'; reason?: string } }
    | null
  >(null);
  const stewardWindowTimerRef = useRef<number | null>(null);
  const stewardDelayTimerRef = useRef<number | null>(null);
  const stewardCompleteRef = useRef<(() => void) | null>(null);
  const slowReleaseTimerRef = useRef<number | null>(null);

  const emitStewardStatusTranscript = useCallback(
    (input: {
      taskName: string;
      status: 'applied' | 'queued' | 'failed';
      taskId?: string;
      traceId?: string;
      message?: string;
    }) => {
      if (typeof window === 'undefined') return;
      const taskName = input.taskName.trim();
      if (!taskName) return;

      const shortTask = typeof input.taskId === 'string' && input.taskId.trim().length > 0
        ? input.taskId.trim().slice(0, 8)
        : null;
      const shortTrace = typeof input.traceId === 'string' && input.traceId.trim().length > 0
        ? input.traceId.trim().slice(0, 8)
        : null;
      const suffix = [shortTask ? `task ${shortTask}` : null, shortTrace ? `trace ${shortTrace}` : null]
        .filter(Boolean)
        .join(' · ');
      const text =
        typeof input.message === 'string' && input.message.trim().length > 0
          ? input.message.trim()
          : `${taskName} ${input.status}${suffix ? ` (${suffix})` : ''}`;

      const timestamp = Date.now();
      const eventId =
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : `${timestamp}-${Math.random().toString(36).slice(2)}`;

      try {
        window.dispatchEvent(
          new CustomEvent('livekit:transcription-replay', {
            detail: {
              speaker: 'voice-agent',
              text,
              timestamp,
            },
          }),
        );
      } catch {}

      try {
        window.dispatchEvent(
          new CustomEvent('custom:transcription-local', {
            detail: {
              type: 'live_transcription',
              event_id: eventId,
              text,
              speaker: 'voice-agent',
              participantId: 'voice-agent',
              participantName: 'voice-agent',
              timestamp,
              is_final: true,
              manual: true,
            },
          }),
        );
      } catch {}

      try {
        window.dispatchEvent(
          new CustomEvent('present:steward-status', {
            detail: {
              taskName,
              status: input.status,
              taskId: input.taskId ?? null,
              traceId: input.traceId ?? null,
              text,
              timestamp,
            },
          }),
        );
      } catch {}
    },
    [],
  );

  const triggerStewardRun = useCallback(
    (
      roomName: string,
      docId: string,
      windowMs = TOOL_STEWARD_WINDOW_MS,
      options?: { mode?: 'auto' | 'fast' | 'slow'; reason?: string },
    ) => {
      if (!stewardEnabled) return;
      const normalizedRoom = roomName.trim();
      const normalizedDoc = docId.trim();
      if (!normalizedRoom || !normalizedDoc) return;

      if (stewardPendingRef.current) {
        queuedRunRef.current = { room: normalizedRoom, docId: normalizedDoc, windowMs, options };
        log('steward_run: requested while pending; queued for later', queuedRunRef.current);
        return;
      }

      stewardPendingRef.current = true;
      queuedRunRef.current = null;

      const complete = () => {
        stewardPendingRef.current = false;
        const queued = queuedRunRef.current;
        queuedRunRef.current = null;
        if (queued) {
          log('steward_run: starting queued run', queued);
          triggerStewardRun(queued.room, queued.docId, queued.windowMs, queued.options);
        }
      };
      stewardCompleteRef.current = complete;

      const scheduleCompletion = (duration?: number) => {
        if (stewardWindowTimerRef.current) {
          try {
            window.clearTimeout(stewardWindowTimerRef.current);
          } catch {}
          stewardWindowTimerRef.current = null;
        }
        if (duration && duration > 0) {
          stewardWindowTimerRef.current = window.setTimeout(() => {
            stewardWindowTimerRef.current = null;
            complete();
          }, duration);
        } else {
          complete();
        }
      };

      log('steward_run: starting', {
        room: normalizedRoom,
        docId: normalizedDoc,
        windowMs,
        mode: options?.mode ?? 'auto',
        reason: options?.reason,
      });
      void (async () => {
        try {
          log('steward_run: posting /api/steward/run', {
            room: normalizedRoom,
            docId: normalizedDoc,
            windowMs,
            mode: options?.mode ?? 'auto',
            reason: options?.reason,
          });
          const payload: Record<string, unknown> = {
            room: normalizedRoom,
            docId: normalizedDoc,
          };
          if (!Number.isNaN(windowMs) && windowMs !== undefined) {
            payload.windowMs = windowMs;
          }
          if (options?.mode) payload.mode = options.mode;
          if (options?.reason) payload.reason = options.reason;
          const res = await fetchWithSupabaseAuth('/api/steward/run', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
          if (!res.ok) {
            let text = '';
            try {
              text = await res.text();
            } catch {}
            logger.warn('steward run failed', { status: res.status, text });
            scheduleCompletion();
            return;
          }
          log('steward_run: dispatched', { status: res.status, mode: options?.mode ?? 'auto' });
          scheduleCompletion(windowMs);
        } catch (error) {
          logger.warn('steward run error', { error });
          scheduleCompletion();
        }
      })();
    },
    [stewardEnabled, log, logger],
  );

  const scheduleStewardRun = useCallback(
    (roomName?: string | null, docId?: string | null) => {
      if (!stewardEnabled) return;
      const normalizedRoom = typeof roomName === 'string' ? roomName.trim() : '';
      const normalizedDoc = typeof docId === 'string' ? docId.trim() : '';
      if (!normalizedRoom || !normalizedDoc) return;

      if (stewardDelayTimerRef.current) {
        try {
          window.clearTimeout(stewardDelayTimerRef.current);
        } catch {}
        stewardDelayTimerRef.current = null;
      }

      log('steward_run: scheduled', { room: normalizedRoom, docId: normalizedDoc });
      stewardDelayTimerRef.current = window.setTimeout(() => {
        stewardDelayTimerRef.current = null;
        triggerStewardRun(normalizedRoom, normalizedDoc, TOOL_STEWARD_WINDOW_MS);
      }, TOOL_STEWARD_DELAY_MS);
    },
    [stewardEnabled, triggerStewardRun, log],
  );

  const pollStewardTaskCompletion = useCallback(
    async (input: { call: ToolCall; taskId: string; roomName: string; taskName: string }) => {
      const { call, taskId, roomName, taskName } = input;
      const deadline = Date.now() + STEWARD_TASK_POLL_TIMEOUT_MS;
      let delayMs = STEWARD_TASK_POLL_INITIAL_DELAY_MS;
      let consecutiveServerErrorCount = 0;

      while (Date.now() < deadline) {
        try {
          const search = new URLSearchParams({ taskId, room: roomName });
          const res = await fetchWithSupabaseAuth(`/api/steward/task-status?${search.toString()}`, {
            method: 'GET',
          });
          if (res.ok) {
            consecutiveServerErrorCount = 0;
            const body = await res.json().catch(() => null);
            const taskRecord =
              body && typeof body === 'object' && body.task && typeof body.task === 'object'
                ? (body.task as Record<string, unknown>)
                : null;
            const status =
              typeof taskRecord?.status === 'string' ? taskRecord.status.trim().toLowerCase() : '';
            const taskResult =
              taskRecord && typeof taskRecord.result === 'object' && taskRecord.result
                ? (taskRecord.result as Record<string, unknown>)
                : null;
            const taskResultStatus =
              typeof taskResult?.status === 'string' ? taskResult.status.trim().toLowerCase() : '';
            const taskTraceId = readTaskTraceId(taskRecord);

            if (status === 'succeeded') {
              if (taskResultStatus === 'queued' || taskResultStatus === 'pending') {
                const message = `${taskName} queued${taskId ? ` (task ${taskId.slice(0, 8)})` : ''}`;
                emitDone(call, {
                  status: 'QUEUED',
                  message,
                  taskId,
                });
                emitStewardStatusTranscript({
                  taskName,
                  status: 'queued',
                  taskId,
                  traceId: taskTraceId,
                  message,
                });
                return;
              }
              if (taskResultStatus === 'failed' || taskResultStatus === 'error') {
                const failureMessage =
                  typeof taskResult?.error === 'string' && taskResult.error.trim()
                    ? taskResult.error.trim()
                    : `${taskName} failed`;
                emitDone(call, {
                  status: 'FAILED',
                  message: failureMessage,
                  taskId,
                });
                emitStewardStatusTranscript({
                  taskName,
                  status: 'failed',
                  taskId,
                  traceId: taskTraceId,
                  message: failureMessage,
                });
                return;
              }
              const message = `${taskName} applied${taskId ? ` (task ${taskId.slice(0, 8)})` : ''}`;
              emitDone(call, {
                status: 'COMPLETED',
                message,
                taskId,
              });
              emitStewardStatusTranscript({
                taskName,
                status: 'applied',
                taskId,
                traceId: taskTraceId,
                message,
              });
              return;
            }
            if (status === 'failed' || status === 'canceled') {
              const failureMessage =
                typeof taskRecord?.error === 'string' && taskRecord.error.trim()
                  ? taskRecord.error.trim()
                  : `${taskName} ${status}`;
              emitDone(call, {
                status: 'FAILED',
                message: failureMessage,
                taskId,
              });
              emitStewardStatusTranscript({
                taskName,
                status: 'failed',
                taskId,
                traceId: taskTraceId,
                message: failureMessage,
              });
              return;
            }
          } else if (res.status === 401 || res.status === 403) {
            const message = `${taskName} apply verification unauthorized (HTTP ${res.status})`;
            emitDone(call, {
              status: 'UNAUTHORIZED',
              message,
              taskId,
              reasonCode: 'task_status_unauthorized',
            });
            emitStewardStatusTranscript({
              taskName,
              status: 'failed',
              taskId,
              message,
            });
            return;
          } else if (res.status === 404) {
            // Eventual consistency: task row may not be visible immediately after enqueue.
            logger.info('steward task not yet visible; retrying poll', {
              taskId,
              roomName,
              taskName,
            });
          } else if (res.status >= 500) {
            consecutiveServerErrorCount += 1;
            let errorBody = '';
            try {
              errorBody = await res.text();
            } catch {}
            logger.warn('steward task-status server error; retrying poll', {
              taskId,
              roomName,
              taskName,
              status: res.status,
              consecutiveServerErrorCount,
              errorBody: errorBody.slice(0, 180),
            });
            if (
              hasExceededServerErrorBudget(
                consecutiveServerErrorCount,
                STEWARD_TASK_POLL_MAX_SERVER_ERRORS,
              )
            ) {
              const message = `${taskName} failed: task-status unavailable (HTTP ${res.status})`;
              emitDone(call, {
                status: 'FAILED',
                message,
                taskId,
                reasonCode: 'task_status_server_error',
              });
              emitStewardStatusTranscript({
                taskName,
                status: 'failed',
                taskId,
                message,
              });
              return;
            }
          } else {
            logger.warn('steward task-status unexpected response; retrying poll', {
              taskId,
              roomName,
              taskName,
              status: res.status,
            });
          }
        } catch (error) {
          logger.warn('steward task completion poll failed', {
            taskId,
            roomName,
            taskName,
            error: error instanceof Error ? error.message : String(error),
          });
        }

        await new Promise((resolve) => window.setTimeout(resolve, delayMs));
        delayMs = Math.min(STEWARD_TASK_POLL_MAX_DELAY_MS, Math.round(delayMs * 1.5));
      }

      const timeoutMessage = `${taskName} timed out waiting for apply evidence`;
      emitDone(call, {
        status: 'TIMEOUT',
        message: timeoutMessage,
        taskId,
        reasonCode: 'task_status_timeout',
      });
      emitStewardStatusTranscript({
        taskName,
        status: 'failed',
        taskId,
        message: timeoutMessage,
      });
    },
    [emitDone, emitStewardStatusTranscript, logger],
  );

  useEffect(
    () => () => {
      if (stewardDelayTimerRef.current) {
        try {
          window.clearTimeout(stewardDelayTimerRef.current);
        } catch {}
        stewardDelayTimerRef.current = null;
      }
      if (stewardWindowTimerRef.current) {
        try {
          window.clearTimeout(stewardWindowTimerRef.current);
        } catch {}
        stewardWindowTimerRef.current = null;
      }
      queuedRunRef.current = null;
      stewardPendingRef.current = false;
    },
    [],
  );

  const dispatchTL = useCallback(
    (eventName: string, detail?: unknown): ToolRunResult => {
      try {
        window.dispatchEvent(new CustomEvent(eventName, { detail }));
        emitEditorAction({ type: 'canvas_command', command: eventName, detail, timestamp: Date.now() });
        return { status: 'SUCCESS', message: `${eventName} dispatched` };
      } catch (error) {
        return {
          status: 'ERROR',
          message: error instanceof Error ? error.message : String(error),
        };
      }
    },
    [emitEditorAction],
  );

  const runMcpTool = useCallback(
    async (tool: string, params: ToolParameters): Promise<ToolRunResult> => {
      const toolName = tool.replace(/^mcp_/, '');
      const registry = window.__custom_mcp_tools || {};
      let result: unknown;
      const startedAt = Date.now();
      let mcpError: string | undefined;

      try {
        const paramKeys = params && typeof params === 'object' ? Object.keys(params).slice(0, 8) : [];
        logJourneyEvent({
          eventType: 'mcp_call',
          source: 'dispatcher',
          tool: toolName,
          payload: { paramKeys },
        });
      } catch {}

      const direct = registry[toolName] || registry[`mcp_${toolName}`];
      if (direct) {
        try {
          if (typeof direct === 'function') {
            result = await direct(params);
          } else if (typeof direct?.execute === 'function') {
            result = await direct.execute(params);
          }
        } catch (error) {
          logger.warn('direct MCP tool failed', { toolName, error });
          mcpError = error instanceof Error ? error.message : String(error);
        }
      }

      if (!result) {
        try {
          result = await window.callMcpTool?.(toolName, params);
        } catch (error) {
          logger.warn('MCP tool call failed', { toolName, error });
          mcpError = error instanceof Error ? error.message : String(error);
        }
      }

      const resultRecord = toRecord(result);
      if ((!resultRecord || resultRecord.status === 'IGNORED') && toolName === 'exa') {
        const q = String(params.query || '').trim();
        result = {
          status: 'STUB',
          results: [
            {
              title: `Research stub for: ${q}`,
              snippet: 'MCP not wired. Configure MCP servers in /mcp-config to enable real results.',
            },
          ],
        };
      }

      try {
        logger.debug('mcp result', {
          toolName,
          preview: JSON.stringify(result)?.slice(0, 2000),
        });
      } catch {}

      try {
        const durationMs = Math.max(0, Date.now() - startedAt);
        const observedResult = toRecord(result);
        const listRaw =
          observedResult?.results ?? observedResult?.items ?? observedResult?.documents ?? [];
        const list = Array.isArray(listRaw) ? listRaw : [];
        const resultCount = Array.isArray(list) ? list.length : undefined;
        const eventType = mcpError ? 'mcp_error' : 'mcp_result';
        logJourneyEvent({
          eventType,
          source: 'dispatcher',
          tool: toolName,
          durationMs,
          payload: {
            status: observedResult?.status ?? null,
            resultCount,
            error: mcpError,
          },
        });
      } catch {}

      if (toolName === 'exa') {
        try {
          const queryText = String(params.query || '').trim();
          const exaResult = toRecord(result);
          const itemsRaw = exaResult?.results ?? exaResult?.items ?? exaResult?.documents ?? [];
          const items = Array.isArray(itemsRaw) ? itemsRaw : [];
          const sourcesText = Array.isArray(items)
            ? items
                .slice(0, 3)
                .map((it) => {
                  const itemRecord = toRecord(it);
                  if (!itemRecord) return null;
                  const textValue = typeof itemRecord.text === 'string' ? itemRecord.text : '';
                  return itemRecord.title || itemRecord.url || itemRecord.snippet || textValue.slice(0, 80);
                })
                .filter(Boolean)
                .join('; ')
            : '';

          const list = ComponentRegistry.list();
          const latestScorecard = [...list]
            .filter((c) => c.componentType === 'DebateScorecard')
            .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))[0];
          if (latestScorecard) {
            const messageId = latestScorecard.messageId;
            const nextVersion =
              typeof latestScorecard.version === 'number' && Number.isFinite(latestScorecard.version)
                ? latestScorecard.version + 1
                : 1;
            const patch: Record<string, unknown> = {
              timeline: [
                {
                  type: 'search',
                  query: queryText,
                  sources: sourcesText,
                  timestamp: new Date().toISOString(),
                },
              ],
              version: nextVersion,
              lastUpdated: Date.now(),
            };
            try {
              await ComponentRegistry.update(messageId, patch, {
                version: nextVersion,
                timestamp: Date.now(),
                source: 'tool:exa',
              });
            } catch (error) {
              logger.warn('exa-to-update_component synthesis failed', { error });
            }
          }
        } catch (error) {
          logger.warn('exa result reflection failed', { error });
        }
      }

      return toToolRunResult(result);
    },
    [logger],
  );

  const activeCanvasDispatchRef = useRef<{
    room: string;
    message: string;
    requestId?: string;
  } | null>(null);

  const executeToolCall = useCallback(
    async (call: ToolCall): Promise<ToolRunResult> => {
      const tool = call.payload.tool;
      const params = call.payload.params ?? {};

      log('call', tool, params);
      queue.enqueue(call.id, tool);
      emitRequest(call);
      queue.markStarted(call.id);

      const handler = registry.getHandler(tool);

      try {
        // Unified Canvas Agent: remove canvas_* gating; only non-canvas tools stay available here

        if (handler) {
          const result =
            (await handler({
              call,
              params,
              dispatchTL,
              scheduleStewardRun,
              stewardEnabled,
              emitEditorAction: emitEditorAction,
            })) ?? { status: 'IGNORED' };

          queue.markComplete(call.id, result.message);
          emitDone(call, result);
          return result;
        }

        if (tool === 'tldraw_envelope') {
          try {
            const paramsRecord = toRecord(params);
            const rawEnvelope = paramsRecord?.envelope;
            const rawActions = paramsRecord?.actions;
            const env = rawEnvelope || (Array.isArray(rawActions) ? { actions: rawActions } : null);
            if (env && (toRecord(env)?.actions || (Array.isArray(env) && env.length))) {
              const envelopeCandidate = Array.isArray(env)
                ? { v: ACTION_VERSION, sessionId: 'svr', seq: 0, actions: env, ts: Date.now() }
                : env;
              const parsedEnvelope = AgentActionEnvelopeSchema.safeParse(envelopeCandidate);
              if (!parsedEnvelope.success) {
                const message = `Invalid TLDraw envelope: ${parsedEnvelope.error.issues[0]?.message || 'schema mismatch'}`;
                queue.markError(call.id, message);
                emitError(call, message);
                return { status: 'ERROR', message };
              }
              const editor = getEditor();
              if (editor) {
                applyEnvelope({ editor, isHost: true, appliedIds: new Set() }, parsedEnvelope.data);
                const result = { status: 'SUCCESS', message: 'Applied envelope' } as ToolRunResult;
                queue.markComplete(call.id, result.message);
                emitDone(call, result);
                return result;
              }
            }
            const result = { status: 'IGNORED', message: 'No envelope/actions' } as ToolRunResult;
            queue.markComplete(call.id, result.message);
            emitDone(call, result);
            return result;
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            queue.markError(call.id, message);
            emitError(call, message);
            return { status: 'ERROR', message };
          }
        }

        if (tool === 'dispatch_to_conductor') {
          const task = typeof params?.task === 'string' ? params.task.trim() : '';
          const dispatchParams = (params?.params as Record<string, unknown>) || {};
          const correlation = deriveRequestCorrelation({
            task,
            requestId: params?.requestId,
            params: dispatchParams as JsonObject,
          });
          if (correlation.requestId && !dispatchParams.requestId) {
            dispatchParams.requestId = correlation.requestId;
          }
          if (task === 'fairy.intent' && correlation.intentId && !dispatchParams.id) {
            dispatchParams.id = correlation.intentId;
          }
          if (correlation.traceId && !dispatchParams.traceId) {
            dispatchParams.traceId = correlation.traceId;
          }
          const requestId = correlation.requestId;
          const executionId =
            typeof dispatchParams.executionId === 'string' && dispatchParams.executionId.trim().length > 0
              ? dispatchParams.executionId.trim()
              : typeof params?.executionId === 'string' && params.executionId.trim().length > 0
                ? params.executionId.trim()
                : undefined;
          const idempotencyKey =
            typeof dispatchParams.idempotencyKey === 'string' && dispatchParams.idempotencyKey.trim().length > 0
              ? dispatchParams.idempotencyKey.trim()
              : typeof params?.idempotencyKey === 'string' && params.idempotencyKey.trim().length > 0
                ? params.idempotencyKey.trim()
                : requestId;
          const lockKey =
            typeof dispatchParams.lockKey === 'string' && dispatchParams.lockKey.trim().length > 0
              ? dispatchParams.lockKey.trim()
              : typeof params?.lockKey === 'string' && params.lockKey.trim().length > 0
                ? params.lockKey.trim()
                : undefined;
          const attempt =
            typeof dispatchParams.attempt === 'number' && Number.isFinite(dispatchParams.attempt)
              ? dispatchParams.attempt
              : typeof params?.attempt === 'number' && Number.isFinite(params.attempt)
                ? params.attempt
                : undefined;

          if (!task) {
            const message = 'dispatch_to_conductor requires a task value';
            queue.markError(call.id, message);
            emitError(call, message);
            return { status: 'ERROR', message };
          }

          const dispatchRoom = resolveDispatchRoom({
            callRoomId: call.roomId,
            activeRoomName: room?.name,
          });
          const { roomFromCall, activeRoomName, targetRoom, hasRoomMismatch } = dispatchRoom;
          const requiresRoomIntegrity =
            task.startsWith('canvas.') || task.startsWith('fairy.') || task.startsWith('scorecard.');

          if (requiresRoomIntegrity && hasRoomMismatch) {
            const message = `dispatch_to_conductor room mismatch (event ${roomFromCall}, active ${activeRoomName})`;
            const result = {
              status: 'FAILED',
              message,
              reasonCode: 'room_mismatch',
            } as ToolRunResult;
            queue.markError(call.id, message);
            emitDone(call, result);
            emitStewardStatusTranscript({
              taskName: task,
              status: 'failed',
              message,
            });
            return result;
          }

          if (stewardEnabled && (task.startsWith('canvas.') || task.startsWith('fairy.'))) {
            if (!targetRoom || targetRoom.trim().length === 0) {
              const message = 'dispatch_to_conductor requires a room identity';
              queue.markError(call.id, message);
              emitError(call, message);
              return { status: 'ERROR', message };
            }
            if (task === 'canvas.agent_prompt') {
              if (!dispatchParams.message && typeof params?.message === 'string') {
                dispatchParams.message = params.message;
              }
              if (!dispatchParams.message && typeof params?.instruction === 'string') {
                dispatchParams.message = params.instruction;
              }
              if (!dispatchParams.requestId && typeof params?.requestId === 'string') {
                dispatchParams.requestId = params.requestId;
              }
              const currentRoom = targetRoom;
              const active = activeCanvasDispatchRef.current;
              if (
                active &&
                active.room === currentRoom &&
                active.message === String(dispatchParams.message || '') &&
                (active.requestId === undefined || active.requestId === dispatchParams.requestId)
              ) {
                const result = { status: 'IGNORED', message: 'Canvas task already in flight' } as ToolRunResult;
                queue.markComplete(call.id, result.message);
                emitDone(call, result);
                return result;
              }
              activeCanvasDispatchRef.current = {
                room: currentRoom,
                message: String(dispatchParams.message || ''),
                requestId: typeof dispatchParams.requestId === 'string' ? dispatchParams.requestId : undefined,
              };
            }
            log('dispatch_to_conductor forwarding steward task', { task, params: dispatchParams, room: targetRoom });
            try {
              const res = await fetchWithSupabaseAuth('/api/steward/runCanvas', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  room: targetRoom,
                  task,
                  params: dispatchParams,
                  executionId,
                  idempotencyKey,
                  lockKey,
                  attempt,
                  summary: typeof params?.summary === 'string' ? params.summary : undefined,
                  requestId: correlation.requestId,
                  traceId: correlation.traceId,
                  intentId: correlation.intentId,
                }),
              });
              if (!res.ok) {
                const message = `Steward dispatch failed: HTTP ${res.status}`;
                queue.markError(call.id, message);
                emitError(call, message);
                if (task === 'canvas.agent_prompt') {
                  activeCanvasDispatchRef.current = null;
                }
                return { status: 'ERROR', message };
              }
              const responseJson = await res.json().catch(() => ({}));
              const responseRecord =
                responseJson && typeof responseJson === "object"
                  ? (responseJson as Record<string, unknown>)
                  : {};
              const responseTask =
                responseRecord.task && typeof responseRecord.task === "object"
                  ? (responseRecord.task as Record<string, unknown>)
                  : undefined;
              const taskId =
                typeof responseRecord.taskId === "string"
                  ? responseRecord.taskId
                  : typeof responseTask?.id === "string"
                    ? responseTask.id
                    : undefined;
              const responseStatus =
                typeof responseRecord.status === "string"
                  ? responseRecord.status.trim().toLowerCase()
                  : "queued";
              const traceId =
                typeof responseRecord.traceId === 'string' && responseRecord.traceId.trim().length > 0
                  ? responseRecord.traceId.trim()
                  : undefined;
              const result = {
                status: responseStatus === "executed_fallback" ? "COMPLETED" : "QUEUED",
                message:
                  responseStatus === "executed_fallback"
                    ? `${task} applied (fallback)`
                    : `${task} queued${taskId ? ` (task ${taskId.slice(0, 8)})` : ''}`,
                ...(taskId ? { taskId } : {}),
              } as ToolRunResult;
              queue.markComplete(call.id, result.message);
              emitDone(call, result);
              emitStewardStatusTranscript({
                taskName: task,
                status: result.status === 'COMPLETED' ? 'applied' : 'queued',
                taskId,
                traceId,
                message: result.message,
              });
              if (taskId && typeof targetRoom === "string" && targetRoom.trim().length > 0) {
                void pollStewardTaskCompletion({
                  call,
                  taskId,
                  roomName: targetRoom,
                  taskName: task,
                });
              }
              if (task === 'canvas.agent_prompt') {
                activeCanvasDispatchRef.current = null;
              }
              return result;
            } catch (error) {
              const message = `Steward dispatch error: ${error instanceof Error ? error.message : String(error)}`;
              queue.markError(call.id, message);
              emitError(call, message);
              if (task === 'canvas.agent_prompt') {
                activeCanvasDispatchRef.current = null;
              }
              return { status: 'ERROR', message };
            }
          }

          if (task.startsWith('scorecard.')) {
            const componentId =
              (dispatchParams.componentId as string) ??
              (params?.componentId as string) ??
              undefined;

            if (!targetRoom || typeof targetRoom !== 'string') {
              const message = 'scorecard dispatch requires a room';
              queue.markError(call.id, message);
              emitError(call, message);
              return { status: 'ERROR', message };
            }

            if (!componentId || typeof componentId !== 'string') {
              const message = 'scorecard dispatch requires componentId';
              queue.markError(call.id, message);
              emitError(call, message);
              return { status: 'ERROR', message };
            }

            const body = {
              ...(dispatchParams || {}),
              task,
              room: targetRoom,
              componentId,
              requestId,
              executionId,
              idempotencyKey,
              lockKey,
              attempt,
              windowMs:
                typeof dispatchParams.windowMs === 'number'
                  ? dispatchParams.windowMs
                  : typeof params?.windowMs === 'number'
                    ? params.windowMs
                    : undefined,
              summary:
                typeof params?.summary === 'string'
                  ? params.summary
                  : typeof dispatchParams.summary === 'string'
                    ? (dispatchParams.summary as string)
                    : undefined,
              prompt:
                typeof params?.prompt === 'string'
                  ? params.prompt
                  : typeof dispatchParams.prompt === 'string'
                    ? (dispatchParams.prompt as string)
                    : undefined,
              intent:
                typeof dispatchParams.intent === 'string'
                  ? (dispatchParams.intent as string)
                  : typeof params?.intent === 'string'
                    ? params.intent
                    : task,
              topic:
                typeof dispatchParams.topic === 'string'
                  ? (dispatchParams.topic as string)
                  : typeof params?.topic === 'string'
                    ? params.topic
                    : undefined,
            };

            try {
              const res = await fetchWithSupabaseAuth('/api/steward/runScorecard', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
              });
              if (!res.ok) {
                const message = `Scorecard steward dispatch failed: HTTP ${res.status}`;
                queue.markError(call.id, message);
                emitError(call, message);
                return { status: 'ERROR', message };
              }
              const responseJson = await res.json().catch(() => ({}));
              const responseRecord =
                responseJson && typeof responseJson === "object"
                  ? (responseJson as Record<string, unknown>)
                  : {};
              const responseTask =
                responseRecord.task && typeof responseRecord.task === "object"
                  ? (responseRecord.task as Record<string, unknown>)
                  : undefined;
              const taskId =
                typeof responseRecord.taskId === "string"
                  ? responseRecord.taskId
                  : typeof responseTask?.id === "string"
                    ? responseTask.id
                    : undefined;
              const responseStatus =
                typeof responseRecord.status === "string"
                  ? responseRecord.status.trim().toLowerCase()
                  : "queued";
              const traceId =
                typeof responseRecord.traceId === 'string' && responseRecord.traceId.trim().length > 0
                  ? responseRecord.traceId.trim()
                  : undefined;
              const result = {
                status: responseStatus === "executed_fallback" ? "COMPLETED" : "QUEUED",
                message:
                  responseStatus === "executed_fallback"
                    ? `${task} applied (fallback)`
                    : `${task} queued${taskId ? ` (task ${taskId.slice(0, 8)})` : ''}`,
                ...(taskId ? { taskId } : {}),
              } as ToolRunResult;
              queue.markComplete(call.id, result.message);
              emitDone(call, result);
              emitStewardStatusTranscript({
                taskName: task,
                status: result.status === 'COMPLETED' ? 'applied' : 'queued',
                taskId,
                traceId,
                message: result.message,
              });
              if (taskId) {
                void pollStewardTaskCompletion({
                  call,
                  taskId,
                  roomName: targetRoom,
                  taskName: task,
                });
              }
              return result;
            } catch (error) {
              const message = `Scorecard steward dispatch error: ${error instanceof Error ? error.message : String(error)}`;
              queue.markError(call.id, message);
              emitError(call, message);
              return { status: 'ERROR', message };
            }
          }

          const message = `Unsupported dispatch task in this mode: ${task}`;
          queue.markError(call.id, message);
          emitError(call, message);
          return { status: 'ERROR', message };
        }

        if (tool.startsWith('mcp_')) {
          const result = await runMcpTool(tool, params);
          const normalizedResult = result ?? { status: 'IGNORED' };
          if (normalizedResult.status === 'ERROR') {
            const message = normalizedResult.message ?? `MCP tool error: ${tool}`;
            queue.markError(call.id, message);
            emitError(call, normalizedResult);
          } else {
            queue.markComplete(call.id, normalizedResult.message);
            emitDone(call, normalizedResult);
          }
          return normalizedResult;
        }

        if (tool === 'youtube_search') {
          const query = String(params?.query || '').trim();
          if (!query) {
            const result = { status: 'IGNORED', message: 'No YouTube query provided' };
            queue.markComplete(call.id, result.message);
            emitDone(call, result);
            return result;
          }

          // Prefer first-party API (prod reliable). Fall back to MCP if configured.
          try {
            const url = new URL('/api/youtube/search', window.location.origin);
            url.searchParams.set('q', query);
            url.searchParams.set('maxResults', '3');
            const res = await fetch(url.toString(), { method: 'GET' });
            if (res.ok) {
              const json = await res.json().catch(() => null);
              const first = Array.isArray(json?.items) ? json.items[0] : null;
              const videoId = first?.id ? String(first.id) : null;
              if (videoId) {
                const messageId = `ui-youtube-${Date.now()}`;
                window.dispatchEvent(
                  new CustomEvent('custom:showComponent', {
                    detail: {
                      messageId,
                      component: { type: 'YoutubeEmbed', props: { videoId } },
                      contextKey,
                    },
                  }),
                );
                const result = { status: 'SUCCESS', message: 'Rendered YouTube video', videoId };
                queue.markComplete(call.id, result.message);
                emitDone(call, result);
                return result;
              }
            }
          } catch (error) {
            logger.warn('youtube_search API failed', { error });
          }

          try {
            const mcpResult = await window.callMcpTool?.('searchVideos', { query });
            const mcpRecord = toRecord(mcpResult);
            const videos = Array.isArray(mcpRecord?.videos) ? mcpRecord.videos : [];
            const items = Array.isArray(mcpRecord?.items) ? mcpRecord.items : [];
            const first = (videos[0] || items[0]) as unknown;
            const firstRecord = toRecord(first);
            const videoId =
              (typeof firstRecord?.id === 'string' && firstRecord.id) ||
              (typeof firstRecord?.videoId === 'string' && firstRecord.videoId) ||
              (typeof firstRecord?.video_id === 'string' && firstRecord.video_id) ||
              null;
            if (videoId) {
              const messageId = `ui-youtube-${Date.now()}`;
              window.dispatchEvent(
                new CustomEvent('custom:showComponent', {
                  detail: {
                    messageId,
                    component: { type: 'YoutubeEmbed', props: { videoId } },
                    contextKey,
                  },
                }),
              );
              const result = { status: 'SUCCESS', message: 'Rendered YouTube video', videoId };
              queue.markComplete(call.id, result.message);
              emitDone(call, result);
              return result;
            }
          } catch (error) {
            logger.warn('youtube_search MCP failed', { error });
          }
          const result = { status: 'IGNORED', message: 'No YouTube result' };
          queue.markComplete(call.id, result.message);
          emitDone(call, result);
          return result;
        }

        const result = { status: 'IGNORED', message: `Unsupported tool: ${tool}` };
        queue.markComplete(call.id, result.message);
        emitDone(call, result);
        return result;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        queue.markError(call.id, message);
        emitError(call, message);
        log('error executing tool', tool, error);
        return { status: 'ERROR', message };
      }
    },
    [contextKey, dispatchTL, emitDone, emitError, emitRequest, emitEditorAction, emitStewardStatusTranscript, log, logger, pollStewardTaskCompletion, queue, registry, runMcpTool, scheduleStewardRun, stewardEnabled, room?.name],
  );

  const flushDeferredToolCalls = useCallback(async () => {
    const deferred = deferredToolCallsRef.current;
    if (deferred.size === 0) return;

    const now = Date.now();
    for (const [key, entry] of deferred.entries()) {
      if (now - entry.enqueuedAt > DEFERRED_TOOL_CALL_TTL_MS) {
        deferred.delete(key);
      }
    }
    if (deferred.size === 0) return;

    const localIdentity =
      typeof room?.localParticipant?.identity === 'string'
        ? room.localParticipant.identity.trim()
        : '';
    const executorIdentity =
      typeof executor.executorIdentity === 'string' ? executor.executorIdentity.trim() : '';

    if (!executor.isExecutor) {
      if (executorIdentity && localIdentity && executorIdentity !== localIdentity) {
        deferred.clear();
      }
      return;
    }

    const orderedEntries = Array.from(deferred.entries()).sort(
      (a, b) => a[1].enqueuedAt - b[1].enqueuedAt,
    );
    for (const [key, entry] of orderedEntries) {
      deferred.delete(key);
      const decision = shouldExecuteIncomingToolCall({
        isExecutor: true,
        processed: processedToolCallIdsRef.current,
        roomKey: entry.roomKey,
        callId: entry.call.id,
        now: Date.now(),
      });
      if (!decision.execute) continue;
      try {
        await executeToolCall(entry.call);
      } catch (error) {
        logger.warn('failed replaying deferred tool_call', {
          roomKey: entry.roomKey,
          callId: entry.call.id,
          error,
        });
      }
    }
  }, [
    DEFERRED_TOOL_CALL_TTL_MS,
    executeToolCall,
    executor.executorIdentity,
    executor.isExecutor,
    logger,
    room?.localParticipant?.identity,
  ]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.__presentToolDispatcherExecute = executeToolCall;
    return () => {
      if (window.__presentToolDispatcherExecute === executeToolCall) {
        delete window.__presentToolDispatcherExecute;
      }
    };
  }, [executeToolCall]);

  useEffect(() => {
    void flushDeferredToolCalls();
  }, [flushDeferredToolCalls]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const intervalMs = Math.max(500, Math.min(5000, Math.floor(DEFERRED_TOOL_CALL_TTL_MS / 4)));
    const timer = window.setInterval(() => {
      void flushDeferredToolCalls();
    }, intervalMs);
    return () => {
      window.clearInterval(timer);
    };
  }, [DEFERRED_TOOL_CALL_TTL_MS, flushDeferredToolCalls]);

  useEffect(() => {
    return () => {
      deferredToolCallsRef.current.clear();
    };
  }, []);

  useEffect(() => {
    const runStewardTrigger = async (parsed: StewardTriggerMessage) => {
      if (!stewardEnabled) return;
      window.__present_steward_active = true;
      const roomName =
        (typeof parsed.payload.room === 'string' && parsed.payload.room.trim()) ||
        (typeof parsed.roomId === 'string' && parsed.roomId.trim()) ||
        room?.name ||
        '';
      if (!roomName) {
        log('steward trigger ignored: missing room');
        return;
      }

      if (parsed.payload.kind === 'flowchart') {
        let existingDocId =
          typeof window.__present_mermaid_last_shape_id === 'string'
            ? window.__present_mermaid_last_shape_id
            : '';

        if (!existingDocId) {
          try {
            const editor = getEditor();
            const shapes = editor?.getCurrentPageShapes?.() ?? [];
            for (let i = shapes.length - 1; i >= 0; i -= 1) {
              const shape = shapes[i];
              if (shape?.type === 'mermaid_stream' && typeof shape?.id === 'string') {
                existingDocId = shape.id;
                window.__present_mermaid_last_shape_id = shape.id;
                break;
              }
            }
          } catch (error) {
            log('steward_run: failed to recover existing mermaid shape', error);
          }
        }

        if (!existingDocId) {
          await executeToolCall({
            id: parsed.id || `${Date.now()}`,
            type: 'tool_call',
            payload: { tool: 'mermaid_create_stream', params: { text: 'graph TD;\nA-->B;' } },
            timestamp: Date.now(),
            source: 'dispatcher',
            roomId: parsed.roomId,
          });
        }

        const docId =
          typeof window.__present_mermaid_last_shape_id === 'string'
            ? window.__present_mermaid_last_shape_id
            : '';
        if (docId) {
          scheduleStewardRun(roomName, docId);
        } else {
          window.setTimeout(() => {
            const fallbackId = String(window.__present_mermaid_last_shape_id || '');
            if (fallbackId) {
              scheduleStewardRun(roomName, fallbackId);
            }
          }, 150);
        }
        return;
      }

      if (parsed.payload.kind === 'canvas') {
        const intentSummary =
          typeof parsed.payload.summary === 'string' && parsed.payload.summary.trim()
            ? parsed.payload.summary.trim()
            : typeof parsed.payload.reason === 'string'
              ? parsed.payload.reason.trim()
              : '';
        const body = {
          room: roomName,
          task: 'canvas.draw',
          params: {
            room: roomName,
            summary: intentSummary,
          },
          summary: intentSummary,
        };
        const res = await fetch('/api/steward/runCanvas', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          log('canvas steward request failed', { status: res.status });
        }
      }
    };

    const offTool = bus.on('tool_call', (message: unknown) => {
      try {
        const parsed = parseToolCallMessage(message);
        if (!parsed) {
          logger.debug('ignored non-tool_call payload', { message });
          return;
        }
        const tool = parsed.payload.tool;
        const params = parsed.payload.params || {};
        const callId = parsed.id || `${Date.now()}`;
        const toolCall: ToolCall = {
          id: callId,
          type: 'tool_call',
          payload: { tool, params },
          timestamp: parsed.timestamp || Date.now(),
          source: 'dispatcher',
          roomId: parsed.roomId,
        };
        const context = toRecord(parsed.payload.context);
        const roomKey =
          (typeof parsed.roomId === 'string' && parsed.roomId.trim()) ||
          (typeof room?.name === 'string' ? room.name : '') ||
          'unknown-room';
        const now = Date.now();
        const executionDecision = shouldExecuteIncomingToolCall({
          isExecutor: executor.isExecutor,
          processed: processedToolCallIdsRef.current,
          roomKey,
          callId,
          now,
        });

        if (!executionDecision.execute) {
          const localIdentity =
            typeof room?.localParticipant?.identity === 'string'
              ? room.localParticipant.identity.trim()
              : '';
          const shouldDefer = shouldDeferToolCallWhenNotExecutor({
            reason: executionDecision.reason,
            executorIdentity: executor.executorIdentity,
            localIdentity,
          });
          if (shouldDefer) {
            const deferred = deferredToolCallsRef.current;
            if (!deferred.has(executionDecision.key)) {
              if (deferred.size >= DEFERRED_TOOL_CALL_MAX) {
                const oldestKey = deferred.keys().next().value;
                if (typeof oldestKey === 'string') {
                  deferred.delete(oldestKey);
                }
              }
              deferred.set(executionDecision.key, {
                call: toolCall,
                roomKey,
                enqueuedAt: now,
              });
              log('deferred tool_call awaiting executor lock', {
                callId,
                tool: tool || 'unknown',
                roomKey,
                queued: deferred.size,
              });
            }
          }
          if (metricsEnabled && typeof window !== 'undefined') {
            try {
              window.dispatchEvent(
                new CustomEvent('present:tool_call_skipped', {
                  detail: {
                    callId,
                    tool: tool || 'unknown',
                    reason: executionDecision.reason || 'unknown',
                    executorIdentity: executor.executorIdentity,
                  },
                }),
              );
            } catch {}
          }
          return;
        }
        if (typeof window !== 'undefined') {
          try {
            const w = window as any;
            w.__present = w.__present || {};
            w.__present.lastProcessedToolCallId = callId;
          } catch {}
        }
        if (metricsEnabled && typeof window !== 'undefined') {
          try {
            const nestedParams = toRecord(params.params);
            const task = typeof params.task === 'string' ? params.task : null;
            const dispatchMessage =
              typeof nestedParams?.message === 'string'
                ? String(nestedParams.message).slice(0, 160)
                : null;
            window.dispatchEvent(
              new CustomEvent('present:tool_call_received', {
                detail: {
                  callId,
                  tool: tool || 'unknown',
                  task,
                  dispatchMessage,
                  source:
                    typeof context?.source === 'string'
                      ? context.source
                      : typeof parsed.source === 'string'
                        ? parsed.source
                        : null,
                  roomId: typeof parsed.roomId === 'string' ? parsed.roomId : null,
                  sentAt:
                    typeof context?.timestamp === 'number'
                      ? context.timestamp
                      : typeof parsed.timestamp === 'number'
                        ? parsed.timestamp
                        : null,
                  receivedAt: Date.now(),
                },
              }),
            );
          } catch {}
        }
        if (metricsEnabled) {
          const existing = metricsByCallRef.current.get(callId);
          const next: ToolMetricEntry = existing ?? {
            callId,
            tool: tool || 'unknown',
            messageIds: new Set(),
            metaByMessage: new Map(),
            loggedMessages: new Set(),
          };
          next.tool = tool || next.tool;
          const contextTs = typeof context?.timestamp === 'number' ? context.timestamp : undefined;
          if (contextTs !== undefined) {
            next.sendContextTs = contextTs;
          }
          const generatedTs = typeof parsed.timestamp === 'number' ? parsed.timestamp : undefined;
          if (generatedTs !== undefined) {
            next.sendGeneratedAt = generatedTs;
          }
          next.arriveAt = Date.now();
          next.arrivePerf = typeof performance !== 'undefined' ? performance.now() : next.arrivePerf;
          metricsByCallRef.current.set(callId, next);
        }
        log('received tool_call from data channel:', tool, params);
        void executeToolCall(toolCall);
      } catch (error) {
        logger.error('failed handling tool_call', { error });
      }
    });

    const offStewardTrigger = bus.on('steward_trigger', (message: unknown) => {
      const parsed = parseStewardTriggerMessage(message);
      if (!parsed) {
        logger.debug('ignored invalid steward_trigger payload', { message });
        return;
      }

      void (async () => {
        try {
          await runStewardTrigger(parsed);
        } catch (error) {
          logger.error('failed handling steward_trigger', { error });
        }
      })();
    });

    const offDecision = bus.on('decision', async (message: unknown) => {
      try {
        const parsed = parseDecisionMessage(message);
        if (!parsed) {
          logger.debug('ignored non-decision payload', { message });
          return;
        }
        const decision = parsed.payload.decision || {};
        const originalText = parsed.payload.originalText || '';
        log('received decision from data channel:', decision);

        const rawSummary = typeof decision.summary === 'string' ? decision.summary : '';
        const summary: string = String(rawSummary || originalText || '').toLowerCase();

        if (stewardEnabled) {
          const explicitTrigger = parseStewardTriggerMessage({
            type: 'steward_trigger',
            id: parsed.id,
            roomId: parsed.roomId,
            payload: parsed.payload.stewardTrigger,
          });
          if (explicitTrigger) {
            await runStewardTrigger(explicitTrigger);
            return;
          }

          if (decision.should_send) {
            const legacySummary = rawSummary.trim().toLowerCase();
            if (legacySummary === 'steward_trigger' || legacySummary === 'steward_trigger_canvas') {
              const legacyTrigger: StewardTriggerMessage = {
                type: 'steward_trigger',
                id: parsed.id,
                roomId: parsed.roomId,
                payload: {
                  kind: legacySummary === 'steward_trigger_canvas' ? 'canvas' : 'flowchart',
                  room: parsed.roomId || room?.name,
                  summary: originalText || rawSummary || undefined,
                  reason: 'legacy_decision_summary_adapter',
                },
              };
              logger.warn('using legacy decision summary steward adapter', {
                summary: legacySummary,
              });
              await runStewardTrigger(legacyTrigger);
              return;
	            }
	            const intentSummary = typeof originalText === 'string' && originalText.trim() ? originalText.trim() : summary;
	            const roomName = (parsed.roomId || room?.name || '').trim();
	            if (!roomName) {
	              logger.warn('skipping canvas steward trigger without room name');
	              return;
	            }
	            log('canvas steward trigger received', { room: roomName, summary: intentSummary });
	            const body = {
              room: roomName,
              task: 'canvas.draw',
              params: {
                room: roomName,
                summary: intentSummary,
              },
              summary: intentSummary,
            };
            try {
              // TODO: move steward dispatch to a typed conductor task instead of direct fetch.
              const res = await fetchWithSupabaseAuth('/api/steward/runCanvas', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
              });
              if (!res.ok) {
                log('canvas steward request failed', { status: res.status });
              }
            } catch (error) {
              log('canvas steward request error', error);
            }
            return;
          }
          return;
        }

        const minutesParsed = parseMinutesFromText(summary);
        if (decision.should_send && minutesParsed) {
          const minutes = Math.max(1, Math.min(180, minutesParsed));
          log('synthesizing timer component', { minutes });
          await executeToolCall({
            id: parsed.id || `${Date.now()}`,
            type: 'tool_call',
            payload: {
              tool: 'create_component',
              params: { type: 'RetroTimerEnhanced', initialMinutes: minutes },
            },
            timestamp: Date.now(),
            source: 'dispatcher',
            roomId: parsed.roomId,
          });
          return;
        }

        const isWeather = /\bweather\b|\bforecast\b/.test(summary);
        const wantsMermaid = /\bmermaid\b|\bflow\s*chart\b|\bdiagram\b/.test(summary);
        const lastShapeId = window.__present_mermaid_last_shape_id;
        const session = window.__present_mermaid_session;
        const stewardActive = !!window.__present_steward_active;
        const isDiagramFollowup = /\bdiagram\b|\bflow\s*chart\b|\bitinerary\b|\bmap out\b|\bprocess\b|\bsteps?\b/i.test(
          originalText || summary,
        );
        if (!stewardActive && lastShapeId && (isDiagramFollowup || wantsMermaid)) {
          const sanitize = (value: string) =>
            value
              .toLowerCase()
              .replace(/[^a-z0-9\s_-]/g, '')
              .trim()
              .split(/\s+/)
              .slice(0, 5)
              .join('_') || `step_${Date.now().toString(36)}`;
          const current = typeof session?.text === 'string' ? session.text : 'graph TD;';
          const last = typeof session?.last === 'string' ? session.last : 'Start';
          const next = sanitize(originalText || summary);
          const line = `${last}-->${next}`;
          const merged = current.includes('graph') ? `${current} ${line};` : `graph TD; ${line};`;
          window.__present_mermaid_session = { last: next, text: merged };
          await executeToolCall({
            id: parsed.id || `${Date.now()}`,
            type: 'tool_call',
            payload: { tool: 'mermaid_update_stream', params: { shapeId: lastShapeId, text: merged } },
            timestamp: Date.now(),
            source: 'dispatcher',
            roomId: parsed.roomId,
          });
          return;
        }
        if (!stewardActive && decision.should_send && wantsMermaid && !lastShapeId) {
          log('synthesizing mermaid stream shape');
          await executeToolCall({
            id: parsed.id || `${Date.now()}`,
            type: 'tool_call',
            payload: { tool: 'mermaid_create_stream', params: { text: 'graph TD; A-->B' } },
            timestamp: Date.now(),
            source: 'dispatcher',
            roomId: parsed.roomId,
          });
          return;
        }
        if (decision.should_send && isWeather) {
          const locMatch = /\b(?:in|for)\s+([^.,!?]+)\b/.exec(String(decision.summary || originalText));
          const location = locMatch ? locMatch[1].replace(/\s+on the canvas\b/i, '').trim() : undefined;
          log('synthesizing weather component', { location });
          await executeToolCall({
            id: parsed.id || `${Date.now()}`,
            type: 'tool_call',
            payload: {
              tool: 'create_component',
              params: { type: 'WeatherForecast', location },
            },
            timestamp: Date.now(),
            source: 'dispatcher',
            roomId: parsed.roomId,
          });
        }
      } catch (error) {
        logger.error('failed handling decision', { error });
      }
    });

    return () => {
      offTool();
      offStewardTrigger();
      offDecision();
    };
  }, [bus, executeToolCall, log, logger, room, scheduleStewardRun, stewardEnabled, metricsEnabled, executor.executorIdentity, executor.isExecutor]);

  useEffect(() => {
    if (!stewardEnabled) return;
    const fallbackDebounce = new Map<string, number>();
    const resolveRoomNameFromWindow = (): string | undefined => {
      if (typeof window === 'undefined') return undefined;
      const candidate: unknown =
        window.__present?.livekitRoomName ?? window.__present_roomName ?? window.__present_canvas_room;
      const name = typeof candidate === 'string' ? candidate.trim() : '';
      return name || undefined;
    };

    const handleFallback = (event: Event) => {
      try {
        const detail = (event as CustomEvent).detail || {};
        const docIdRaw =
          (typeof detail.docId === 'string' && detail.docId) ||
          (typeof detail.shapeId === 'string' && detail.shapeId) ||
          '';
        const docId = docIdRaw.trim();
        if (!docId) return;
        const roomFromDetail =
          typeof detail.room === 'string' && detail.room.trim().length > 0
            ? String(detail.room).trim()
            : undefined;
        const roomFromContext =
          typeof room?.name === 'string' && room.name.trim().length > 0
            ? room.name.trim()
            : undefined;
        const resolvedRoom = roomFromDetail || roomFromContext || resolveRoomNameFromWindow();
        if (!resolvedRoom) return;
        const key = `${resolvedRoom}:${docId}`;
        const now = Date.now();
        const last = fallbackDebounce.get(key) ?? 0;
        if (now - last < 12000) {
          log('steward_run: fallback skipped (debounced)', { room: resolvedRoom, docId });
          return;
        }
        fallbackDebounce.set(key, now);
        log('steward_run: fallback triggered', {
          room: resolvedRoom,
          docId,
          error: detail?.error,
        });
        triggerStewardRun(resolvedRoom, docId, TOOL_STEWARD_WINDOW_MS, {
          mode: 'slow',
          reason: 'mermaid_compile_error',
        });
        if (stewardPendingRef.current && stewardCompleteRef.current) {
          if (slowReleaseTimerRef.current) {
            try {
              window.clearTimeout(slowReleaseTimerRef.current);
            } catch {}
            slowReleaseTimerRef.current = null;
          }
          slowReleaseTimerRef.current = window.setTimeout(() => {
            slowReleaseTimerRef.current = null;
            try {
              stewardCompleteRef.current?.();
            } catch (err) {
              logger.warn('failed to flush steward pending state after fallback', { err });
            }
          }, 1500);
        }
      } catch (error) {
        logger.warn('failed to process flowchart fallback event', { error });
      }
    };

    window.addEventListener('present:flowchart-fallback', handleFallback as EventListener);
    return () => {
      window.removeEventListener('present:flowchart-fallback', handleFallback as EventListener);
      fallbackDebounce.clear();
      if (slowReleaseTimerRef.current) {
        try {
          window.clearTimeout(slowReleaseTimerRef.current);
        } catch {}
        slowReleaseTimerRef.current = null;
      }
    };
  }, [log, logger, room, stewardEnabled, triggerStewardRun]);

  useEffect(() => {
    window.__custom_tool_dispatcher = {
      executeMCPTool: async (tool: string, params: Record<string, unknown>) => {
        return executeToolCall({
          id: crypto.randomUUID?.() || String(Date.now()),
          type: 'tool_call',
          payload: { tool, params },
          timestamp: Date.now(),
          source: 'bridge',
        });
      },
    };

    return () => {
      if (window.__custom_tool_dispatcher?.executeMCPTool) {
        delete window.__custom_tool_dispatcher;
      }
    };
  }, [executeToolCall]);

  return useMemo(() => ({ executeToolCall, queue }), [executeToolCall, queue]);
}

function getEditor(): Editor | null {
  if (typeof window === 'undefined') return null;
  const editor = window.__present?.tldrawEditor;
  return editor ?? null;
}

function parseMinutesFromText(text: string): number | undefined {
  const match = text.match(/\b(?:for\s+)?(\d{1,3})\s*(?:minute|minutes|mins|min|m)\b/);
  if (!match) return undefined;
  return Number(match[1]);
}

function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function toToolRunResult(value: unknown): ToolRunResult {
  const record = toRecord(value);
  if (record && typeof record.status === 'string') {
    return record as ToolRunResult;
  }
  return { status: 'IGNORED' };
}
