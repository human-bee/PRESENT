"use client";

import { useEffect, useMemo } from 'react';
import type { Room } from 'livekit-client';
import { createLiveKitBus } from '@/lib/livekit/livekit-bus';
import { ComponentRegistry } from '@/lib/component-registry';
import { createObservabilityBridge } from '@/lib/observability-bridge';
import { TOOL_EVENT_TOPICS } from '../utils/constants';
import type { ToolRunResult, ToolCall } from '../utils/toolTypes';
import { createLogger } from '@/lib/logging';
import { parseJsonObject } from '@/lib/agents/shared/schemas';
import type { StewardTriggerMessage } from '@/lib/livekit/protocol';

export interface ToolEventsApi {
  emitRequest: (call: ToolCall) => void;
  emitStarted: (call: ToolCall) => void;
  emitUpdate: (call: ToolCall, payload: unknown) => void;
  emitDone: (call: ToolCall, result: ToolRunResult) => void;
  emitError: (call: ToolCall, error: unknown) => void;
  emitEditorAction: (payload: Record<string, unknown>) => void;
  emitDecision: (payload: Record<string, unknown>) => void;
  emitStewardTrigger: (payload: StewardTriggerMessage['payload']) => void;
  log: (...args: unknown[]) => void;
  bus: ReturnType<typeof createLiveKitBus>;
}

interface UseToolEventsOptions {
  enableLogging?: boolean;
}

