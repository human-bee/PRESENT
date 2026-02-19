import { z } from 'zod';
import {
  describeRetryError,
  isRetryableProviderError,
  parseRetryEnvInt,
  withProviderRetry,
} from '@/lib/agents/shared/provider-retry';

const routerDecisionSchema = z.object({
  route: z.enum(['canvas', 'none']),
  message: z.string().optional(),
});

export type ManualRouteDecision = z.infer<typeof routerDecisionSchema>;

export function createManualInputRouter() {
  let routerModelCache: any = null;
  const retryAttempts = parseRetryEnvInt(process.env.VOICE_AGENT_ROUTER_RETRY_ATTEMPTS, 3, {
    min: 1,
    max: 6,
  });
  const retryBaseDelayMs = parseRetryEnvInt(process.env.VOICE_AGENT_ROUTER_RETRY_BASE_DELAY_MS, 200, {
    min: 0,
    max: 10_000,
  });
  const retryMaxDelayMs = parseRetryEnvInt(process.env.VOICE_AGENT_ROUTER_RETRY_MAX_DELAY_MS, 2_500, {
    min: 1,
    max: 20_000,
  });

  const localHeuristicRoute = (text: string): ManualRouteDecision | null => {
    const normalized = text.trim().toLowerCase();
    if (!normalized) return null;
    const canvasKeywords = [
      'draw',
      'sketch',
      'illustrate',
      'canvas',
      'roadmap',
      'diagram',
      'sticky note',
      'sticky',
      'shape',
      'arrow',
      'rectangle',
      'circle',
      'ellipse',
      'line',
      'connect',
      'focus',
      'zoom',
      'move',
      'align',
    ];
    const nonCanvasKeywords = [
      'scorecard',
      'debate',
      'crowd pulse',
      'timer',
      'research',
      'kanban',
      'infographic',
    ];
    const hasCanvasKeyword = canvasKeywords.some((keyword) => normalized.includes(keyword));
    const hasNonCanvasKeyword = nonCanvasKeywords.some((keyword) => normalized.includes(keyword));
    if (hasCanvasKeyword && !hasNonCanvasKeyword) {
      return { route: 'canvas', message: text.trim() };
    }
    return { route: 'none' };
  };

  const getRouterModel = async () => {
    if (routerModelCache) return routerModelCache;
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return null;
    const { createAnthropic } = await import('@ai-sdk/anthropic');
    const modelId = (process.env.VOICE_AGENT_ROUTER_MODEL || 'claude-haiku-4-5').trim();
    const anthropic = createAnthropic({ apiKey });
    routerModelCache = anthropic(modelId);
    return routerModelCache;
  };

  return async (text: string): Promise<ManualRouteDecision | null> => {
    const model = await getRouterModel();
    if (!model) return localHeuristicRoute(text);

    const system = [
      'You are a routing assistant for a real-time UI voice agent.',
      'Decide whether the user request should be handled by the canvas agent.',
      'Canvas requests involve drawing, layout, styling, editing, or placing shapes or visuals on the canvas.',
      'If the request is a canvas task, return route="canvas" and a concise imperative message for the canvas agent.',
      'Otherwise return route="none".',
    ].join(' ');

    const { generateObject } = await import('ai');
    let object: unknown;
    try {
      const response = await withProviderRetry(
        async () =>
          (generateObject as unknown as (args: any) => Promise<{ object: any }>)({
            model,
            system,
            prompt: text,
            schema: routerDecisionSchema,
            temperature: 0,
            maxOutputTokens: 120,
          }),
        {
          provider: 'anthropic',
          attempts: retryAttempts,
          initialDelayMs: retryBaseDelayMs,
          maxDelayMs: retryMaxDelayMs,
          onRetry: ({ attempt, maxAttempts, delayMs, error }) => {
            console.warn('[VoiceAgent] manual routing transient retry', {
              attempt,
              maxAttempts,
              delayMs,
              error: describeRetryError(error),
            });
          },
        },
      );
      object = response.object;
    } catch (error) {
      if (isRetryableProviderError(error, { provider: 'anthropic' })) {
        console.warn('[VoiceAgent] manual routing exhausted transient retries, using heuristic', {
          error: describeRetryError(error),
        });
        return localHeuristicRoute(text);
      }
      throw error;
    }

    const parsed = routerDecisionSchema.safeParse(object);
    if (!parsed.success) return localHeuristicRoute(text);
    return parsed.data;
  };
}
