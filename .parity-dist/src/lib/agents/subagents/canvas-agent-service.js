import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI, } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import { generateObject } from 'ai';
import { z } from 'zod';
import { jsonValueSchema } from '@/lib/utils/json-schema';
import { getCanvasModelDefinition } from './canvas-models';
const canvasActionSchema = z.object({
    tool: z
        .string()
        .min(1)
        .regex(/^canvas_[\w.-]+$/i, 'Canvas tools must start with canvas_'),
    params: z.record(jsonValueSchema).default({}),
    rationale: z.string().optional(),
});
const canvasPlanSchema = z.object({
    actions: z.array(canvasActionSchema).min(1, 'At least one tool action is required'),
    summary: z.string().min(1, 'Provide a short summary for the user'),
});
const canvasPlanRuntimeSchema = canvasPlanSchema;
const CANVAS_STEWARD_DEBUG = process.env.CANVAS_STEWARD_DEBUG === 'true';
const debugLog = (...args) => {
    if (CANVAS_STEWARD_DEBUG) {
        try {
            console.log('[CanvasAgentService]', ...args);
        }
        catch { }
    }
};
const debugJson = (label, value, max = 2000) => {
    if (!CANVAS_STEWARD_DEBUG)
        return;
    try {
        const json = JSON.stringify(value, null, 2);
        debugLog(label, json.length > max ? `${json.slice(0, max)}… (truncated ${json.length - max} chars)` : json);
    }
    catch (error) {
        debugLog(label, value);
    }
};
const unsafeGenerateObject = generateObject;
export class CanvasAgentService {
    constructor(env) {
        const openaiKey = env?.OPENAI_API_KEY ?? process.env.OPENAI_API_KEY;
        const anthropicKey = env?.ANTHROPIC_API_KEY ?? process.env.ANTHROPIC_API_KEY;
        const googleKey = env?.GOOGLE_API_KEY ?? process.env.GOOGLE_API_KEY;
        this.providers = {
            openai: openaiKey ? createOpenAI({ apiKey: openaiKey }) : null,
            anthropic: anthropicKey ? createAnthropic({ apiKey: anthropicKey }) : null,
            google: googleKey ? createGoogleGenerativeAI({ apiKey: googleKey }) : null,
        };
    }
    async generatePlan(request) {
        const { system, prompt, maxOutputTokens } = request;
        const { model, modelDefinition } = this.getModelWithFallback(request.modelName);
        debugLog('generatePlan.request', {
            requestedModel: request.modelName,
            resolvedModel: modelDefinition.name,
            provider: modelDefinition.provider,
            promptPreview: prompt.slice(0, 400),
        });
        debugJson('generatePlan.messages', {
            system,
            prompt,
        });
        const { object } = await unsafeGenerateObject({
            model,
            system,
            prompt,
            schema: canvasPlanRuntimeSchema,
            temperature: 0,
            maxOutputTokens: maxOutputTokens ?? 4096,
            providerOptions: buildProviderOptions(modelDefinition.provider),
        });
        if (!object) {
            throw new Error('Canvas steward produced no plan');
        }
        const parsed = canvasPlanSchema.parse(object);
        debugJson('generatePlan.rawObject', object);
        debugLog('generatePlan.response', {
            model: modelDefinition.name,
            actions: parsed.actions.length,
            summaryPreview: parsed.summary.slice(0, 160),
        });
        return {
            plan: sanitizeCanvasPlan(parsed),
            modelName: modelDefinition.name,
        };
    }
    getModelForStreaming(modelName) {
        const { model, modelDefinition } = this.getModelWithFallback(modelName);
        return {
            model,
            modelDefinition,
            providerOptions: buildProviderOptions(modelDefinition.provider),
        };
    }
    getModelWithFallback(preferredModel) {
        const orderedModels = getModelPreferenceList(preferredModel);
        for (const name of orderedModels) {
            const definition = getCanvasModelDefinition(name);
            const provider = this.providers[definition.provider];
            if (!provider)
                continue;
            return {
                model: provider(definition.id),
                modelDefinition: definition,
            };
        }
        throw new Error('No configured model provider available for canvas steward');
    }
}
function sanitizeCanvasPlan(plan) {
    return {
        summary: plan.summary.trim(),
        actions: plan.actions.map((action) => ({
            tool: action.tool.trim(),
            params: sanitizeParams(action.params),
            rationale: action.rationale?.trim(),
        })),
    };
}
function sanitizeParams(params) {
    if (!params)
        return {};
    const parsed = z.record(jsonValueSchema).parse(params);
    return Object.fromEntries(Object.entries(parsed).map(([key, value]) => [key.trim(), value]));
}
function getModelPreferenceList(preferred) {
    const FALLBACK_ORDER = [
        'claude-sonnet-4-5',
        'claude-haiku-4-5',
        'gpt-5',
        'gpt-5-mini',
    ];
    return [preferred, ...FALLBACK_ORDER.filter((name) => name !== preferred)];
}
function buildProviderOptions(provider) {
    if (provider === 'anthropic') {
        const options = {
            anthropic: {
                thinking: { type: 'disabled' },
            },
        };
        return options;
    }
    if (provider === 'google') {
        const options = {
            google: {
                thinkingConfig: { thinkingBudget: 0 },
            },
        };
        return options;
    }
    return undefined;
}
let singleton = null;
export function getCanvasAgentService() {
    if (!singleton) {
        singleton = new CanvasAgentService();
    }
    return singleton;
}
//# sourceMappingURL=canvas-agent-service.js.map