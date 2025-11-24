"use client";

import { useEffect, useMemo } from 'react';
import type { Room } from 'livekit-client';
import { createLiveKitBus } from '@/lib/livekit/livekit-bus';
import { ComponentRegistry } from '@/lib/component-registry';
import { createObservabilityBridge } from '@/lib/observability-bridge';
import { TOOL_EVENT_TOPICS } from '../utils/constants';
import type { ToolRunResult, ToolCall } from '../utils/toolTypes';

export interface ToolEventsApi {
  emitRequest: (call: ToolCall) => void;
  emitStarted: (call: ToolCall) => void;
  emitUpdate: (call: ToolCall, payload: unknown) => void;
  emitDone: (call: ToolCall, result: ToolRunResult) => void;
  emitError: (call: ToolCall, error: unknown) => void;
  emitEditorAction: (payload: Record<string, unknown>) => void;
  emitDecision: (payload: Record<string, unknown>) => void;
  log: (...args: unknown[]) => void;
  bus: ReturnType<typeof createLiveKitBus>;
}

interface UseToolEventsOptions {
  enableLogging?: boolean;
}

export function useToolEvents(room: Room | undefined, options: UseToolEventsOptions = {}): ToolEventsApi {
  const { enableLogging = false } = options;

  const bus = useMemo(() => createLiveKitBus(room), [room]);

  useEffect(() => {
    if (!room) return;
    try {
      createObservabilityBridge(room);
    } catch (error) {
      if (enableLogging) {
        console.warn('[ToolDispatcher] observability bridge failed', error);
      }
    }
  }, [room, enableLogging]);

  const log = (...args: unknown[]) => {
    if (!enableLogging) return;
    try {
      console.log('[ToolDispatcher]', ...args);
    } catch {}
  };

  const emit = (topic: string, payload: Record<string, unknown>) => {
    try {
      bus.send(topic, payload);
    } catch (error) {
      if (enableLogging) {
        console.warn('[ToolDispatcher] failed to publish event', topic, error);
      }
    }
  };

  useEffect(() => {
    const off = bus.on('update_component', async (message: any) => {
      try {
        if (!message || typeof message !== 'object') return;
        const componentId =
          typeof message.componentId === 'string' && message.componentId.trim().length
            ? message.componentId.trim()
            : undefined;
        const patch = message.patch && typeof message.patch === 'object' ? message.patch : undefined;
        if (!componentId || !patch) return;

        const patchRecord = patch as Record<string, unknown>;
        const patchVersion =
          typeof patchRecord.version === 'number' ? patchRecord.version : undefined;
        const patchTimestamp =
          typeof patchRecord.lastUpdated === 'number'
            ? patchRecord.lastUpdated
            : typeof patchRecord.updatedAt === 'number'
              ? patchRecord.updatedAt
              : undefined;
        const eventTimestamp = typeof message.timestamp === 'number' ? message.timestamp : Date.now();

        try {
          const updateResult = await ComponentRegistry.update(componentId, patchRecord, {
            version: patchVersion ?? null,
            timestamp: patchTimestamp ?? eventTimestamp,
            source: 'livekit:update_component',
          });

          if (!updateResult?.ignored) {
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
                  console.warn('[ToolDispatcher] refresh showComponent dispatch failed', { componentId, error });
                }
              }
            }
          }
        } catch (error) {
          if (enableLogging) {
            console.warn('[ToolDispatcher] registry update failed', { componentId, error });
          }
        }

        try {
          window.dispatchEvent(
            new CustomEvent('tldraw:merge_component_state', {
              detail: {
                messageId: componentId,
                patch,
                meta: { source: 'livekit:update_component', summary: message.summary },
              },
            }),
          );
        } catch (error) {
          if (enableLogging) {
            console.warn('[ToolDispatcher] merge_component_state dispatch failed', { componentId, error });
          }
        }
      } catch (error) {
        if (enableLogging) {
          console.warn('[ToolDispatcher] update_component handling error', error);
        }
      }
    });

    return () => {
      off?.();
    };
  }, [bus, enableLogging]);

  const emitRequest = (call: ToolCall) => emit(TOOL_EVENT_TOPICS.request, { id: call.id, tool: call.payload.tool, timestamp: Date.now() });
  const emitStarted = (call: ToolCall) => emit(TOOL_EVENT_TOPICS.started, { id: call.id, tool: call.payload.tool, timestamp: Date.now() });
  const emitUpdate = (call: ToolCall, payload: unknown) => emit(TOOL_EVENT_TOPICS.update, { id: call.id, tool: call.payload.tool, timestamp: Date.now(), payload });
  const emitDone = (call: ToolCall, result: ToolRunResult) => emit(TOOL_EVENT_TOPICS.done, { id: call.id, tool: call.payload.tool, timestamp: Date.now(), result });
  const emitError = (call: ToolCall, error: unknown) => emit(TOOL_EVENT_TOPICS.error, { id: call.id, tool: call.payload.tool, timestamp: Date.now(), error });
  const emitEditorAction = (payload: Record<string, unknown>) => emit(TOOL_EVENT_TOPICS.editorAction, payload);
  const emitDecision = (payload: Record<string, unknown>) => emit(TOOL_EVENT_TOPICS.decision, payload);

  return {
    emitRequest,
    emitStarted,
    emitUpdate,
    emitDone,
    emitError,
    emitEditorAction,
    emitDecision,
    log,
    bus,
  };
}
