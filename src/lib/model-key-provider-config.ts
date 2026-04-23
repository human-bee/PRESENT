import {
  MODEL_KEY_PROVIDERS,
  type ModelKeyProvider,
} from '@/lib/agents/shared/user-model-keys';

export type ModelKeyProviderConfig = {
  id: ModelKeyProvider;
  label: string;
  required: boolean;
  helpUrl: string;
  note: string;
};

const providerConfigById: Record<ModelKeyProvider, Omit<ModelKeyProviderConfig, 'id'>> = {
  openai: {
    label: 'OpenAI',
    required: true,
    helpUrl: 'https://platform.openai.com/api-keys',
    note: 'Required for voice + most stewards.',
  },
  anthropic: {
    label: 'Anthropic',
    required: false,
    helpUrl: 'https://console.anthropic.com/settings/keys',
    note: 'Optional (Claude models).',
  },
  google: {
    label: 'Google (Gemini)',
    required: false,
    helpUrl: 'https://aistudio.google.com/app/apikey',
    note: 'Optional (Gemini image model / AI Studio).',
  },
  together: {
    label: 'Together AI',
    required: false,
    helpUrl: 'https://api.together.ai/settings/api-keys',
    note: 'Optional legacy provider for older routing paths. Not used by the current image widget.',
  },
  cerebras: {
    label: 'Cerebras',
    required: false,
    helpUrl: 'https://cloud.cerebras.ai/',
    note: 'Optional (FAST stewards + router).',
  },
  fal: {
    label: 'fal',
    required: false,
    helpUrl: 'https://fal.ai/dashboard/keys',
    note: 'Optional (FLUX.2 Flash image generation).',
  },
  xai: {
    label: 'xAI',
    required: false,
    helpUrl: 'https://console.x.ai/',
    note: 'Optional (Grok image generation).',
  },
};

const providerUiPriority: Partial<Record<ModelKeyProvider, number>> = {
  openai: 0,
  anthropic: 1,
  google: 2,
  together: 3,
  fal: 4,
  xai: 5,
  cerebras: 6,
};

export const MODEL_KEY_PROVIDER_UI_ORDER: ModelKeyProvider[] = [...MODEL_KEY_PROVIDERS].sort(
  (left, right) =>
    (providerUiPriority[left] ?? Number.MAX_SAFE_INTEGER) -
      (providerUiPriority[right] ?? Number.MAX_SAFE_INTEGER) ||
    left.localeCompare(right),
);

export const MODEL_KEY_PROVIDER_CONFIGS: ModelKeyProviderConfig[] =
  MODEL_KEY_PROVIDER_UI_ORDER.map((id) => ({
    id,
    ...providerConfigById[id],
  }));

export function buildProviderStateMap<T>(
  factory: (provider: ModelKeyProvider) => T,
): Record<ModelKeyProvider, T> {
  return MODEL_KEY_PROVIDERS.reduce(
    (acc, provider) => {
      acc[provider] = factory(provider);
      return acc;
    },
    {} as Record<ModelKeyProvider, T>,
  );
}
