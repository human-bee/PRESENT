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

// Initialize providers using Vercel AI SDK
if (process.env.ANTHROPIC_API_KEY) {
  registry.set('anthropic', new AiSdkProvider('anthropic', 'claude-3-5-sonnet-20241022'));
  registry.set('anthropic:claude-3-5-sonnet-20241022', new AiSdkProvider('anthropic', 'claude-3-5-sonnet-20241022'));
  registry.set('anthropic:claude-3-5-haiku-20241022', new AiSdkProvider('anthropic', 'claude-3-5-haiku-20241022'));
}
if (process.env.OPENAI_API_KEY) {
  registry.set('openai', new AiSdkProvider('openai', 'gpt-4o-2024-11-20'));
  registry.set('openai:gpt-4o', new AiSdkProvider('openai', 'gpt-4o-2024-11-20'));
  registry.set('openai:gpt-4o-mini', new AiSdkProvider('openai', 'gpt-4o-mini'));
}

// Always register fake provider for testing
registry.set('debug/fake', new FakeProvider());

export function selectModel(preferred?: string): StreamingProvider {
  const name = preferred?.trim() || process.env.CANVAS_STEWARD_MODEL || 'debug/fake';
  const provider = registry.get(name);
  if (provider) return provider;
  
  // Try fallbacks
  if (registry.get('anthropic')) return registry.get('anthropic')!;
  if (registry.get('openai')) return registry.get('openai')!;
  
  // Final fallback to fake
  return registry.get('debug/fake')!;
}
