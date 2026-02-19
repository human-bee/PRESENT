import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { generateObject, streamObject } from 'ai';
import { z } from 'zod';
import type { StructuredStream } from './streaming';
import type { ModelTuning } from './model/presets';
import { getRuntimeModelKey } from '@/lib/agents/shared/model-runtime-context';
import {
  describeRetryError,
  parseRetryEnvInt,
  withProviderRetry,
  isRetryableProviderError,
} from '@/lib/agents/shared/provider-retry';

const agentActionListSchema = z
  .object({
    actions: z
      .array(
        z.object({
          id: z.string().optional(),
          name: z.string(),
          params: z.unknown().optional(),
        }),
      )
      .min(1),
  })
  .passthrough() as unknown as z.ZodTypeAny;

const unsafeStreamObject = streamObject as unknown as (args: any) => any;

const unsafeGenerateObject = generateObject as unknown as (args: any) => Promise<{ object: any }>;

const MODEL_RETRY_ATTEMPTS = parseRetryEnvInt(process.env.CANVAS_AGENT_MODEL_RETRY_ATTEMPTS, 3, {
  min: 1,
  max: 6,
});
const MODEL_RETRY_BASE_DELAY_MS = parseRetryEnvInt(process.env.CANVAS_AGENT_MODEL_RETRY_BASE_DELAY_MS, 250, {
  min: 0,
  max: 10_000,
});
const MODEL_RETRY_MAX_DELAY_MS = parseRetryEnvInt(process.env.CANVAS_AGENT_MODEL_RETRY_MAX_DELAY_MS, 3_000, {
  min: 1,
  max: 20_000,
});

export type StreamChunk = { type: 'json'; data: unknown } | { type: 'text'; data: string };

export interface StreamingProvider {
  name: string;
  stream(prompt: string, options?: { system?: string; tuning?: ModelTuning }): AsyncIterable<StreamChunk>;
  streamStructured?: (prompt: string, options?: { system?: string; tuning?: ModelTuning }) => Promise<StructuredStream>;
}

class AiSdkProvider implements StreamingProvider {
  name: string;
  private modelId: string;
  private provider: 'openai' | 'anthropic';

  constructor(provider: 'openai' | 'anthropic', modelId: string) {
    this.name = `${provider}:${modelId}`;
    this.provider = provider;
    this.modelId = modelId;
  }

  async *stream(prompt: string, options?: { system?: string; tuning?: ModelTuning }): AsyncIterable<StreamChunk> {
    let emittedStructuredChunk = false;
    try {
      const structured = await this.streamStructured?.(prompt, options);
      if (structured) {
        for await (const partial of structured.partialObjectStream) {
          emittedStructuredChunk = true;
          yield { type: 'json', data: partial };
        }
        const final = await structured.fullStream;
        if (final?.object) {
          emittedStructuredChunk = true;
          yield { type: 'json', data: final.object };
        }
        return;
      }
    } catch (error) {
      if (!isRetryableProviderError(error, { provider: this.provider }) || emittedStructuredChunk) {
        throw error;
      }
      console.warn('[CanvasAgent] structured stream failed with transient provider error, falling back', {
        provider: this.provider,
        model: this.modelId,
        error: describeRetryError(error),
      });
    }

    const fallback = await this.generateOnce(prompt, options);
    if (fallback) {
      yield { type: 'json', data: fallback };
    }
  }

