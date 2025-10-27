import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { generateObject } from 'ai';
import { z } from 'zod';
import { AgentActionSchema } from '../shared/types';

export type StreamChunk = { type: 'json'; data: unknown } | { type: 'text'; data: string };

export interface StreamingProvider {
  name: string;
  stream(prompt: string, options?: { system?: string }): AsyncIterable<StreamChunk>;
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

  async *stream(prompt: string, options?: { system?: string }): AsyncIterable<StreamChunk> {
    const openai = process.env.OPENAI_API_KEY ? createOpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;
    const anthropic = process.env.ANTHROPIC_API_KEY ? createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY }) : null;
    const modelFn = this.provider === 'openai' ? openai : anthropic;
    if (!modelFn) throw new Error(`Provider not configured: ${this.provider}`);

    const model = modelFn(this.modelId);
    const schema = z.object({ actions: z.array(AgentActionSchema.extend({ id: z.string().optional() })) });

    const { object } = await generateObject({
      model,
      system: options?.system || 'You are a helpful assistant.',
      prompt,
      schema,
      temperature: 0,
    });
    if (object) {
      yield { type: 'json', data: object };
    }
  }
}

class FakeProvider implements StreamingProvider {
  name = 'debug/fake';
  async *stream(_prompt: string): AsyncIterable<StreamChunk> {
    // Emit a trivial action stream for smoke testing
    const action = {
      id: `a-${Date.now()}`,
      name: 'think',
      params: { text: 'planning canvas change (debug/fake provider)' },
    };
    yield { type: 'json', data: { actions: [action] } } as StreamChunk;
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



