import { createAnthropic, type AnthropicProvider, type AnthropicProviderOptions } from '@ai-sdk/anthropic';
import {
	createGoogleGenerativeAI,
	type GoogleGenerativeAIProvider,
	type GoogleGenerativeAIProviderOptions,
} from '@ai-sdk/google';
import { createOpenAI, type OpenAIProvider } from '@ai-sdk/openai';
import { generateObject, type LanguageModel } from 'ai';
import type { ProviderOptions } from '@ai-sdk/provider-utils';
import { z } from 'zod';
import { jsonValueSchema, type JsonObject, type JsonValue } from '@/lib/utils/json-schema';
import {
	getCanvasModelDefinition,
	resolveCanvasModelName,
	type CanvasModelDefinition,
	type CanvasModelName,
} from './canvas-models';

const canvasActionSchema = z.object({
	tool: z
		.string()
		.min(1)
		.refine(
			(value) => value.trim().toLowerCase().startsWith('canvas_'),
			'Canvas tools must start with canvas_',
		),
  params: z.record(z.string(), jsonValueSchema).default({}),
	rationale: z.string().optional(),
});

export type CanvasAction = z.infer<typeof canvasActionSchema>;

const canvasPlanSchema = z.object({
	actions: z.array(canvasActionSchema).min(1, 'At least one tool action is required'),
	summary: z.string().min(1, 'Provide a short summary for the user'),
});

const canvasPlanRuntimeSchema = canvasPlanSchema as z.ZodTypeAny;

export type CanvasPlan = z.infer<typeof canvasPlanSchema>;

type ProviderKind = 'openai' | 'anthropic' | 'google';

type ProviderMap = {
	openai: OpenAIProvider | null;
	anthropic: AnthropicProvider | null;
	google: GoogleGenerativeAIProvider | null;
};

const PROVIDER_ENV_KEYS: Record<ProviderKind, string> = {
	openai: 'OPENAI_API_KEY',
	anthropic: 'ANTHROPIC_API_KEY',
	google: 'GOOGLE_API_KEY',
};

const CANVAS_STEWARD_DEBUG = process.env.CANVAS_STEWARD_DEBUG === 'true';
const debugLog = (...args: unknown[]) => {
	if (CANVAS_STEWARD_DEBUG) {
		try {
			console.log('[CanvasAgentService]', ...args);
		} catch {}
	}
};
const debugJson = (label: string, value: unknown, max = 2000) => {
	if (!CANVAS_STEWARD_DEBUG) return;
	try {
		const json = JSON.stringify(value, null, 2);
		debugLog(label, json.length > max ? `${json.slice(0, max)}… (truncated ${json.length - max} chars)` : json);
	} catch (_error) {
		debugLog(label, value);
	}
};

const unsafeGenerateObject = generateObject as unknown as (args: any) => Promise<{ object: any }>;

export interface CanvasPlanRequest {
	modelName: CanvasModelName;
	system: string;
	prompt: string;
	maxOutputTokens?: number;
}

export class CanvasAgentService {
	private providers: ProviderMap;

	constructor(env?: Partial<Record<'OPENAI_API_KEY' | 'ANTHROPIC_API_KEY' | 'GOOGLE_API_KEY', string>>) {
		const openaiKey = env?.OPENAI_API_KEY ?? process.env.OPENAI_API_KEY;
		const anthropicKey = env?.ANTHROPIC_API_KEY ?? process.env.ANTHROPIC_API_KEY;
		const googleKey = env?.GOOGLE_API_KEY ?? process.env.GOOGLE_API_KEY;

		this.providers = {
			openai: openaiKey ? createOpenAI({ apiKey: openaiKey }) : null,
			anthropic: anthropicKey ? createAnthropic({ apiKey: anthropicKey }) : null,
			google: googleKey ? createGoogleGenerativeAI({ apiKey: googleKey }) : null,
		};
	}

