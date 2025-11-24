import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { generateObject, streamObject } from 'ai';
import { z } from 'zod';
const agentActionListSchema = z
    .object({
    actions: z
        .array(z.object({
        id: z.string().optional(),
        name: z.string(),
        params: z.unknown().optional(),
    }))
        .min(1),
})
    .passthrough();
const unsafeStreamObject = streamObject;
const unsafeGenerateObject = generateObject;
class AiSdkProvider {
    constructor(provider, modelId) {
        this.name = `${provider}:${modelId}`;
        this.provider = provider;
        this.modelId = modelId;
    }
    async *stream(prompt, options) {
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
    async streamStructured(prompt, options) {
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
        };
        if (this.provider !== 'anthropic' && options?.tuning?.topP !== undefined) {
            common.topP = options.tuning.topP;
        }
        const streamed = unsafeStreamObject(common);
        return {
            partialObjectStream: streamed.partialObjectStream,
            fullStream: streamed.object.then((object) => ({ object })),
        };
    }
    resolveModel() {
        const openai = process.env.OPENAI_API_KEY ? createOpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;
        const anthropic = process.env.ANTHROPIC_API_KEY ? createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY }) : null;
        const modelFn = this.provider === 'openai' ? openai : anthropic;
        if (!modelFn)
            throw new Error(`Provider not configured: ${this.provider}`);
        return modelFn(this.modelId);
    }
    async generateOnce(prompt, options) {
        const model = this.resolveModel();
        const common = {
            model,
            system: options?.system || 'You are a helpful assistant.',
            prompt,
            schema: agentActionListSchema,
            temperature: options?.tuning?.temperature ?? 0,
            maxOutputTokens: options?.tuning?.maxOutputTokens,
            providerOptions: this.providerOptionsForCall(),
        };
        if (this.provider !== 'anthropic' && options?.tuning?.topP !== undefined) {
            common.topP = options.tuning.topP;
        }
        const { object } = await unsafeGenerateObject(common);
        return object;
    }
    providerOptionsForCall() {
        if (this.provider !== 'anthropic')
            return undefined;
        if (process.env.CANVAS_AGENT_DISABLE_PROMPT_CACHE === '1')
            return undefined;
        const ttl = process.env.ANTHROPIC_CACHE_TTL === '5m' ? '5m' : process.env.ANTHROPIC_CACHE_TTL === '1h' ? '1h' : undefined;
        return {
            anthropic: {
                cacheControl: ttl ? { type: 'ephemeral', ttl } : { type: 'ephemeral' },
            },
        };
    }
}
class FakeProvider {
    constructor() {
        this.name = 'debug/fake';
    }
    async *stream(_prompt, _options) {
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
        yield { type: 'json', data: { actions: [rect] } };
    }
    async streamStructured(_prompt, _options) {
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
const registry = new Map();
const registerProvider = (key, provider, modelId) => {
    if (!registry.has(key)) {
        registry.set(key, new AiSdkProvider(provider, modelId));
    }
};
// Initialize commonly used providers using Vercel AI SDK
const bootstrapProviders = () => {
    if (process.env.ANTHROPIC_API_KEY) {
        registerProvider('anthropic:claude-sonnet-4-5', 'anthropic', 'claude-sonnet-4-5');
        registerProvider('anthropic:claude-haiku-4-5', 'anthropic', 'claude-haiku-4-5');
        registry.set('anthropic', registry.get('anthropic:claude-sonnet-4-5'));
    }
    if (process.env.OPENAI_API_KEY) {
        registerProvider('openai:gpt-5', 'openai', 'gpt-5');
        registerProvider('openai:gpt-5-mini', 'openai', 'gpt-5-mini');
        registry.set('openai', registry.get('openai:gpt-5'));
    }
    registry.set('debug/fake', new FakeProvider());
};
const ensureDynamicProvider = (name) => {
    const trimmed = name.trim();
    if (!trimmed)
        return null;
    if (registry.has(trimmed))
        return registry.get(trimmed);
    const create = (provider, modelId, key) => {
        const hasAuth = provider === 'anthropic' ? !!process.env.ANTHROPIC_API_KEY : !!process.env.OPENAI_API_KEY;
        if (!hasAuth)
            return null;
        const registryKey = key ?? `${provider}:${modelId}`;
        registerProvider(registryKey, provider, modelId);
        return registry.get(registryKey) ?? null;
    };
    if (trimmed.includes(':')) {
        const [providerAlias, ...rest] = trimmed.split(':');
        const modelId = rest.join(':');
        if (!modelId)
            return null;
        if (providerAlias === 'anthropic')
            return create('anthropic', modelId, trimmed);
        if (providerAlias === 'openai')
            return create('openai', modelId, trimmed);
        return null;
    }
    if (trimmed.startsWith('claude'))
        return create('anthropic', trimmed, `anthropic:${trimmed}`);
    if (trimmed.startsWith('gpt'))
        return create('openai', trimmed, `openai:${trimmed}`);
    return null;
};
bootstrapProviders();
export function selectModel(preferred) {
    const envPreferred = preferred?.trim() || process.env.CANVAS_STEWARD_MODEL || 'debug/fake';
    const resolved = ensureDynamicProvider(envPreferred);
    if (resolved)
        return resolved;
    if (process.env.CANVAS_STEWARD_MODEL) {
        const secondary = ensureDynamicProvider(process.env.CANVAS_STEWARD_MODEL);
        if (secondary)
            return secondary;
    }
    if (registry.get('anthropic'))
        return registry.get('anthropic');
    if (registry.get('openai'))
        return registry.get('openai');
    return registry.get('debug/fake');
}
//# sourceMappingURL=models.js.map