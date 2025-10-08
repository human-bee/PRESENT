/**
 * ToolDispatcher
 *
 * Minimal first-principles dispatcher that exposes a context + hook
 * and handles a small set of tool calls needed by the UI.
 *
 * Responsibilities now:
 * - Provide `useToolDispatcher()` with `executeToolCall` function
 * - For `create_component`, dispatch a browser event that the
 *   thread UI listens to (custom:showComponent)
 * - Optionally expose a global bridge used by the MCP layer
 *
 * TODO Modularization Map (Wave 2)
 * - Tool metadata/config registration, discovery → `useToolRegistry` hook + `toolTypes`/`constants` utils.
 * - LiveKit bus subscription + browser event wiring → `useToolEvents` hook with typed topics.
 * - Queueing, dedupe, cancellation logic → `useToolQueue` hook exposing reducer-driven state.
 * - Execution lifecycle, logging, timeout management → `useToolRunner` hook using typed job states.
 * - Presentational UI (lists, cards, logs) → extracted `ToolList`, `JobCard`, `JobLog` components.
 * - Result/response normalization, error shaping → `resultNormalizers` + `errorMap` utils.
 * - Context provider orchestrating hooks and exposing API → slim `tool-dispatcher.tsx` orchestrator.
 */

'use client';

import * as React from 'react';
import { useRoomContext } from '@livekit/components-react';
import { createLiveKitBus } from '@/lib/livekit/livekit-bus';
import { createObservabilityBridge } from '@/lib/observability-bridge';
import { ComponentRegistry } from '@/lib/component-registry';

type ToolCall = {
  id: string;
  roomId?: string;
  type: 'tool_call';
  payload: { tool: string; params?: Record<string, unknown> };
  timestamp?: number;
  source?: string;
};

type DispatcherContext = {
  executeToolCall: (call: ToolCall) => Promise<{ status: string; message?: string }>;
};

const Ctx = React.createContext<DispatcherContext | null>(null);

export function useToolDispatcher(): DispatcherContext {
  const ctx = React.useContext(Ctx);
  if (!ctx) throw new Error('useToolDispatcher must be used within ToolDispatcher');
  return ctx;
}

