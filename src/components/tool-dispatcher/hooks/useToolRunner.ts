"use client";

import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { Room } from 'livekit-client';
import { useToolRegistry } from './useToolRegistry';
import { useToolQueue } from './useToolQueue';
import type { ToolCall, ToolParameters, ToolRunResult } from '../utils/toolTypes';
import { TOOL_STEWARD_DELAY_MS, TOOL_STEWARD_WINDOW_MS } from '../utils/constants';
import type { ToolEventsApi } from './useToolEvents';
import { ComponentRegistry } from '@/lib/component-registry';

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
  const queue = useToolQueue();
  const registry = useToolRegistry({ contextKey });
  const {
    emitRequest,
    emitDone,
    emitError,
    emitEditorAction,
    log,
    bus,
  } = events;

  const stewardPendingRef = useRef(false);
  const queuedRunRef = useRef<
    { room: string; docId: string; windowMs?: number; options?: { mode?: 'auto' | 'fast' | 'slow'; reason?: string } }
    | null
  >(null);
  const stewardWindowTimerRef = useRef<number | null>(null);
  const stewardDelayTimerRef = useRef<number | null>(null);
  const stewardCompleteRef = useRef<(() => void) | null>(null);
  const slowReleaseTimerRef = useRef<number | null>(null);

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
          const res = await fetch('/api/steward/run', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
          if (!res.ok) {
            let text = '';
            try {
              text = await res.text();
            } catch {}
            console.warn('[ToolDispatcher] steward run failed', { status: res.status, text });
            scheduleCompletion();
            return;
          }
          log('steward_run: dispatched', { status: res.status, mode: options?.mode ?? 'auto' });
          scheduleCompletion(windowMs);
        } catch (error) {
          console.warn('[ToolDispatcher] steward run error', error);
          scheduleCompletion();
        }
      })();
    },
    [stewardEnabled, log],
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
      const registry = (window as any).__custom_mcp_tools || {};
      let result: any = undefined;

      const direct = (registry as any)[toolName] || (registry as any)[`mcp_${toolName}`];
      if (direct) {
        try {
          result = typeof direct?.execute === 'function' ? await direct.execute(params) : await direct(params);
        } catch (error) {
          console.warn('[ToolDispatcher] direct MCP tool failed', toolName, error);
        }
      }

      if (!result) {
        result = await (window as any).callMcpTool?.(toolName, params);
      }

      if ((!result || result?.status === 'IGNORED') && toolName === 'exa') {
        const q = String((params as any)?.query || '').trim();
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
        console.log('[ToolDispatcher][mcp]', toolName, 'result:', JSON.stringify(result)?.slice(0, 2000));
      } catch {}

      if (toolName === 'exa') {
        try {
          const queryText = String((params as any)?.query || '').trim();
          const items = (result?.results || result?.items || result?.documents || []) as any[];
          const sourcesText = Array.isArray(items)
            ? items
                .slice(0, 3)
                .map((it: any) => it.title || it.url || it.snippet || it.text?.slice?.(0, 80))
                .filter(Boolean)
                .join('; ')
            : '';

          const list = ComponentRegistry.list();
          const latestScorecard = [...list]
            .filter((c) => c.componentType === 'DebateScorecard')
            .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))[0];
          if (latestScorecard) {
            const messageId = latestScorecard.messageId;
            const patch: Record<string, unknown> = {
              timeline: [
                {
                  type: 'search',
                  query: queryText,
                  sources: sourcesText,
                  timestamp: new Date().toISOString(),
                },
              ],
            };
            try {
              await ComponentRegistry.update(messageId, patch);
            } catch (error) {
              console.warn('[ToolDispatcher] exa-to-update_component synthesis failed', error);
            }
          }
        } catch (error) {
          console.warn('[ToolDispatcher] exa result reflection failed', error);
        }
      }

      return result ?? { status: 'IGNORED' };
    },
    [],
  );

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
        if (stewardEnabled) {
          const allowedNonCanvasTools = new Set([
            'create_component',
            'update_component',
            'list_components',
            'youtube_search',
            'dispatch_to_conductor',
          ]);
          const isCanvasTool = tool.startsWith('canvas_');
          if (!isCanvasTool && !allowedNonCanvasTools.has(tool)) {
            const message = `Unsupported tool in steward mode: ${tool}`;
            emitError(call, message);
            queue.markError(call.id, message);
            return { status: 'ERROR', message };
          }
        }

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

        if (tool === 'dispatch_to_conductor') {
          const task = typeof params?.task === 'string' ? params.task.trim() : '';
          const dispatchParams = (params?.params as Record<string, unknown>) || {};

          if (!task) {
            const message = 'dispatch_to_conductor requires a task value';
            queue.markError(call.id, message);
            emitError(call, message);
            return { status: 'ERROR', message };
          }

          if (stewardEnabled && task.startsWith('canvas.')) {
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
            }
            log('dispatch_to_conductor forwarding canvas task', { task, params: dispatchParams, room: call.roomId || room?.name });
            try {
              const res = await fetch('/api/steward/runCanvas', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  room: call.roomId || room?.name,
                  task,
                  params: dispatchParams,
                  summary: typeof params?.summary === 'string' ? params.summary : undefined,
                }),
              });
              if (!res.ok) {
                const message = `Canvas steward dispatch failed: HTTP ${res.status}`;
                queue.markError(call.id, message);
                emitError(call, message);
                return { status: 'ERROR', message };
              }
              const result = { status: 'SUCCESS', message: 'Dispatched canvas steward' } as ToolRunResult;
              queue.markComplete(call.id, result.message);
              emitDone(call, result);
              return result;
            } catch (error) {
              const message = `Canvas steward dispatch error: ${error instanceof Error ? error.message : String(error)}`;
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
          try {
            const mcpResult = await (window as any).callMcpTool?.('searchVideos', { query });
            const first = mcpResult?.videos?.[0] || mcpResult?.items?.[0] || null;
            const videoId = first?.id || first?.videoId || first?.video_id || null;
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
            console.warn('[ToolDispatcher] youtube_search MCP failed', error);
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
    [contextKey, dispatchTL, emitDone, emitError, emitRequest, emitEditorAction, log, queue, registry, runMcpTool, scheduleStewardRun, stewardEnabled],
  );

  useEffect(() => {
    const offTool = bus.on('tool_call', (message: any) => {
      try {
        if (!message || message.type !== 'tool_call') return;
        const tool = message.payload?.tool;
        const params = message.payload?.params || {};
        log('received tool_call from data channel:', tool, params);
        void executeToolCall({
          id: message.id || `${Date.now()}`,
          type: 'tool_call',
          payload: { tool, params },
          timestamp: message.timestamp || Date.now(),
          source: 'dispatcher',
          roomId: message.roomId,
        } as ToolCall);
      } catch (error) {
        console.error('[ToolDispatcher] failed handling tool_call', error);
      }
    });

    const offDecision = bus.on('decision', async (message: any) => {
      try {
        if (!message || message.type !== 'decision') return;
        const decision = message.payload?.decision || {};
        const originalText: string = message.payload?.originalText || '';
        log('received decision from data channel:', decision);

        const rawSummary = typeof decision.summary === 'string' ? decision.summary : '';
        const summary: string = String(rawSummary || originalText || '').toLowerCase();
        const globalAny = window as any;

        if (stewardEnabled) {
          const stewardSummary = rawSummary.trim();
          // TODO: voice agent should emit explicit decision summaries for each steward instead of legacy fallback values.
          if (decision.should_send && stewardSummary === 'steward_trigger') {
            try {
              globalAny.__present_steward_active = true;
            } catch {}
            const roomName = (typeof message.roomId === 'string' && message.roomId) || room?.name || '';
            let existingDocId =
              typeof globalAny.__present_mermaid_last_shape_id === 'string'
                ? globalAny.__present_mermaid_last_shape_id
                : '';

            // Fallback: if the global tracker is missing (e.g. after reload), recover the latest mermaid shape
            if (!existingDocId) {
              try {
                const editor = globalAny.__present?.tldrawEditor;
                const shapes = editor?.getCurrentPageShapes?.() ?? [];
                for (let i = shapes.length - 1; i >= 0; i -= 1) {
                  const shape = shapes[i];
                  if (shape?.type === 'mermaid_stream' && typeof shape?.id === 'string') {
                    existingDocId = shape.id;
                    globalAny.__present_mermaid_last_shape_id = shape.id;
                    break;
                  }
                }
              } catch (err) {
                log('steward_run: failed to recover existing mermaid shape', err);
              }
            }

            log('steward trigger decision received', {
              room: roomName || 'unknown',
              docId: existingDocId || 'pending',
            });
            if (!existingDocId) {
              log('steward trigger creating mermaid stream shape');
              await executeToolCall({
                id: message.id || `${Date.now()}`,
                type: 'tool_call',
                payload: { tool: 'canvas_create_mermaid_stream', params: { text: 'graph TD;\nA-->B;' } },
                timestamp: Date.now(),
                source: 'dispatcher',
                roomId: message.roomId,
              } as ToolCall);
            }
            const docId =
              typeof globalAny.__present_mermaid_last_shape_id === 'string'
                ? globalAny.__present_mermaid_last_shape_id
                : '';
            if (roomName) {
              if (docId) {
                scheduleStewardRun(roomName, docId);
              } else {
                window.setTimeout(() => {
                  try {
                    const fallbackId = String((window as any).__present_mermaid_last_shape_id || '');
                    if (fallbackId) {
                      scheduleStewardRun(roomName, fallbackId);
                    }
                  } catch {}
                }, 150);
              }
            }
            return;
          }
          if (decision.should_send && stewardSummary === 'steward_trigger_canvas') {
            // TODO: Replace this heuristic-based steward trigger with an LLM-driven routing signal.
            const roomName = (typeof message.roomId === 'string' && message.roomId) || room?.name || '';
            if (!roomName) {
              log('canvas steward trigger ignored: missing room');
              return;
            }
            const intentSummary = typeof originalText === 'string' && originalText.trim() ? originalText.trim() : summary;
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
              const res = await fetch('/api/steward/runCanvas', {
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
            id: message.id || `${Date.now()}`,
            type: 'tool_call',
            payload: {
              tool: 'create_component',
              params: { type: 'RetroTimerEnhanced', initialMinutes: minutes },
            },
            timestamp: Date.now(),
            source: 'dispatcher',
            roomId: message.roomId,
          } as ToolCall);
          return;
        }

        const isWeather = /\bweather\b|\bforecast\b/.test(summary);
        const wantsMermaid = /\bmermaid\b|\bflow\s*chart\b|\bdiagram\b/.test(summary);
        const lastShapeId = globalAny.__present_mermaid_last_shape_id as string | undefined;
        const session = (globalAny.__present_mermaid_session || {}) as { last?: string; text?: string };
        const stewardActive = !!globalAny.__present_steward_active;
        const isDiagramFollowup = /\bdiagram\b|\bflow\s*chart\b|\bitinerary\b|\bmap out\b|\bprocess\b|\bsteps?\b/i.test(
          originalText || summary,
        );
        if (!stewardActive && lastShapeId && (isDiagramFollowup || wantsMermaid)) {
          const sanitize = (s: string) =>
            s
              .toLowerCase()
              .replace(/[^a-z0-9\s_-]/g, '')
              .trim()
              .split(/\s+/)
              .slice(0, 5)
              .join('_') || `step_${Date.now().toString(36)}`;
          const current = session.text && typeof session.text === 'string' ? session.text : 'graph TD;';
          const last = session.last && typeof session.last === 'string' ? session.last : 'Start';
          const next = sanitize(originalText || summary);
          const line = `${last}-->${next}`;
          const merged = current.includes('graph') ? `${current} ${line};` : `graph TD; ${line};`;
          globalAny.__present_mermaid_session = { last: next, text: merged };
          await executeToolCall({
            id: message.id || `${Date.now()}`,
            type: 'tool_call',
            payload: { tool: 'canvas_update_mermaid_stream', params: { shapeId: lastShapeId, text: merged } },
            timestamp: Date.now(),
            source: 'dispatcher',
            roomId: message.roomId,
          } as ToolCall);
          return;
        }
        if (!stewardActive && decision.should_send && wantsMermaid && !lastShapeId) {
          log('synthesizing mermaid stream shape');
          await executeToolCall({
            id: message.id || `${Date.now()}`,
            type: 'tool_call',
            payload: { tool: 'canvas_create_mermaid_stream', params: { text: 'graph TD; A-->B' } },
            timestamp: Date.now(),
            source: 'dispatcher',
            roomId: message.roomId,
          } as ToolCall);
          return;
        }
        if (decision.should_send && isWeather) {
          const locMatch = /\b(?:in|for)\s+([^.,!?]+)\b/.exec(String(decision.summary || originalText));
          const location = locMatch ? locMatch[1].replace(/\s+on the canvas\b/i, '').trim() : undefined;
          log('synthesizing weather component', { location });
          await executeToolCall({
            id: message.id || `${Date.now()}`,
            type: 'tool_call',
            payload: {
              tool: 'create_component',
              params: { type: 'WeatherForecast', location },
            },
            timestamp: Date.now(),
            source: 'dispatcher',
            roomId: message.roomId,
          } as ToolCall);
        }
      } catch (error) {
        console.error('[ToolDispatcher] failed handling decision', error);
      }
    });

    return () => {
      offTool();
      offDecision();
    };
  }, [bus, executeToolCall, log, room, scheduleStewardRun, stewardEnabled]);

  useEffect(() => {
    if (!stewardEnabled) return;
    const fallbackDebounce = new Map<string, number>();
    const resolveRoomNameFromWindow = (): string | undefined => {
      if (typeof window === 'undefined') return undefined;
      const globalAny = window as any;
      const candidate: unknown =
        globalAny?.__present?.livekitRoomName ??
        globalAny?.__present_roomName ??
        globalAny?.__present_canvas_room;
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
              console.warn('[ToolDispatcher] failed to flush steward pending state after fallback', err);
            }
          }, 1500);
        }
      } catch (error) {
        console.warn('[ToolDispatcher] failed to process flowchart fallback event', error);
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
  }, [log, room, stewardEnabled, triggerStewardRun]);

  useEffect(() => {
    const globalAny = window as any;
    globalAny.__custom_tool_dispatcher = {
      executeMCPTool: async (tool: string, params: any) => {
        return executeToolCall({
          id: crypto.randomUUID?.() || String(Date.now()),
          type: 'tool_call',
          payload: { tool, params },
          timestamp: Date.now(),
          source: 'bridge',
        } as ToolCall);
      },
    };

    return () => {
      if (globalAny.__custom_tool_dispatcher?.executeMCPTool) {
        delete globalAny.__custom_tool_dispatcher;
      }
    };
  }, [executeToolCall]);

  return useMemo(() => ({ executeToolCall, queue }), [executeToolCall, queue]);
}

function parseMinutesFromText(text: string): number | undefined {
  const match = text.match(/\b(?:for\s+)?(\d{1,3})\s*(?:minute|minutes|mins|min|m)\b/);
  if (!match) return undefined;
  return Number(match[1]);
}