	async generatePlan(request: CanvasPlanRequest): Promise<{ plan: CanvasPlan; modelName: CanvasModelName }> {
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

	getModelForStreaming(modelName: CanvasModelName) {
		const { model, modelDefinition } = this.getModelWithFallback(modelName);
		return {
			model,
			modelDefinition,
			providerOptions: buildProviderOptions(modelDefinition.provider),
		};
	}

	private getModelWithFallback(preferredModel: CanvasModelName): {
		model: LanguageModel;
		modelDefinition: CanvasModelDefinition;
	} {
		const orderedModels = getModelPreferenceList(preferredModel);
		if (!this.hasAnyProvider()) {
			throw new Error(
				`No canvas model providers configured. Set at least one of: ${Object.values(PROVIDER_ENV_KEYS).join(', ')}`,
			);
		}

		for (const name of orderedModels) {
			const definition = getCanvasModelDefinition(name);
			const provider = this.providers[definition.provider as ProviderKind];
			if (!provider) continue;
			return {
				model: provider(definition.id),
				modelDefinition: definition,
			};
		}

		const preferredProvider = getCanvasModelDefinition(preferredModel).provider as ProviderKind;
		const requiredKey = PROVIDER_ENV_KEYS[preferredProvider];
		throw new Error(
			`Canvas model "${preferredModel}" requires ${requiredKey}; no compatible fallback provider is configured.`,
		);
	}

	assertConfiguration(preferredModel: CanvasModelName): void {
		if (!this.hasAnyProvider()) {
			throw new Error(
				`No canvas model providers configured. Set at least one of: ${Object.values(PROVIDER_ENV_KEYS).join(', ')}`,
			);
		}
		const preferredProvider = getCanvasModelDefinition(preferredModel).provider as ProviderKind;
		if (!this.providers[preferredProvider]) {
			const requiredKey = PROVIDER_ENV_KEYS[preferredProvider];
			debugLog('configuration.warning', {
				preferredModel,
				missingKey: requiredKey,
				fallbackProviders: Object.entries(this.providers)
					.filter(([, provider]) => Boolean(provider))
					.map(([name]) => name),
			});
		}
	}

	private hasAnyProvider(): boolean {
		return Object.values(this.providers).some(Boolean);
	}
}

function sanitizeCanvasPlan(plan: CanvasPlan): CanvasPlan {
	return {
		summary: plan.summary.trim(),
		actions: plan.actions.map((action) => ({
			tool: action.tool.trim(),
			params: sanitizeParams(action.params),
			rationale: action.rationale?.trim(),
		})),
	};
}

function sanitizeParams(params: JsonObject | undefined): JsonObject {
	if (!params) return {};
  const parsed = z.record(z.string(), jsonValueSchema).parse(params) as Record<string, JsonValue>;
	return Object.fromEntries(
		Object.entries(parsed).map(([key, value]) => [key.trim(), value]),
	);
}

function getModelPreferenceList(preferred: CanvasModelName): CanvasModelName[] {
  const FALLBACK_ORDER: CanvasModelName[] = [
    'claude-sonnet-4-5',
    'claude-haiku-4-5',
    'gpt-5',
    'gpt-5-mini',
  ];

	return [preferred, ...FALLBACK_ORDER.filter((name) => name !== preferred)];
}

function buildProviderOptions(provider: CanvasModelDefinition['provider']): ProviderOptions | undefined {
  if (provider === 'anthropic') {
    const options: ProviderOptions = {
      anthropic: {
        thinking: { type: 'disabled' },
      } satisfies AnthropicProviderOptions,
    };
    return options;
  }
  if (provider === 'google') {
    const options: ProviderOptions = {
      google: {
        thinkingConfig: { thinkingBudget: 0 },
      } satisfies GoogleGenerativeAIProviderOptions,
    };
    return options;
  }
  return undefined;
}

let singleton: CanvasAgentService | null = null;
export function getCanvasAgentService() {
	if (!singleton) {
		singleton = new CanvasAgentService();
	}
	singleton.assertConfiguration(resolveCanvasModelName());
	return singleton;
}
