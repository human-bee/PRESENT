import { createAnthropic, type AnthropicProvider, type AnthropicProviderOptions } from '@ai-sdk/anthropic';
import {
  createGoogleGenerativeAI,
  type GoogleGenerativeAIProvider,
  type GoogleGenerativeAIProviderOptions,
} from '@ai-sdk/google';
import { createOpenAI, type OpenAIProvider } from '@ai-sdk/openai';
import { generateObject, type LanguageModel } from 'ai';
import { z } from 'zod';
import { jsonValueSchema, type JsonObject, type JsonValue } from '@/lib/utils/json-schema';
import { getCanvasModelDefinition, type CanvasModelName } from './canvas-models';

const canvasActionSchema = z.object({
  tool: z
    .string()
    .min(1)
    .regex(/^canvas_[\w.-]+$/i, 'Canvas tools must start with canvas_'),
  params: z.record(jsonValueSchema).default({}),
  rationale: z.string().optional(),
});

export type CanvasAction = z.infer<typeof canvasActionSchema>;

const canvasPlanSchema = z.object({
  actions: z.array(canvasActionSchema).min(1, 'At least one tool action is required'),
  summary: z.string().min(1, 'Provide a short summary for the user'),
});

export type CanvasPlan = z.infer<typeof canvasPlanSchema>;

type ProviderKind = 'openai' | 'anthropic' | 'google';

type ProviderMap = {
  openai: OpenAIProvider | null;
  anthropic: AnthropicProvider | null;
  google: GoogleGenerativeAIProvider | null;
};

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

  async generatePlan(request: CanvasPlanRequest): Promise<CanvasPlan> {
    const { modelName, system, prompt } = request;
    const model = this.getModel(modelName);

    const { object } = await generateObject({
      model,
      system,
      prompt,
      schema: canvasPlanSchema,
      temperature: 0,
      maxOutputTokens: request.maxOutputTokens ?? 4096,
      providerOptions: {
        anthropic: {
          thinking: { type: 'disabled' },
        } satisfies AnthropicProviderOptions,
        google: {
          thinkingConfig: { thinkingBudget: 0 },
        } satisfies GoogleGenerativeAIProviderOptions,
      },
    });

    if (!object) {
      throw new Error('Canvas steward produced no plan');
    }

    const parsed = canvasPlanSchema.parse(object);
    return sanitizeCanvasPlan(parsed);
  }

  private getModel(modelName: CanvasModelName): LanguageModel {
    const definition = getCanvasModelDefinition(modelName);
    const provider = this.providers[definition.provider as ProviderKind];
    if (!provider) {
      throw new Error(`Provider ${definition.provider} is not configured for canvas steward`);
    }
    return provider(definition.id);
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
  const parsed = z.record(jsonValueSchema).parse(params) as Record<string, JsonValue>;
  return Object.fromEntries(
    Object.entries(parsed).map(([key, value]) => [key.trim(), value]),
  );
}