export function useToolEvents(room: Room | undefined, options: UseToolEventsOptions = {}): ToolEventsApi {
  const { enableLogging = false } = options;
  const logger = useMemo(() => createLogger('ToolDispatcher:events'), []);

  const bus = useMemo(() => createLiveKitBus(room), [room]);

  useEffect(() => {
    if (!room) return;
    try {
      createObservabilityBridge(room);
    } catch (error) {
      if (enableLogging) {
        logger.warn('observability bridge failed', { error });
      }
    }
  }, [room, enableLogging, logger]);

  const log = (...args: unknown[]) => {
    if (!enableLogging) return;
    logger.info(...args);
  };

  const emit = (topic: string, payload: Record<string, unknown>) => {
    try {
      bus.send(topic, payload);
    } catch (error) {
      if (enableLogging) {
        logger.warn('failed to publish event', { topic, error });
      }
    }
  };

  useEffect(() => {
    const pendingUpdates = new Map<
      string,
      { message: unknown; enqueuedAt: number; attempts: number }
    >();
    const PENDING_UPDATE_MAX_AGE_MS = 20_000;
    const PENDING_UPDATE_MAX_ATTEMPTS = 80;
    let flushHandle: number | null = null;

    const scheduleFlush = () => {
      if (flushHandle !== null) return;
      flushHandle = window.setTimeout(() => {
        flushHandle = null;
        void flushPending();
      }, 250);
    };

    const flushPending = async () => {
      const now = Date.now();
      for (const [componentId, entry] of pendingUpdates.entries()) {
        if (
          now - entry.enqueuedAt > PENDING_UPDATE_MAX_AGE_MS ||
          entry.attempts > PENDING_UPDATE_MAX_ATTEMPTS
        ) {
          pendingUpdates.delete(componentId);
          continue;
        }

        const registered = ComponentRegistry.get(componentId);
        if (!registered) {
          pendingUpdates.set(componentId, { ...entry, attempts: entry.attempts + 1 });
          continue;
        }

        pendingUpdates.delete(componentId);
        try {
          await applyLiveKitUpdate(entry.message, { allowQueue: false });
        } catch (error) {
          if (enableLogging) {
            logger.warn('pending update flush failed', { componentId, error });
          }
          pendingUpdates.set(componentId, { ...entry, attempts: entry.attempts + 1 });
        }
      }

      if (pendingUpdates.size > 0) scheduleFlush();
    };

    const applyLiveKitUpdate = async (message: unknown, opts: { allowQueue: boolean }) => {
      const parsedMessage = parseJsonObject(message);
      if (!parsedMessage) return;
      const componentId =
        typeof parsedMessage.componentId === 'string' && parsedMessage.componentId.trim().length
          ? parsedMessage.componentId.trim()
          : undefined;
      const patch = parseJsonObject(parsedMessage.patch);
      if (!componentId || !patch) return;

      const componentInfo = ComponentRegistry.get(componentId);
      const patchRecord = patch as Record<string, unknown>;
      const existingVersion =
        typeof componentInfo?.version === 'number' && Number.isFinite(componentInfo.version)
          ? componentInfo.version
          : 0;
      const patchVersionRaw = typeof patchRecord.version === 'number' ? patchRecord.version : undefined;
      const normalizedVersion =
        patchVersionRaw !== undefined && Number.isFinite(patchVersionRaw)
          ? Math.round(patchVersionRaw)
          : existingVersion + 1;
      patchRecord.version = normalizedVersion;
      const patchTimestamp =
        typeof patchRecord.lastUpdated === 'number'
          ? patchRecord.lastUpdated
          : typeof patchRecord.updatedAt === 'number'
            ? patchRecord.updatedAt
            : undefined;
      if (typeof patchRecord.lastUpdated !== 'number') {
        patchRecord.lastUpdated = patchTimestamp ?? Date.now();
      }
      const eventTimestamp = typeof parsedMessage.timestamp === 'number' ? parsedMessage.timestamp : Date.now();

      if (!componentInfo && opts.allowQueue) {
        const existing = pendingUpdates.get(componentId);
        pendingUpdates.set(componentId, {
          message,
          enqueuedAt: existing?.enqueuedAt ?? Date.now(),
          attempts: existing?.attempts ?? 0,
        });
        scheduleFlush();
        return;
      }

      let applied = false;
      try {
        const updateResult = await ComponentRegistry.update(componentId, patchRecord, {
          version: normalizedVersion,
          timestamp: patchTimestamp ?? eventTimestamp,
          source: 'livekit:update_component',
        });
        const wasIgnored = Boolean(
          updateResult &&
            typeof updateResult === 'object' &&
            'ignored' in updateResult &&
            (updateResult as { ignored?: boolean }).ignored,
        );

        if (!wasIgnored) {
          applied = true;
          const refreshed = ComponentRegistry.get(componentId);
          if (refreshed?.props && refreshed.componentType) {
            try {
              window.dispatchEvent(
                new CustomEvent('custom:showComponent', {
                  detail: {
                    messageId: componentId,
                    component: {
                      type: refreshed.componentType,
                      props: refreshed.props,
                    },
                  },
                }),
              );
            } catch (error) {
              if (enableLogging) {
                logger.warn('refresh showComponent dispatch failed', { componentId, error });
              }
            }
          }
        }
      } catch (error) {
        if (enableLogging) {
          logger.warn('registry update failed', { componentId, error });
        }
      }

      if (!applied) return;
      try {
        window.dispatchEvent(
          new CustomEvent('tldraw:merge_component_state', {
            detail: {
              messageId: componentId,
              patch: patchRecord,
              meta: { source: 'livekit:update_component', summary: parsedMessage.summary },
            },
          }),
        );
      } catch (error) {
        if (enableLogging) {
          logger.warn('merge_component_state dispatch failed', { componentId, error });
        }
      }
    };

    const off = bus.on('update_component', async (message: unknown) => {
      try {
        await applyLiveKitUpdate(message, { allowQueue: true });
      } catch (error) {
        if (enableLogging) {
          logger.warn('update_component handling error', { error });
        }
      }
    });

    return () => {
      off?.();
      pendingUpdates.clear();
      if (flushHandle !== null) {
        window.clearTimeout(flushHandle);
        flushHandle = null;
      }
    };
  }, [bus, enableLogging, logger]);

  const readNonEmptyString = (value: unknown): string | undefined => {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  };

  const readCallCorrelation = (call: ToolCall) => {
    const context =
      call.payload?.context && typeof call.payload.context === 'object'
        ? (call.payload.context as Record<string, unknown>)
        : {};
    const toolCallId =
      readNonEmptyString(context.tool_call_id) ??
      readNonEmptyString(context.toolCallId) ??
      call.id;
    const requestId = readNonEmptyString(context.request_id) ?? readNonEmptyString(context.requestId);
    const traceId =
      readNonEmptyString(context.trace_id) ??
      readNonEmptyString(context.traceId) ??
      requestId;
    const intentId =
      readNonEmptyString(context.intent_id) ??
      readNonEmptyString(context.intentId) ??
      requestId;
    const provider = readNonEmptyString(context.provider);
    const model = readNonEmptyString(context.model);
    const providerSource =
      readNonEmptyString(context.provider_source) ??
      readNonEmptyString(context.providerSource);
    const providerPath =
      readNonEmptyString(context.provider_path) ??
      readNonEmptyString(context.providerPath);
    const providerRequestId =
      readNonEmptyString(context.provider_request_id) ??
      readNonEmptyString(context.providerRequestId);

    return {
      toolCallId,
      requestId,
      traceId,
      intentId,
      provider,
      model,
      providerSource,
      providerPath,
      providerRequestId,
    };
  };

  const emitRequest = (call: ToolCall) => emit(TOOL_EVENT_TOPICS.request, { id: call.id, tool: call.payload.tool, timestamp: Date.now() });
  const emitStarted = (call: ToolCall) => emit(TOOL_EVENT_TOPICS.started, { id: call.id, tool: call.payload.tool, timestamp: Date.now() });
  const emitUpdate = (call: ToolCall, payload: unknown) => emit(TOOL_EVENT_TOPICS.update, { id: call.id, tool: call.payload.tool, timestamp: Date.now(), payload });
  const emitDone = (call: ToolCall, result: ToolRunResult) => {
    const correlation = readCallCorrelation(call);
    const status = readNonEmptyString(result?.status) ?? 'done';
    emit(TOOL_EVENT_TOPICS.done, {
      id: call.id,
      type: 'tool_result',
      tool: call.payload.tool,
      timestamp: Date.now(),
      result,
      payload: {
        tool: call.payload.tool,
        tool_call_id: correlation.toolCallId,
        request_id: correlation.requestId,
        trace_id: correlation.traceId,
        intent_id: correlation.intentId,
        provider: correlation.provider,
        model: correlation.model,
        provider_source: correlation.providerSource,
        provider_path: correlation.providerPath,
        provider_request_id: correlation.providerRequestId,
        status,
        result,
      },
    });
  };
  const emitError = (call: ToolCall, error: unknown) => {
    const correlation = readCallCorrelation(call);
    emit(TOOL_EVENT_TOPICS.error, {
      id: call.id,
      type: 'tool_error',
      tool: call.payload.tool,
      timestamp: Date.now(),
      error,
      payload: {
        tool: call.payload.tool,
        tool_call_id: correlation.toolCallId,
        request_id: correlation.requestId,
        trace_id: correlation.traceId,
        intent_id: correlation.intentId,
        provider: correlation.provider,
        model: correlation.model,
        provider_source: correlation.providerSource,
        provider_path: correlation.providerPath,
        provider_request_id: correlation.providerRequestId,
        status: 'error',
        error,
      },
    });
  };
  const emitEditorAction = (payload: Record<string, unknown>) => emit(TOOL_EVENT_TOPICS.editorAction, payload);
  const emitDecision = (payload: Record<string, unknown>) => emit(TOOL_EVENT_TOPICS.decision, payload);
  const emitStewardTrigger = (payload: StewardTriggerMessage['payload']) =>
    emit(TOOL_EVENT_TOPICS.stewardTrigger, {
      type: TOOL_EVENT_TOPICS.stewardTrigger,
      payload,
      timestamp: Date.now(),
    });

  return {
    emitRequest,
    emitStarted,
    emitUpdate,
    emitDone,
    emitError,
    emitEditorAction,
    emitDecision,
    emitStewardTrigger,
    log,
    bus,
  };
}
