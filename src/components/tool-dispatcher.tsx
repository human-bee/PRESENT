/**
 * ToolDispatcher
 *
 * Minimal first-principles dispatcher that exposes a context + hook
 * and handles a small set of tool calls needed by the UI.
 *
 * Responsibilities now:
 * - Provide `useToolDispatcher()` with `executeToolCall` function
 * - For `generate_ui_component`, dispatch a browser event that the
 *   thread UI listens to (custom:showComponent)
 * - Optionally expose a global bridge used by the MCP layer
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
  const log = (...args: any[]) => enableLogging && console.log('[ToolDispatcher]', ...args);
  const room = useRoomContext();
  const bus = React.useMemo(() => createLiveKitBus(room), [room]);

  const executeToolCall = React.useCallback<DispatcherContext['executeToolCall']>(
    async (call) => {
      const { tool, params = {} } = call.payload || ({} as any);
      log('call', tool, params);

      try {
        // Canvas control tools -> dispatch TLDraw DOM events handled in tldraw-with-collaboration
        const dispatchTL = (name: string, detail?: any) => {
          try {
            window.dispatchEvent(new CustomEvent(name, { detail }));
            return { status: 'SUCCESS', message: `${name} dispatched` } as const;
          } catch (e) {
            return { status: 'ERROR', message: e instanceof Error ? e.message : String(e) } as const;
          }
        };

        switch (tool) {
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
          case 'canvas_toggle_grid':
            return dispatchTL('tldraw:toggleGrid');
          case 'canvas_set_background':
            return dispatchTL('tldraw:setBackground', params);
          case 'canvas_set_theme':
            return dispatchTL('tldraw:setTheme', params);
          case 'canvas_select':
            return dispatchTL('tldraw:select', params);
          default:
            break;
        }

        if (tool === 'generate_ui_component') {
          const componentType = String((params as any)?.componentType || 'Message');
          const providedId = String((params as any)?.messageId || '') || undefined;
          const messageId = providedId || `ui-${componentType.toLowerCase()}-${Date.now()}`;
          // Let the thread listener materialize this component
          try {
            window.dispatchEvent(
              new CustomEvent('custom:showComponent', {
                detail: {
                  messageId,
                  component: {
                    type: componentType,
                    props: { _custom_displayMessage: true, ...(params as any) },
                  },
                  contextKey,
                },
              }),
            );
          } catch {}
          // Opportunistically populate certain components after mount
          try {
            if (componentType === 'WeatherForecast') {
              const locRaw = String((params as any)?.location || (params as any)?.city || '')
                .replace(/\s+on the canvas\b/i, '')
                .trim();
              if (locRaw) {
                void (async () => {
                  for (let attempt = 0; attempt < 5; attempt++) {
                    const ok = await populateWeather(messageId, locRaw);
                    if (ok) break;
                    await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
                  }
                })();
              }
            }
          } catch {}
          // Emit tool_result so agents can correlate
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

        if (tool === 'ui_update') {
          const messageId = String((params as any)?.messageId || (params as any)?.id || '');
          const patch = (params as any)?.patch || {};
          if (!messageId) {
            const msg = 'ui_update requires messageId';
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
          const res = await ComponentRegistry.update(messageId, patch);
          try {
            // eslint-disable-next-line no-console
            console.log('[ToolDispatcher][ui_update] result', { messageId, res });
          } catch {}
          // Emit result back
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

        if (tool.startsWith('mcp_')) {
          try {
            const toolName = tool.replace(/^mcp_/, '');
            const result = await (window as any).callMcpTool?.(toolName, params);
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
                  await ComponentRegistry.update(messageId, patch);
                }
              }
            } catch (e) {
              console.warn('[ToolDispatcher] exa-to-ui_update synthesis failed', e);
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
    [contextKey, enableLogging],
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
        const summary: string = String(decision.summary || originalText || '').toLowerCase();
        const minutesParsed = parseMinutesFromText(summary);
        if (decision.should_send && minutesParsed) {
          const minutes = Math.max(1, Math.min(180, minutesParsed));
          log('synthesizing timer component', { minutes });
          await executeToolCall({
            id: message.id || `${Date.now()}`,
            type: 'tool_call',
            payload: {
              tool: 'generate_ui_component',
              params: { componentType: 'RetroTimerEnhanced', initialMinutes: minutes },
            },
            timestamp: Date.now(),
            source: 'dispatcher',
            roomId: message.roomId,
          } as any);
          return;
        }

        const isWeather = /\bweather\b|\bforecast\b/.test(summary);
        if (decision.should_send && isWeather) {
          const locMatch = /\b(?:in|for)\s+([^.,!?]+)\b/.exec(String(decision.summary || originalText));
          const location = locMatch ? locMatch[1].replace(/\s+on the canvas\b/i, '').trim() : undefined;
          log('synthesizing weather component', { location });
          await executeToolCall({
            id: message.id || `${Date.now()}`,
            type: 'tool_call',
            payload: {
              tool: 'generate_ui_component',
              params: { componentType: 'WeatherForecast', location },
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
  }, [room, executeToolCall]);

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

async function populateWeather(messageId: string, location: string): Promise<boolean> {
  try {
    const geoRes = await fetch(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(location)}&count=1&language=en&format=json`,
    );
    const geocode = await geoRes.json().catch(() => null);
    const first = geocode?.results?.[0];
    if (!first) return false;

    const { latitude, longitude, name, country_code } = first;
    const locLabel = `${name}${country_code ? ', ' + country_code : ''}`;

    const wxRes = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,wind_speed_10m,wind_direction_10m,relative_humidity_2m&hourly=precipitation_probability&timezone=auto`,
    );
    const wx = await wxRes.json().catch(() => null);
    if (!wx?.current) return false;

    const temp = wx.current.temperature_2m;
    const windSpd = wx.current.wind_speed_10m;
    const windDir = wx.current.wind_direction_10m;
    const humidity = wx.current.relative_humidity_2m;
    const precipProb = wx.hourly?.precipitation_probability?.[0] ?? null;

    const toCompass = (deg: number) => {
      if (typeof deg !== 'number') return 'N';
      const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
      return dirs[Math.round(deg / 45) % 8];
    };

    const periods = [
      {
        name: 'Now',
        temperature: `${Math.round(temp)}°`,
        wind: { speed: `${Math.round(windSpd)} mph`, direction: toCompass(windDir) },
        condition: 'Current conditions',
        humidity: typeof humidity === 'number' ? Math.round(humidity) : undefined,
        precipitation: typeof precipProb === 'number' ? Math.round(precipProb) : undefined,
      },
    ];

    const patch = { location: locLabel, periods, viewType: 'current' } as any;
    const res = await ComponentRegistry.update(messageId, patch);
    return Boolean((res as any)?.success);
  } catch (e) {
    console.warn('[ToolDispatcher] populateWeather failed', e);
    return false;
  }
}
