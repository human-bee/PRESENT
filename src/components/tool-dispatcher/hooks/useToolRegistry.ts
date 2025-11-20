"use client";

import { useMemo } from 'react';
import { ComponentRegistry } from '@/lib/component-registry';
import type { ToolCall, ToolParameters, ToolRunResult } from '../utils/toolTypes';
import { getMermaidLastNode, normalizeMermaidText } from '../utils';

const TIMER_COMPONENT_TYPES = new Set(['RetroTimerEnhanced', 'RetroTimer']);

export interface ToolRegistryMetrics {
  associateCallWithMessage?: (callId: string, messageId: string, meta: { tool: string; componentType?: string }) => void;
  markPaintForMessage?: (messageId: string, meta: { tool: string; componentType?: string }) => void;
}

export interface ToolRegistryDeps {
  contextKey?: string;
  metrics?: ToolRegistryMetrics;
}

export interface ToolHandlerContext {
  call: ToolCall;
  params: ToolParameters;
  dispatchTL: (eventName: string, detail?: unknown) => ToolRunResult;
  scheduleStewardRun: (roomName: string, docId: string) => void;
  stewardEnabled: boolean;
  emitEditorAction: (payload: Record<string, unknown>) => void;
}

export type ToolHandler = (context: ToolHandlerContext) => Promise<ToolRunResult | undefined>;

export interface ToolRegistryApi {
  getHandler: (tool: string) => ToolHandler | undefined;
  listTools: () => string[];
}

