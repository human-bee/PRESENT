import { getDefaultModelName, type AgentModelName } from '@tldraw/fairy-shared/models';
import { getAgentModelDefinition } from './models';

export interface FairyUserStub {
  fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
}

export interface FairyWorkerEnv {
  OPENAI_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  GOOGLE_API_KEY?: string;
  FAIRY_MODEL?: string;
  IS_LOCAL?: string;
}

type FairyProvider = 'openai' | 'anthropic' | 'google';

const PROVIDER_ENV_KEYS: Record<FairyProvider, keyof FairyWorkerEnv> = {
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  google: 'GOOGLE_API_KEY',
};

export function getRequiredProviderEnvKey(modelName: AgentModelName): keyof FairyWorkerEnv {
  const provider = getAgentModelDefinition(modelName).provider as FairyProvider;
  return PROVIDER_ENV_KEYS[provider];
}

export function getFairyConfigurationError(
  env: FairyWorkerEnv,
  modelName?: AgentModelName,
): string | null {
  const resolvedModel = modelName ?? getDefaultModelName({ FAIRY_MODEL: env.FAIRY_MODEL });
  const requiredKey = getRequiredProviderEnvKey(resolvedModel);
  const value = env[requiredKey];
  if (typeof value === 'string' && value.trim().length > 0) {
    return null;
  }
  return `Fairy model "${resolvedModel}" requires ${requiredKey} to be configured.`;
}