  async streamStructured(prompt: string, options?: { system?: string; tuning?: ModelTuning }): Promise<StructuredStream> {
    const model = this.resolveModel();
    // Anthropic does not allow both temperature and top_p. Prefer temperature.
    const common = {
      model,
      system: options?.system || 'You are a helpful assistant.',
      prompt,
      schema: agentActionListSchema,
      temperature: options?.tuning?.temperature ?? 0,
      maxOutputTokens: options?.tuning?.maxOutputTokens,
      providerOptions: this.providerOptionsForCall(),
    } as any;
    if (this.provider !== 'anthropic' && options?.tuning?.topP !== undefined) {
      common.topP = options.tuning.topP;
    }
    const streamed = await withProviderRetry(
      async () =>
        unsafeStreamObject(common) as {
          partialObjectStream: AsyncIterable<any>;
          object: Promise<any>;
        },
      this.retryOptions(),
    );

    return {
      partialObjectStream: streamed.partialObjectStream,
      fullStream: streamed.object.then((object) => ({ object })),
    } satisfies StructuredStream;
  }

  private resolveModel() {
    const openaiKey = getRuntimeModelKey('OPENAI_API_KEY') ?? process.env.OPENAI_API_KEY;
    const anthropicKey = getRuntimeModelKey('ANTHROPIC_API_KEY') ?? process.env.ANTHROPIC_API_KEY;
    const openai = openaiKey ? createOpenAI({ apiKey: openaiKey }) : null;
    const anthropic = anthropicKey ? createAnthropic({ apiKey: anthropicKey }) : null;
    const modelFn = this.provider === 'openai' ? openai : anthropic;
    if (!modelFn) throw new Error(`Provider not configured: ${this.provider}`);
    return modelFn(this.modelId);
  }

  private async generateOnce(prompt: string, options?: { system?: string; tuning?: ModelTuning }) {
    const model = this.resolveModel();
    const common = {
      model,
      system: options?.system || 'You are a helpful assistant.',
      prompt,
      schema: agentActionListSchema,
      temperature: options?.tuning?.temperature ?? 0,
      maxOutputTokens: options?.tuning?.maxOutputTokens,
      providerOptions: this.providerOptionsForCall(),
    } as any;
    if (this.provider !== 'anthropic' && options?.tuning?.topP !== undefined) {
      common.topP = options.tuning.topP;
    }
    const { object } = await withProviderRetry(
      () => unsafeGenerateObject(common),
      this.retryOptions(),
    );
    return object;
  }

  private providerOptionsForCall() {
    if (this.provider !== 'anthropic') return undefined;
    if (process.env.CANVAS_AGENT_DISABLE_PROMPT_CACHE === '1') return undefined;
    const ttl = process.env.ANTHROPIC_CACHE_TTL === '5m' ? '5m' : process.env.ANTHROPIC_CACHE_TTL === '1h' ? '1h' : undefined;
    return {
      anthropic: {
        cacheControl: ttl ? { type: 'ephemeral', ttl } : { type: 'ephemeral' },
      },
    };
  }

  private retryOptions() {
    return {
      provider: this.provider,
      attempts: MODEL_RETRY_ATTEMPTS,
      initialDelayMs: MODEL_RETRY_BASE_DELAY_MS,
      maxDelayMs: MODEL_RETRY_MAX_DELAY_MS,
      onRetry: ({ attempt, maxAttempts, delayMs, error }: {
        attempt: number;
        maxAttempts: number;
        delayMs: number;
        error: unknown;
      }) => {
        console.warn('[CanvasAgent] model call transient retry', {
          provider: this.provider,
          model: this.modelId,
          attempt,
          maxAttempts,
          delayMs,
          error: describeRetryError(error),
        });
      },
    } as const;
  }
}

class FakeProvider implements StreamingProvider {
  name = 'debug/fake';
  async *stream(_prompt: string, _options?: { system?: string; tuning?: ModelTuning }): AsyncIterable<StreamChunk> {
    const now = Date.now();
    const rect = {
      id: `rect-${now.toString(36)}`,
      name: 'create_shape',
      params: {
        id: `rect-${now.toString(36)}`,
        type: 'rectangle',
        x: 0,
        y: 0,
        props: {
          w: 280,
          h: 180,
          dash: 'dotted',
          size: 'm',
          color: 'red',
          fill: 'none',
        },
      },
    };
    yield { type: 'json', data: { actions: [rect] } } as StreamChunk;
  }