export function useToolRegistry(deps: ToolRegistryDeps): ToolRegistryApi {
  const { contextKey, metrics } = deps;

  const handlers = useMemo(() => {
    const map = new Map<string, ToolHandler>();
    const pendingUpdates = new Map<string, { patch: Record<string, unknown> }>();
    let frameHandle: number | null = null;
    let lastDispatch: ((eventName: string, detail?: unknown) => ToolRunResult) | null = null;
    type LedgerEntry = {
      intentId: string;
      messageId: string;
      componentType: string;
      slot?: string;
      updatedAt: number;
      state: 'reserved' | 'created' | 'updated';
    };
    const intentLedger = new Map<string, LedgerEntry>();
    const slotLedger = new Map<string, string>();
    const messageLedger = new Map<string, string>();
    const LEDGER_TTL_MS = 5 * 60 * 1000;

    const cleanupLedger = () => {
      const now = Date.now();
      for (const [intentId, entry] of intentLedger.entries()) {
        if (now - entry.updatedAt > LEDGER_TTL_MS) {
          intentLedger.delete(intentId);
          if (entry.slot) {
            const currentIntent = slotLedger.get(entry.slot);
            if (currentIntent === intentId) {
              slotLedger.delete(entry.slot);
            }
          }
          const mappedIntent = messageLedger.get(entry.messageId);
          if (mappedIntent === intentId) {
            messageLedger.delete(entry.messageId);
          }
        }
      }
    };

    const registerLedgerEntry = (entry: {
      intentId: string;
      messageId: string;
      componentType: string;
      slot?: string;
      state?: LedgerEntry['state'];
    }) => {
      const now = Date.now();
      const existing = intentLedger.get(entry.intentId);
      const next: LedgerEntry = {
        intentId: entry.intentId,
        messageId: entry.messageId,
        componentType: entry.componentType,
        slot: entry.slot ?? existing?.slot,
        updatedAt: now,
        state: entry.state ?? existing?.state ?? 'reserved',
      };
      if (entry.slot) {
        next.slot = entry.slot;
      }
      intentLedger.set(next.intentId, next);
      messageLedger.set(next.messageId, next.intentId);
      if (next.slot) {
        slotLedger.set(next.slot, next.intentId);
      }
      cleanupLedger();
      return next;
    };

    const resolveLedgerMessageId = (params: ToolParameters): string | null => {
      const components = ComponentRegistry.list();
      const rawId = typeof params?.componentId === 'string' ? params.componentId.trim() : '';
      if (rawId) {
        return rawId;
      }
      const rawIntent = typeof params?.intentId === 'string' ? params.intentId.trim() : '';
      if (rawIntent) {
        const entry = intentLedger.get(rawIntent);
        if (entry) {
          return entry.messageId;
        }
        const existing = components.find((c) => c.messageId && (c as any).intentId === rawIntent);
        if (existing) {
          return existing.messageId;
        }
      }
      const rawSlot = typeof params?.slot === 'string' ? params.slot.trim() : '';
      if (rawSlot) {
        const intentFromSlot = slotLedger.get(rawSlot);
        if (intentFromSlot) {
          const entry = intentLedger.get(intentFromSlot);
          if (entry) {
            return entry.messageId;
          }
        }
        const existing = components.find((c) => (c as any).slot === rawSlot);
        if (existing) {
          return existing.messageId;
        }
      }
      const rawType =
        typeof params?.type === 'string'
          ? params.type.trim()
          : typeof (params as any)?.componentType === 'string'
            ? String((params as any).componentType).trim()
            : '';
      if (rawType) {
        const byType = components.find((c) => c.componentType === rawType);
        if (byType) {
          return byType.messageId;
        }
      }
      const last = components.slice(-1)[0];
      return last ? last.messageId : null;
    };

    const flushPending = () => {
      if (!lastDispatch) {
        pendingUpdates.clear();
        return;
      }
      const dispatch = lastDispatch;
      for (const [messageId, entry] of pendingUpdates.entries()) {
        pendingUpdates.delete(messageId);
      const componentInfo = ComponentRegistry.get(messageId);
      const patchRecord = entry.patch;
      const patchVersion =
        typeof patchRecord.version === 'number' ? patchRecord.version : undefined;
      const patchTimestamp =
        typeof patchRecord.lastUpdated === 'number'
          ? patchRecord.lastUpdated
          : typeof patchRecord.updatedAt === 'number'
            ? patchRecord.updatedAt
            : undefined;
      dispatch('tldraw:merge_component_state', {
        messageId,
        patch: patchRecord,
        meta: { source: 'update_component' },
      });
      void ComponentRegistry.update(messageId, patchRecord, {
        version: patchVersion ?? null,
        timestamp: patchTimestamp ?? Date.now(),
        source: 'tool:update_component',
      })
        .then((result) => {
          const refreshedInfo = ComponentRegistry.get(messageId);
          if (!result?.ignored && refreshedInfo?.props && refreshedInfo.componentType) {
            try {
              window.dispatchEvent(
                new CustomEvent('custom:showComponent', {
                  detail: {
                    messageId,
                    component: {
                      type: refreshedInfo.componentType,
                      props: refreshedInfo.props,
                    },
                    contextKey,
                  },
                }),
              );
            } catch {
              /* noop */
            }
          }
          metrics?.markPaintForMessage?.(messageId, {
            tool: 'update_component',
            componentType: refreshedInfo?.componentType ?? componentInfo?.componentType,
          });
        })
        .catch(() => {
          metrics?.markPaintForMessage?.(messageId, {
            tool: 'update_component',
            componentType: componentInfo?.componentType,
          });
        });
      }
    };

    const scheduleFlush = (dispatchTL: (eventName: string, detail?: unknown) => ToolRunResult) => {
      lastDispatch = dispatchTL;
      if (frameHandle !== null) return;
      frameHandle = window.requestAnimationFrame(() => {
        frameHandle = null;
        flushPending();
      });
    };

    // Legacy canvas_* tools removed for unified Canvas Agent

    map.set('list_components', async () => {
      const components = ComponentRegistry.list(contextKey);
      return { status: 'SUCCESS', components };
    });

    map.set('reserve_component', async ({ params, call }) => {
      const componentType =
        typeof params?.componentType === 'string'
          ? params.componentType.trim()
          : typeof params?.type === 'string'
            ? params.type.trim()
            : '';
      const messageId =
        typeof params?.messageId === 'string'
          ? params.messageId.trim()
          : typeof params?.componentId === 'string'
            ? params.componentId.trim()
            : '';
      const intentId = typeof params?.intentId === 'string' ? params.intentId.trim() : '';
      const slot = typeof params?.slot === 'string' ? params.slot.trim() : undefined;
      if (!componentType || !messageId || !intentId) {
        return { status: 'ERROR', message: 'reserve_component requires componentType, intentId, and messageId' };
      }

      registerLedgerEntry({
        intentId,
        messageId,
        componentType,
        slot,
        state: (params as any)?.state === 'created' ? 'created' : 'reserved',
      });
      metrics?.associateCallWithMessage?.(call.id, messageId, { tool: 'reserve_component', componentType });
      return { status: 'SUCCESS', intentId, messageId };
    });

    map.set('create_component', async ({ params, emitEditorAction, call }) => {
      const componentType = String(params?.type ?? '').trim();
      const messageId = String(params?.messageId || params?.componentId || '') || `ui-${Date.now().toString(36)}`;
      const intentId = typeof params?.intentId === 'string' ? params.intentId.trim() : undefined;
      const slot = typeof params?.slot === 'string' ? params.slot.trim() : undefined;

      try {
        const { spec, props, ...rest } = (params || {}) as Record<string, unknown>;
        let normalizedProps: Record<string, unknown> = { ...rest };
        if (spec && typeof spec === 'string') {
          try {
            const parsedSpec = JSON.parse(spec as string);
            if (parsedSpec && typeof parsedSpec === 'object') {
              normalizedProps = { ...normalizedProps, ...parsedSpec };
            }
          } catch {
            normalizedProps.spec = spec;
          }
        } else if (spec && typeof spec === 'object') {
          normalizedProps = { ...normalizedProps, ...(spec as Record<string, unknown>) };
        }
        if (props && typeof props === 'object') {
          normalizedProps = { ...normalizedProps, ...(props as Record<string, unknown>) };
        }
        normalizedProps = Object.fromEntries(
          Object.entries(normalizedProps).filter(([, value]) => value !== undefined && value !== null),
        );
        normalizedProps.type = componentType;
        normalizedProps.messageId = messageId;
        if (!('__custom_message_id' in normalizedProps)) {
          normalizedProps.__custom_message_id = messageId;
        }
        if (!('componentId' in normalizedProps)) {
          normalizedProps.componentId = messageId;
        }

        const payloadProps: Record<string, unknown> = {
          ...rest,
          type: componentType,
          messageId,
        };
        if (spec !== undefined) {
          payloadProps.spec = spec;
        }
        if (props !== undefined) {
          payloadProps.props = props;
        }

        window.dispatchEvent(
          new CustomEvent('custom:showComponent', {
            detail: {
              messageId,
              component: {
                type: componentType,
                props: normalizedProps,
              },
              contextKey,
            },
          }),
        );
        emitEditorAction({ type: 'create_component', componentType, messageId });
        const resolvedIntentId = intentId || messageLedger.get(messageId) || undefined;
        const priorEntry = resolvedIntentId ? intentLedger.get(resolvedIntentId) : undefined;
        if (resolvedIntentId) {
          registerLedgerEntry({
            intentId: resolvedIntentId,
            messageId,
            componentType: priorEntry?.componentType ?? componentType,
            slot: slot ?? priorEntry?.slot,
            state: 'created',
          });
        }
        metrics?.associateCallWithMessage?.(call.id, messageId, { tool: 'create_component', componentType });
        metrics?.markPaintForMessage?.(messageId, { tool: 'create_component', componentType });
        return { status: 'SUCCESS', message: `Rendered ${componentType}`, messageId };
      } catch (error) {
        return { status: 'ERROR', message: error instanceof Error ? error.message : String(error) };
      }
    });

    map.set('update_component', async ({ params, dispatchTL, call }) => {
      const messageId = String(params?.componentId || params?.messageId || '');
      const patch = params?.patch;
      if (!messageId) {
        return { status: 'ERROR', message: 'update_component requires componentId' };
      }
      const componentInfo = ComponentRegistry.get(messageId);
      metrics?.associateCallWithMessage?.(call.id, messageId, {
        tool: 'update_component',
        componentType:
          componentInfo?.componentType ||
          (typeof params?.type === 'string' && params.type.trim().length > 0 ? params.type.trim() : undefined),
      });

      let nextPatch: Record<string, unknown>;
      if (typeof patch === 'string') {
        try {
          const parsed = JSON.parse(patch);
          nextPatch = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : { instruction: patch };
        } catch {
          nextPatch = { instruction: patch };
        }
      } else {
        nextPatch = (patch as Record<string, unknown> | undefined) ?? {};
      }
      const runtimePatch: Record<string, unknown> = { ...nextPatch };
      const timestamp = Date.now();
      if (typeof runtimePatch.updatedAt !== 'number') {
        runtimePatch.updatedAt = timestamp;
      }
      const coerceFiniteSeconds = (value: unknown): number | undefined => {
        if (typeof value === 'number' && Number.isFinite(value)) {
          return Math.max(1, Math.round(value));
        }
        if (typeof value === 'string') {
          const trimmed = value.trim();
          if (!trimmed) return undefined;
          const minutesMatch = trimmed.match(/^(\d+)(m|min)$/i);
          if (minutesMatch) {
            return Math.max(1, Math.round(Number(minutesMatch[1]) * 60));
          }
          const secondsMatch = trimmed.match(/^(\d+)(s|sec|secs|second|seconds)$/i);
          if (secondsMatch) {
            return Math.max(1, Math.round(Number(secondsMatch[1])));
          }
          const parsed = Number.parseFloat(trimmed);
          if (Number.isFinite(parsed)) {
            return Math.max(1, Math.round(parsed));
          }
        }
        return undefined;
      };

      const normalizedDuration = coerceFiniteSeconds(runtimePatch.duration);
      if (normalizedDuration !== undefined) {
        const durationSeconds = normalizedDuration;
        const minutes = Math.floor(durationSeconds / 60);
        const seconds = durationSeconds % 60;
        runtimePatch.configuredDuration = durationSeconds;
        if (typeof runtimePatch.timeLeft !== 'number') {
          runtimePatch.timeLeft = durationSeconds;
        }
        runtimePatch.initialMinutes = minutes;
        runtimePatch.initialSeconds = seconds;
        delete runtimePatch.duration;
      } else if (typeof runtimePatch.duration === 'string') {
        delete runtimePatch.duration;
      }

      const normalizedDurationSeconds = coerceFiniteSeconds(runtimePatch.durationSeconds);
      if (normalizedDurationSeconds !== undefined) {
        const durationSeconds = normalizedDurationSeconds;
        const minutes = Math.floor(durationSeconds / 60);
        const seconds = durationSeconds % 60;
        runtimePatch.configuredDuration = durationSeconds;
        if (typeof runtimePatch.timeLeft !== 'number') {
          runtimePatch.timeLeft = durationSeconds;
        }
        runtimePatch.initialMinutes = minutes;
        runtimePatch.initialSeconds = seconds;
      } else if (typeof runtimePatch.durationSeconds === 'string') {
        delete runtimePatch.durationSeconds;
      }
      if (
        typeof runtimePatch.initialMinutes === 'number' &&
        typeof runtimePatch.initialSeconds === 'number'
      ) {
        const minutes = Math.max(1, Math.round(runtimePatch.initialMinutes as number));
        const seconds = Math.max(0, Math.min(59, Math.round(runtimePatch.initialSeconds as number)));
        const durationSeconds = minutes * 60 + seconds;
        runtimePatch.configuredDuration = durationSeconds;
        if (typeof runtimePatch.timeLeft !== 'number') {
          runtimePatch.timeLeft = durationSeconds;
        }
        runtimePatch.initialMinutes = minutes;
        runtimePatch.initialSeconds = seconds;
      }
      const existing = pendingUpdates.get(messageId);
      const combined = existing ? { ...existing.patch, ...runtimePatch } : runtimePatch;

      const componentTypeHint =
        componentInfo?.componentType ||
        (typeof params?.type === 'string' && params.type.trim().length > 0 ? params.type.trim() : undefined);
      const isTimerComponent = componentTypeHint ? TIMER_COMPONENT_TYPES.has(componentTypeHint) : false;

      const normalizeBoolean = (value: unknown): boolean | undefined => {
        if (typeof value === 'boolean') return value;
        if (typeof value === 'number') {
          if (value === 1) return true;
          if (value === 0) return false;
        }
        if (typeof value === 'string') {
          const normalized = value.trim().toLowerCase();
          if (!normalized) return undefined;
          if (['true', 'yes', 'start', 'started', 'run', 'running', 'resume', 'play', 'on', '1'].includes(normalized)) {
            return true;
          }
          if (['false', 'no', 'stop', 'stopped', 'pause', 'paused', 'halt', 'off', '0', 'finished'].includes(normalized)) {
            return false;
          }
        }
        return undefined;
      };

      if (isTimerComponent && typeof combined.state === 'string') {
        const normalizedState = combined.state.trim().toLowerCase();
        const markRunning = () => {
          combined.isRunning = true;
          combined.isFinished = false;
          if (typeof combined.timeLeft !== 'number' || combined.timeLeft <= 0) {
            const configured =
              typeof combined.configuredDuration === 'number' && Number.isFinite(combined.configuredDuration)
                ? (combined.configuredDuration as number)
                : (componentInfo?.props?.configuredDuration as number | undefined);
            if (typeof configured === 'number' && Number.isFinite(configured)) {
              combined.timeLeft = Math.max(1, Math.round(configured));
            }
          }
        };
        const markStopped = (finished: boolean) => {
          combined.isRunning = false;
          if (finished) {
            combined.isFinished = true;
            if (typeof combined.timeLeft !== 'number' || combined.timeLeft < 0) {
              combined.timeLeft = 0;
            }
          }
        };
        if (
          ['run', 'running', 'start', 'started', 'resume', 'resumed', 'play', 'playing', 'active'].includes(
            normalizedState,
          )
        ) {
          markRunning();
        } else if (
          ['paused', 'pause', 'stop', 'stopped', 'halt', 'idle', 'ready', 'standby'].includes(normalizedState)
        ) {
          markStopped(false);
        } else if (
          ['finished', 'complete', 'completed', 'done', 'expired', "time's up", 'time up', 'timeup'].includes(
            normalizedState,
          )
        ) {
          markStopped(true);
        }
        delete combined.state;
      }

      const statusValue = normalizeBoolean(combined.status);
      if (combined.isRunning === undefined && statusValue !== undefined) {
        combined.isRunning = statusValue;
      }
      if (combined.isRunning === true) {
        combined.isFinished = false;
      }
      if (combined.status !== undefined) {
        delete combined.status;
      }

      if (combined.isRunning === true && typeof combined.updatedAt !== 'number') {
        combined.updatedAt = timestamp;
      }
      if (combined.isRunning === true && typeof combined.timeLeft !== 'number') {
        const configured =
          typeof combined.configuredDuration === 'number' && Number.isFinite(combined.configuredDuration)
            ? (combined.configuredDuration as number)
            : (componentInfo?.props?.configuredDuration as number | undefined);
        if (typeof configured === 'number' && Number.isFinite(configured)) {
          combined.timeLeft = Math.max(0, Math.round(configured));
        }
      }

      pendingUpdates.set(messageId, { patch: combined });
      scheduleFlush(dispatchTL);
      const explicitIntent = typeof params?.intentId === 'string' && params.intentId.trim().length > 0 ? params.intentId.trim() : undefined;
      const ledgerIntentId = explicitIntent || messageLedger.get(messageId);
      const ledgerEntry = ledgerIntentId ? intentLedger.get(ledgerIntentId) : undefined;
      const resolvedSlot =
        typeof params?.slot === 'string' && params.slot.trim().length > 0 ? params.slot.trim() : ledgerEntry?.slot;
      const resolvedComponentType =
        typeof params?.type === 'string' && params.type.trim().length > 0
          ? params.type.trim()
          : ledgerEntry?.componentType || 'unknown';
      if (ledgerIntentId) {
        registerLedgerEntry({
          intentId: ledgerIntentId,
          messageId,
          componentType: resolvedComponentType,
          slot: resolvedSlot,
          state: 'updated',
        });
      }

      return { status: 'SUCCESS', message: 'Component update queued' };
    });
    map.set('resolve_component', async ({ params }) => {
      const resolved = resolveLedgerMessageId(params || {});
      if (!resolved) {
        return { status: 'NOT_FOUND', message: 'No component matched the provided hints' };
      }
      return { status: 'SUCCESS', componentId: resolved };
    });

    map.set('mermaid_create_stream', async ({ params, dispatchTL }) => {
      const text = typeof params?.text === 'string' ? params.text : 'graph TD; A-->B;';
      const normalized = normalizeMermaidText(text);
      const result = dispatchTL('tldraw:create_mermaid_stream', { text: normalized });
      return { ...result, normalized }; // merge status+message from dispatch
    });

    map.set('mermaid_update_stream', async ({ params, dispatchTL }) => {
      const shapeId = typeof params?.shapeId === 'string' ? params.shapeId : undefined;
      if (!shapeId) {
        return { status: 'ERROR', message: 'Missing shapeId' };
      }
      const text = normalizeMermaidText(String(params?.text || ''));
      const lastNode = getMermaidLastNode(text);
      dispatchTL('tldraw:update_mermaid_stream', { shapeId, text });
      return { status: 'SUCCESS', shapeId, lastNode };
    });

    map.set('canvas_list_shapes', async ({ call, emitEditorAction }) => {
      window.dispatchEvent(
        new CustomEvent('tldraw:listShapes', { detail: { callId: call.id } }),
      );
      emitEditorAction({ type: 'canvas_command', command: 'tldraw:listShapes', callId: call.id });
      return { status: 'ACK', message: 'Listing shapes' };
    });

    return map;
  }, [contextKey, metrics]);

  return {
    getHandler: (tool: string) => handlers.get(tool),
    listTools: () => Array.from(handlers.keys()),
  };
}
