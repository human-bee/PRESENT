import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { generateObject, streamObject } from 'ai';
import { z } from 'zod';
import type { StructuredStream } from './streaming';
import type { ModelTuning } from './model/presets';
import { BYOK_REQUIRED } from '@/lib/agents/shared/byok-flags';

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

export type StreamChunk = { type: 'json'; data: unknown } | { type: 'text'; data: string };

export type CanvasAgentApiKeys = Partial<Record<'openai' | 'anthropic', string>>;

export interface StreamingProvider {
  name: string;
  stream(prompt: string, options?: { system?: string; tuning?: ModelTuning }): AsyncIterable<StreamChunk>;
  streamStructured?: (prompt: string, options?: { system?: string; tuning?: ModelTuning }) => Promise<StructuredStream>;
}

class AiSdkProvider implements StreamingProvider {
  name: string;
  private modelId: string;
  private provider: 'openai' | 'anthropic';
  private apiKeys: CanvasAgentApiKeys;

  constructor(provider: 'openai' | 'anthropic', modelId: string, apiKeys?: CanvasAgentApiKeys) {
    this.name = `${provider}:${modelId}`;
    this.provider = provider;
    this.modelId = modelId;
    this.apiKeys = apiKeys ?? {};
  }

  async *stream(prompt: string, options?: { system?: string; tuning?: ModelTuning }): AsyncIterable<StreamChunk> {
    const structured = await this.streamStructured?.(prompt, options);
    if (structured) {
      for await (const partial of structured.partialObjectStream) {
        yield { type: 'json', data: partial };
      }
      const final = await structured.fullStream;
      if (final?.object) {
        yield { type: 'json', data: final.object };
      }
      return;
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
    const streamed = unsafeStreamObject(common) as {
      partialObjectStream: AsyncIterable<any>;
      object: Promise<any>;
    };

    return {
      partialObjectStream: streamed.partialObjectStream,
      fullStream: streamed.object.then((object) => ({ object })),
    } satisfies StructuredStream;
  }

  private resolveModel() {
    const bundleKey =
      this.provider === 'openai'
        ? (this.apiKeys.openai ?? '').trim()
        : (this.apiKeys.anthropic ?? '').trim();

    if (BYOK_REQUIRED) {
      if (!bundleKey) throw new Error(`BYOK_MISSING_KEY:${this.provider}`);
      const modelFn =
        this.provider === 'openai'
          ? createOpenAI({ apiKey: bundleKey })
          : createAnthropic({ apiKey: bundleKey });
      return modelFn(this.modelId);
    }

    const envKey =
      this.provider === 'openai' ? (process.env.OPENAI_API_KEY ?? '').trim() : (process.env.ANTHROPIC_API_KEY ?? '').trim();
    const apiKey = bundleKey || envKey;
    if (!apiKey) throw new Error(`Provider not configured: ${this.provider}`);

    const modelFn =
      this.provider === 'openai'
        ? createOpenAI({ apiKey })
        : createAnthropic({ apiKey });

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
    const { object } = await unsafeGenerateObject(common);
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

const DEFAULT_OPENAI_MODEL = 'gpt-5-mini';
const DEFAULT_ANTHROPIC_MODEL = 'claude-sonnet-4-5';

const fakeProvider = new FakeProvider();

function hasProviderKey(provider: 'openai' | 'anthropic', apiKeys: CanvasAgentApiKeys): boolean {
  const bundleKey =
    provider === 'openai' ? (apiKeys.openai ?? '').trim() : (apiKeys.anthropic ?? '').trim();
  if (bundleKey) return true;
  if (BYOK_REQUIRED) return false;
  const envKey =
    provider === 'openai' ? (process.env.OPENAI_API_KEY ?? '').trim() : (process.env.ANTHROPIC_API_KEY ?? '').trim();
  return Boolean(envKey);
}

function extractProviderAlias(name: string): 'openai' | 'anthropic' | null {
  const trimmed = (name || '').trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('openai:') || trimmed === 'openai') return 'openai';
  if (trimmed.startsWith('anthropic:') || trimmed === 'anthropic') return 'anthropic';
  if (trimmed.startsWith('gpt')) return 'openai';
  if (trimmed.startsWith('claude')) return 'anthropic';
  return null;
}

function preferredModelIdForProvider(
  provider: 'openai' | 'anthropic',
  candidates: string[],
): string | null {
  for (const candidate of candidates) {
    const trimmed = (candidate || '').trim();
    if (!trimmed) continue;
    if (trimmed.includes(':')) {
      const [alias, ...rest] = trimmed.split(':');
      const modelId = rest.join(':');
      if (!modelId) continue;
      if (alias === provider) return modelId;
      continue;
    }
    if (provider === 'openai' && trimmed.startsWith('gpt')) return trimmed;
    if (provider === 'anthropic' && trimmed.startsWith('claude')) return trimmed;
  }
  return null;
}

function resolvePreferredProvider(name: string, apiKeys: CanvasAgentApiKeys): StreamingProvider | null {
  const trimmed = (name || '').trim();
  if (!trimmed) return null;

  if (trimmed === 'debug/fake') {
    return BYOK_REQUIRED ? null : fakeProvider;
  }

  if (trimmed.includes(':')) {
    const [providerAlias, ...rest] = trimmed.split(':');
    const modelId = rest.join(':');
    if (!modelId) return null;
    if (providerAlias === 'openai' && hasProviderKey('openai', apiKeys)) {
      return new AiSdkProvider('openai', modelId, apiKeys);
    }
    if (providerAlias === 'anthropic' && hasProviderKey('anthropic', apiKeys)) {
      return new AiSdkProvider('anthropic', modelId, apiKeys);
    }
    return null;
  }

  if (trimmed === 'openai') {
    return hasProviderKey('openai', apiKeys) ? new AiSdkProvider('openai', DEFAULT_OPENAI_MODEL, apiKeys) : null;
  }
  if (trimmed === 'anthropic') {
    return hasProviderKey('anthropic', apiKeys) ? new AiSdkProvider('anthropic', DEFAULT_ANTHROPIC_MODEL, apiKeys) : null;
  }

  if (trimmed.startsWith('gpt')) {
    return hasProviderKey('openai', apiKeys) ? new AiSdkProvider('openai', trimmed, apiKeys) : null;
  }
  if (trimmed.startsWith('claude')) {
    return hasProviderKey('anthropic', apiKeys) ? new AiSdkProvider('anthropic', trimmed, apiKeys) : null;
  }

  return null;
}

export function selectModel(args?: { preferred?: string; apiKeys?: CanvasAgentApiKeys }): StreamingProvider {
  const apiKeys = args?.apiKeys ?? {};
  const envModel = (process.env.CANVAS_STEWARD_MODEL ?? '').trim();
  const primary =
    (args?.preferred ?? '').trim() ||
    envModel ||
    (BYOK_REQUIRED ? `openai:${DEFAULT_OPENAI_MODEL}` : 'debug/fake');

  const resolved = resolvePreferredProvider(primary, apiKeys);
  if (resolved) return resolved;

  if (envModel && envModel !== primary) {
    const secondary = resolvePreferredProvider(envModel, apiKeys);
    if (secondary) return secondary;
  }

  if (BYOK_REQUIRED) {
    if ((apiKeys.openai ?? '').trim()) {
      const modelId = preferredModelIdForProvider('openai', [primary, envModel]) ?? DEFAULT_OPENAI_MODEL;
      return new AiSdkProvider('openai', modelId, apiKeys);
    }
    if ((apiKeys.anthropic ?? '').trim()) {
      const modelId = preferredModelIdForProvider('anthropic', [primary, envModel]) ?? DEFAULT_ANTHROPIC_MODEL;
      return new AiSdkProvider('anthropic', modelId, apiKeys);
    }

    const preferredProvider = extractProviderAlias(primary) ?? 'openai';
    throw new Error(`BYOK_MISSING_KEY:${preferredProvider}`);
  }

  if (hasProviderKey('anthropic', apiKeys)) return new AiSdkProvider('anthropic', DEFAULT_ANTHROPIC_MODEL, apiKeys);
  if (hasProviderKey('openai', apiKeys)) return new AiSdkProvider('openai', DEFAULT_OPENAI_MODEL, apiKeys);

  return fakeProvider;
}