  async streamStructured(_prompt: string, _options?: { system?: string; tuning?: ModelTuning }): Promise<StructuredStream> {
    const now = Date.now();
    const action = {
      id: `rect-${now.toString(36)}`,
      name: 'create_shape',
      params: {
        id: `rect-${now.toString(36)}`,
        type: 'rectangle',
        x: 0,
        y: 0,
        props: { w: 280, h: 180, dash: 'dotted', size: 'm', color: 'red', fill: 'none' },
      },
    };
    async function* partial() {
      yield { actions: [action] };
    }
    return {
      partialObjectStream: partial(),
      fullStream: Promise.resolve({ object: { actions: [action] } }),
    };
  }
}

const registry = new Map<string, StreamingProvider>();

const registerProvider = (key: string, provider: 'anthropic' | 'openai', modelId: string) => {
  if (!registry.has(key)) {
    registry.set(key, new AiSdkProvider(provider, modelId));
  }
};

// Initialize commonly used providers using Vercel AI SDK
const bootstrapProviders = () => {
  if (process.env.ANTHROPIC_API_KEY) {
    registerProvider('anthropic:claude-sonnet-4-5', 'anthropic', 'claude-sonnet-4-5');
    registerProvider('anthropic:claude-haiku-4-5', 'anthropic', 'claude-haiku-4-5');
    registry.set('anthropic', registry.get('anthropic:claude-sonnet-4-5')!);
  }
  if (process.env.OPENAI_API_KEY) {
    registerProvider('openai:gpt-5', 'openai', 'gpt-5');
    registerProvider('openai:gpt-5-mini', 'openai', 'gpt-5-mini');
    registry.set('openai', registry.get('openai:gpt-5')!);
  }
  registry.set('debug/fake', new FakeProvider());
};

const ensureDynamicProvider = (name: string): StreamingProvider | null => {
  const trimmed = name.trim();
  if (!trimmed) return null;
  if (registry.has(trimmed)) return registry.get(trimmed)!;

  const create = (provider: 'anthropic' | 'openai', modelId: string, key?: string) => {
    const hasAuth =
      provider === 'anthropic'
        ? !!(getRuntimeModelKey('ANTHROPIC_API_KEY') ?? process.env.ANTHROPIC_API_KEY)
        : !!(getRuntimeModelKey('OPENAI_API_KEY') ?? process.env.OPENAI_API_KEY);
    if (!hasAuth) return null;
    const registryKey = key ?? `${provider}:${modelId}`;
    registerProvider(registryKey, provider, modelId);
    return registry.get(registryKey) ?? null;
  };

  if (trimmed.includes(':')) {
    const [providerAlias, ...rest] = trimmed.split(':');
    const modelId = rest.join(':');
    if (!modelId) return null;
    if (providerAlias === 'anthropic') return create('anthropic', modelId, trimmed);
    if (providerAlias === 'openai') return create('openai', modelId, trimmed);
    return null;
  }

  if (trimmed.startsWith('claude')) return create('anthropic', trimmed, `anthropic:${trimmed}`);
  if (trimmed.startsWith('gpt')) return create('openai', trimmed, `openai:${trimmed}`);

  return null;
};

bootstrapProviders();

export function selectModel(preferred?: string): StreamingProvider {
  const envPreferred = preferred?.trim() || process.env.CANVAS_STEWARD_MODEL || 'debug/fake';
  const resolved = ensureDynamicProvider(envPreferred);
  if (resolved) return resolved;

  if (process.env.CANVAS_STEWARD_MODEL) {
    const secondary = ensureDynamicProvider(process.env.CANVAS_STEWARD_MODEL);
    if (secondary) return secondary;
  }

  if (registry.get('anthropic')) return registry.get('anthropic')!;
  if (registry.get('openai')) return registry.get('openai')!;

  return registry.get('debug/fake')!;
}