export function ToolDispatcher({
  children,
  contextKey,
  enableLogging = false,
}: {
  children: React.ReactNode;
  contextKey?: string;
  enableLogging?: boolean;
}) {
  const log = (...args: any[]) => {
    try {
      if (enableLogging) console.log('[ToolDispatcher]', ...args);
    } catch {}
  };
  const STEWARD_FLOWCHART =
    typeof process !== 'undefined' && process.env.NEXT_PUBLIC_STEWARD_FLOWCHART_ENABLED === 'true';
  const room = useRoomContext();
  const bus = React.useMemo(() => createLiveKitBus(room), [room]);
  const stewardPendingRef = React.useRef(false);
  const queuedRunRef = React.useRef<{ room: string; docId: string; windowMs?: number } | null>(null);
  const stewardWindowTimerRef = React.useRef<number | null>(null);
  const stewardDelayTimerRef = React.useRef<number | null>(null);

  const triggerStewardRun = React.useCallback(
    (roomName: string, docId: string, windowMs = 60000) => {
      if (!STEWARD_FLOWCHART) return;
      const normalizedRoom = roomName.trim();
      const normalizedDoc = docId.trim();
      if (!normalizedRoom || !normalizedDoc) return;

      if (stewardPendingRef.current) {
        queuedRunRef.current = { room: normalizedRoom, docId: normalizedDoc, windowMs };
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
          triggerStewardRun(queued.room, queued.docId, queued.windowMs);
        }
      };

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

      log('steward_run: starting', { room: normalizedRoom, docId: normalizedDoc, windowMs });
      const run = async () => {
        try {
          log('steward_run: posting /api/steward/run', { room: normalizedRoom, docId: normalizedDoc, windowMs });
          const res = await fetch('/api/steward/run', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ room: normalizedRoom, docId: normalizedDoc, windowMs }),
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
          log('steward_run: dispatched', { status: res.status });
          scheduleCompletion(windowMs);
        } catch (err) {
          console.warn('[ToolDispatcher] steward run error', err);
          scheduleCompletion();
        }
      };

      void run();
    },
    [STEWARD_FLOWCHART, log],
  );

  const scheduleStewardRun = React.useCallback(
    (roomName?: string | null, docId?: string | null) => {
      if (!STEWARD_FLOWCHART) return;
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
        triggerStewardRun(normalizedRoom, normalizedDoc, 60000);
      }, 2000);
    },
    [STEWARD_FLOWCHART, log, triggerStewardRun],
  );

  React.useEffect(() => {
    return () => {
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
    };
  }, []);

  const executeToolCall = React.useCallback<DispatcherContext['executeToolCall']>(
    async (call) => {
      const { tool, params = {} } = call.payload || ({} as any);
      log('call', tool, params);

      try {
        // Canvas control tools -> dispatch TLDraw DOM events handled in tldraw-with-collaboration
        const dispatchTL = (name: string, detail?: any) => {
          try {
            window.dispatchEvent(new CustomEvent(name, { detail }));
            try {
              // Emit a lightweight editor trace so we can see canvas commands in Transcript
              bus.send('editor_action', {
                type: 'canvas_command',
                command: name,
                detail,
                timestamp: Date.now(),
              });
            } catch {}
            return { status: 'SUCCESS', message: `${name} dispatched` } as const;
          } catch (e) {
            return { status: 'ERROR', message: e instanceof Error ? e.message : String(e) } as const;
          }
        };

        // Handle new tool names (create_component / update_component) unconditionally
        if (tool === 'create_component') {
          const componentType = String((params as any)?.type || 'Message');
          const providedId = String((params as any)?.messageId || '') || undefined;
          const messageId = providedId || `ui-${componentType.toLowerCase()}-${Date.now()}`;
          try {
            window.dispatchEvent(
              new CustomEvent('custom:showComponent', {
                detail: {
                  messageId,
                  component: {
                    type: componentType,
                    props: { _custom_displayMessage: true, ...(params as any), spec: (params as any)?.spec },
                  },
                  contextKey,
                },
              }),
            );
          } catch {}
          try {
            bus.send('tool_result', {
              type: 'tool_result',
              id: call.id,
              tool,
              result: { status: 'SUCCESS', messageId, componentType },
              timestamp: Date.now(),
              source: 'dispatcher',
            });
          } catch {}
          return { status: 'SUCCESS', message: `Rendered ${componentType}`, messageId } as any;
        }
        
        if (tool === 'update_component') {
          const messageId = String((params as any)?.componentId || (params as any)?.messageId || '');
          const patch = (params as any)?.patch;
          if (!messageId) {
            const msg = 'update_component requires componentId';
            try {
              bus.send('tool_error', {
                type: 'tool_error',
                id: call.id,
                tool,
                error: msg,
                timestamp: Date.now(),
                source: 'dispatcher',
              });
            } catch {}
            return { status: 'ERROR', message: msg } as any;
          }
          const res = await ComponentRegistry.update(messageId, typeof patch === 'string' ? { instruction: patch } : patch);
          try {
            bus.send('tool_result', {
              type: 'tool_result',
              id: call.id,
              tool,
              result: { ...(res as any), messageId },
              timestamp: Date.now(),
              source: 'dispatcher',
            });
          } catch {}
          return { status: 'SUCCESS', message: 'Component updated', ...(res as any) } as any;
        }

        // When steward flowchart mode is enabled, limit available canvas tools
        if (STEWARD_FLOWCHART) {
          if (tool === 'canvas_create_mermaid_stream') {
            return dispatchTL('tldraw:create_mermaid_stream', params);
          }
          if (tool === 'canvas_focus') {
            return dispatchTL('tldraw:canvas_focus', params);
          }
          if (tool === 'canvas_zoom_all') {
            return dispatchTL('tldraw:canvas_zoom_all');
          }
          // Everything else is rejected in steward mode
          try {
            bus.send('tool_error', {
              type: 'tool_error',
              id: call.id,
              tool,
              error: `Unsupported tool in steward mode: ${tool}`,
              timestamp: Date.now(),
              source: 'dispatcher',
            });
          } catch {}
          return { status: 'ERROR', message: `Unsupported tool in steward mode: ${tool}` } as const;
        }

        switch (tool) {
          case 'canvas_create_mermaid_stream':
            return dispatchTL('tldraw:create_mermaid_stream', params);
          case 'canvas_update_mermaid_stream': {
            const globalAny = window as any;
            const shapeId = (params as any)?.shapeId || globalAny.__present_mermaid_last_shape_id || '';
            const text = String((params as any)?.text || '');
            if (!shapeId) return { status: 'ERROR', message: 'No mermaid shapeId available' } as const;
            try {
              window.dispatchEvent(new CustomEvent('tldraw:update_mermaid_stream', { detail: { shapeId, text } }));
              try {
                bus.send('editor_action', {
                  type: 'update_mermaid_stream',
                  shapeId,
                  len: text.length,
                  timestamp: Date.now(),
                });
              } catch {}
              return { status: 'SUCCESS', message: 'Updated mermaid stream' } as const;
            } catch (e) {
              return { status: 'ERROR', message: e instanceof Error ? e.message : String(e) } as const;
            }
          }
          case 'youtube_search': {
            const query = String((params as any)?.query || '').trim();
            try {
              const mcpr = await (window as any).callMcpTool?.('searchVideos', { query });
              const first = mcpr?.videos?.[0] || mcpr?.items?.[0] || null;
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
                try {
                  bus.send('tool_result', {
                    type: 'tool_result',
                    id: call.id,
                    tool,
                    result: { status: 'SUCCESS', videoId },
                    timestamp: Date.now(),
                    source: 'dispatcher',
                  });
                } catch {}
                return { status: 'SUCCESS', message: 'Rendered YouTube video', videoId } as any;
              }
            } catch (e) {
              console.warn('[ToolDispatcher] youtube_search MCP failed', e);
            }
            return { status: 'IGNORED', message: 'No YouTube result' } as const;
          }
          case 'list_components': {
            // Return the list of currently registered components (optionally scoped by contextKey)
            try {
              const components = ComponentRegistry.list(contextKey);
              try {
                bus.send('tool_result', {
                  type: 'tool_result',
                  id: call.id,
                  tool,
                  result: { status: 'SUCCESS', components },
                  timestamp: Date.now(),
                  source: 'dispatcher',
                });
              } catch {}
              return { status: 'SUCCESS', components } as any;
            } catch (e) {
              const message = e instanceof Error ? e.message : String(e);
              try {
                bus.send('tool_error', {
                  type: 'tool_error',
                  id: call.id,
                  tool,
                  error: message,
                  timestamp: Date.now(),
                  source: 'dispatcher',
                });
              } catch {}
              return { status: 'ERROR', message } as any;
            }
          }
          case 'canvas_focus':
            return dispatchTL('tldraw:canvas_focus', params);
          case 'canvas_zoom_all':
            return dispatchTL('tldraw:canvas_zoom_all');
          case 'canvas_create_note':
            return dispatchTL('tldraw:create_note', params);
          case 'canvas_pin_selected':
            return dispatchTL('tldraw:pinSelected');
          case 'canvas_unpin_selected':
            return dispatchTL('tldraw:unpinSelected');
          case 'canvas_lock_selected':
            return dispatchTL('tldraw:lockSelected');
          case 'canvas_unlock_selected':
            return dispatchTL('tldraw:unlockSelected');
          case 'canvas_arrange_grid':
            return dispatchTL('tldraw:arrangeGrid', params);
          case 'canvas_create_rectangle':
            return dispatchTL('tldraw:createRectangle', params);
          case 'canvas_create_ellipse':
            return dispatchTL('tldraw:createEllipse', params);
          case 'canvas_align_selected':
            return dispatchTL('tldraw:alignSelected', params);
          case 'canvas_distribute_selected':
            return dispatchTL('tldraw:distributeSelected', params);
          case 'canvas_draw_smiley':
            return dispatchTL('tldraw:drawSmiley', params);
          case 'canvas_list_shapes': {
            // Ask the TLDraw layer to enumerate shapes and reply over tool_result
            const callId = call.id;
            try {
              window.dispatchEvent(
                new CustomEvent('tldraw:listShapes', { detail: { callId } }),
              );
              // Also emit an editor trace of the request
              try {
                bus.send('editor_action', {
                  type: 'canvas_command',
                  command: 'tldraw:listShapes',
                  detail: { callId },
                  timestamp: Date.now(),
                });
              } catch {}
              return { status: 'ACK', message: 'Listing shapes' } as any;
            } catch (e) {
              const message = e instanceof Error ? e.message : String(e);
              try {
                bus.send('tool_error', {
                  type: 'tool_error',
                  id: callId,
                  tool,
                  error: message,
                  timestamp: Date.now(),
                  source: 'dispatcher',
                });
              } catch {}
              return { status: 'ERROR', message } as any;
            }
          }
          case 'canvas_toggle_grid':
            return dispatchTL('tldraw:toggleGrid');
          case 'canvas_set_background':
            return dispatchTL('tldraw:setBackground', params);
          case 'canvas_set_theme':
            return dispatchTL('tldraw:setTheme', params);
          case 'canvas_select':
            return dispatchTL('tldraw:select', params);
          case 'canvas_select_by_note':
            return dispatchTL('tldraw:selectNote', params);
          case 'canvas_color_shape':
            return dispatchTL('tldraw:colorShape', params);
          case 'canvas_delete_shape':
            return dispatchTL('tldraw:deleteShape', params);
          case 'canvas_rename_note':
            return dispatchTL('tldraw:renameNote', params);
          case 'canvas_connect_shapes':
            return dispatchTL('tldraw:connectShapes', params);
          case 'canvas_label_arrow':
            return dispatchTL('tldraw:labelArrow', params);
          default:
            break;
        }


        if (tool.startsWith('mcp_')) {
          try {
            const toolName = tool.replace(/^mcp_/, '');
            const registry = (window as any).__custom_mcp_tools || {};
            let result: any = undefined;

            // Prefer directly registered window MCP tools if available
            const direct = (registry as any)[toolName] || (registry as any)[`mcp_${toolName}`];
            if (direct) {
              try {
                result = typeof direct?.execute === 'function' ? await direct.execute(params) : await direct(params);
              } catch (e) {
                console.warn('[ToolDispatcher] direct MCP tool failed', toolName, e);
              }
            }
            // Fallback to bridge
            if (!result) {
              result = await (window as any).callMcpTool?.(toolName, params);
            }

            // Last-resort stub for exa so UI still gets signal
            if ((!result || result?.status === 'IGNORED') && toolName === 'exa') {
              const q = String((params as any)?.query || '').trim();
              result = {
                status: 'STUB',
                results: [
                  { title: `Research stub for: ${q}`, snippet: 'MCP not wired. Configure MCP servers in /mcp-config to enable real results.' },
                ],
              };
            }

              try {
                console.log('[ToolDispatcher][mcp]', toolName, 'result:', JSON.stringify(result)?.slice(0, 2000));
              } catch {}
            try {
              bus.send('tool_result', {
                type: 'tool_result',
                id: call.id,
                tool,
                result,
                timestamp: Date.now(),
                source: 'dispatcher',
              });
            } catch {}
            // Opportunistically reflect research in the scorecard UI
            try {
              if (toolName === 'exa') {
                const queryText = String((params as any)?.query || '').trim();
                const items = (result?.results || result?.items || result?.documents || []) as any[];
                const sourcesText = Array.isArray(items)
                  ? items
                      .slice(0, 3)
                      .map((it: any) => it.title || it.url || it.snippet || it.text?.slice?.(0, 80))
                      .filter(Boolean)
                      .join('; ')
                  : '';

                // Find the most recent DebateScorecard on the canvas
                const list = ComponentRegistry.list();
                const latestScorecard = [...list]
                  .filter((c) => c.componentType === 'DebateScorecard')
                  .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))[0];
                if (latestScorecard) {
                  const messageId = latestScorecard.messageId;
                  const patch: Record<string, unknown> = {
                    timeline: [
                      {
                        timestamp: Date.now(),
                        event: `🔎 Research results for: ${queryText || 'query'}`,
                        type: 'fact_check',
                      },
                    ],
                  };
                  if (sourcesText) {
                    (patch as any).factChecks = [
                      {
                        claim: queryText,
                        verdict: 'Unverifiable',
                        confidence: 0,
                        sourcesText,
                        timestamp: Date.now(),
                      },
                    ];
                  }
                  const uiRes = await ComponentRegistry.update(messageId, patch);
                  try {
                    console.log('[ToolDispatcher][mcp→update_component] patched scorecard', JSON.stringify({ messageId, uiRes, patch }));
                  } catch {}
                }
              }
            } catch (e) {
              console.warn('[ToolDispatcher] exa-to-update_component synthesis failed', e);
            }
            return { status: 'SUCCESS', message: 'MCP tool executed', result } as any;
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            try {
              bus.send('tool_error', {
                type: 'tool_error',
                id: call.id,
                tool,
                error: msg,
                timestamp: Date.now(),
                source: 'dispatcher',
              });
            } catch {}
            return { status: 'ERROR', message: msg } as any;
          }
        }

        // Future: route mcp_* to MCP bridge (window.__custom_tool_dispatcher)
        return { status: 'IGNORED', message: `No handler for tool '${tool}'` };
      } catch (e) {
        console.error('[ToolDispatcher] error executing tool', tool, e);
        return { status: 'ERROR', message: e instanceof Error ? e.message : 'Unknown error' };
      }
    },
    [contextKey, enableLogging, STEWARD_FLOWCHART, bus, log],
  );

  // Wire data channel -> dispatcher
  React.useEffect(() => {
    if (!room) return;
    // Initialize observability once per room
    try { createObservabilityBridge(room); } catch {}
    const bus = createLiveKitBus(room);
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
        } as any);
      } catch (e) {
        console.error('[ToolDispatcher] failed handling tool_call', e);
      }
    });

    // Also consume 'decision' events as a fallback and synthesize tool calls when appropriate
    const offDecision = bus.on('decision', async (message: any) => {
      try {
        if (!message || message.type !== 'decision') return;
        const decision = message.payload?.decision || {};
        const originalText: string = message.payload?.originalText || '';
        log('received decision from data channel:', decision);

        // Heuristics: map common requests when explicit tool_call isn't present
        const rawSummary = typeof decision.summary === 'string' ? decision.summary : '';
        const summary: string = String(rawSummary || originalText || '').toLowerCase();
        const globalAny = window as any;

        if (STEWARD_FLOWCHART) {
          const stewardSummary = rawSummary.trim();
          if (decision.should_send && stewardSummary === 'steward_trigger') {
            try {
              globalAny.__present_steward_active = true;
            } catch {}
            const roomName =
              (typeof message.roomId === 'string' && message.roomId) || room?.name || '';
            const existingDocId =
              typeof globalAny.__present_mermaid_last_shape_id === 'string'
                ? globalAny.__present_mermaid_last_shape_id
                : '';
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
              } as any);
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
          } as any);
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
          } as any);
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
          } as any);
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
          } as any);
        }
      } catch (e) {
        console.error('[ToolDispatcher] failed handling decision', e);
      }
    });

    return () => {
      offTool();
      offDecision();
    };
  }, [room, executeToolCall, log, scheduleStewardRun, STEWARD_FLOWCHART]);

  // Optional: expose global bridge, so other parts can reuse dispatcher
  React.useEffect(() => {
    const globalAny = window as any;
    globalAny.__custom_tool_dispatcher = {
      executeMCPTool: async (tool: string, params: any) => {
        return executeToolCall({
          id: crypto.randomUUID?.() || String(Date.now()),
          type: 'tool_call',
          payload: { tool, params },
          timestamp: Date.now(),
          source: 'global-bridge',
        });
      },
    };
    return () => {
      if (globalAny.__custom_tool_dispatcher) delete globalAny.__custom_tool_dispatcher;
    };
  }, [executeToolCall]);

  return <Ctx.Provider value={{ executeToolCall }}>{children}</Ctx.Provider>;
}

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

