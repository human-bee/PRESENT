import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { generateObject, streamObject } from 'ai';
import { z } from 'zod';
import { AgentActionSchema } from '../shared/types';
import type { StructuredStream } from './streaming';
import type { ModelTuning } from './model/presets';

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
    const schema = z.object({ actions: z.array(AgentActionSchema.extend({ id: z.string().optional() })) });
    return streamObject({
      model,
      system: options?.system || 'You are a helpful assistant.',
      prompt,
      schema,
      temperature: options?.tuning?.temperature ?? 0,
      topP: options?.tuning?.topP,
      maxOutputTokens: options?.tuning?.maxOutputTokens,
    });
  }

  private resolveModel() {
    const openai = process.env.OPENAI_API_KEY ? createOpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;
    const anthropic = process.env.ANTHROPIC_API_KEY ? createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY }) : null;
    const modelFn = this.provider === 'openai' ? openai : anthropic;
    if (!modelFn) throw new Error(`Provider not configured: ${this.provider}`);
    return modelFn(this.modelId);
  }

  private async generateOnce(prompt: string, options?: { system?: string; tuning?: ModelTuning }) {
    const model = this.resolveModel();
    const schema = z.object({ actions: z.array(AgentActionSchema.extend({ id: z.string().optional() })) });
    const { object } = await generateObject({
      model,
      system: options?.system || 'You are a helpful assistant.',
      prompt,
      schema,
      temperature: options?.tuning?.temperature ?? 0,
      topP: options?.tuning?.topP,
      maxOutputTokens: options?.tuning?.maxOutputTokens,
    });
    return object;
  }
}

class FakeProvider implements StreamingProvider {
  name = 'debug/fake';
  async *stream(_prompt: string, _options?: { system?: string; tuning?: ModelTuning }): AsyncIterable<StreamChunk> {
    // Emit a trivial action stream for smoke testing
    const action = {
      id: `a-${Date.now()}`,
      name: 'think',
      params: { text: 'planning canvas change (debug/fake provider)' },
    };
    yield { type: 'json', data: { actions: [action] } } as StreamChunk;
  }

  async streamStructured(_prompt: string, _options?: { system?: string; tuning?: ModelTuning }): Promise<StructuredStream> {
    const action = {
      id: `a-${Date.now()}`,
      name: 'think',
      params: { text: 'planning canvas change (debug/fake provider)' },
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
    const hasAuth = provider === 'anthropic' ? !!process.env.ANTHROPIC_API_KEY : !!process.env.OPENAI_API_KEY;
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