function parseMinutesFromText(text: string): number | null {
  // 1) Numeric forms: "5 minute", "5-min", "5min", "5 minutes"
  const numeric = /(\d{1,3})\s*(?:-|\s)?\s*(?:minutes?|mins?|min)\b/i.exec(text);
  if (numeric) return Number(numeric[1]);

  // 2) Word forms up to common ranges (1..120)
  const words: Record<string, number> = {
    one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
    eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
    eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60,
    seventy: 70, eighty: 80, ninety: 90, hundred: 100,
  };
  const wordMatch = /\b([a-z\-]+)\s*(?:-|\s)?\s*(?:minutes?|mins?|min)\b/i.exec(text);
  if (wordMatch) {
    const token = wordMatch[1].replace(/-/g, ' ');
    const parts = token.split(/\s+/).filter(Boolean);
    let total = 0;
    for (const p of parts) total += words[p] || 0;
    if (total > 0) return total;
  }
  return null;
}

export function normalizeMermaidText(text: string): string {
  const raw = (text || '').replace(/\r/g, '').trim();
  if (!raw) return 'graph TD;';
  if (/^sequenceDiagram\b/.test(raw)) {
    return raw.split('\n').map((line) => line.trimEnd()).join('\n').trim();
  }
  const tokens = raw
    .split(/\n+/)
    .flatMap((line) => line.split(/;+/))
    .map((line) => line.trim())
    .filter(Boolean);
  let header = 'graph TD;';
  const body: string[] = [];
  for (const token of tokens) {
    if (/^graph\s+/i.test(token)) {
      const dirMatch = token.match(/^graph\s+([A-Za-z]{2})/i);
      if (dirMatch) {
        const dir = dirMatch[1].toUpperCase();
        header = new Set(['TD', 'TB', 'LR', 'RL', 'BT']).has(dir) ? `graph ${dir};` : 'graph TD;';
      } else if (/^graph\s+LR/i.test(token)) {
        header = 'graph LR;';
      } else {
        header = 'graph TD;';
      }
      continue;
    }
    const normalized = token.replace(/\s+/g, ' ').trim();
    if (!normalized) continue;
    if (/^(?:end|subgraph\b|classDef\b|class\b|style\b|linkStyle\b|click\b|direction\b|%%)/i.test(normalized)) {
      body.push(normalized);
      continue;
    }
    body.push(`${normalized.replace(/;$/, '')};`);
  }
  if (body.length === 0) return header;
  return [header, ...body].join('\n');
}

export function getMermaidLastNode(text: string): string | undefined {
  const normalized = normalizeMermaidText(text);
  if (/^sequenceDiagram\b/.test(normalized)) return undefined;
  const matches = Array.from(normalized.matchAll(/([^\s;]+)\s*--\>\s*([^\s;]+)/g));
  if (matches.length === 0) return undefined;
  const last = matches[matches.length - 1];
  return last?.[2]?.replace(/;$/, '') || undefined;
}
