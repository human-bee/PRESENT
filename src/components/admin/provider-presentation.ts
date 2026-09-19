import type { AgentProvider } from './types';

export const AGENT_PROVIDER_LABELS: Record<AgentProvider, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  google: 'Google',
  cerebras: 'Cerebras',
  together: 'Together',
  fal: 'fal',
  xai: 'xAI',
  debug: 'Debug',
  unknown: 'Unknown',
};

export const AGENT_PROVIDER_ORDER: AgentProvider[] = [
  'openai',
  'anthropic',
  'google',
  'cerebras',
  'together',
  'fal',
  'xai',
  'debug',
  'unknown',
];

export const AGENT_PROVIDER_FILTER_OPTIONS: Array<{
  value: AgentProvider;
  label: string;
}> = AGENT_PROVIDER_ORDER.map((provider) => ({
  value: provider,
  label: AGENT_PROVIDER_LABELS[provider],
}));

export function sortAgentProviderEntries<T>(
  entries: Array<[string, T]>,
): Array<[string, T]> {
  return [...entries].sort(([left], [right]) => {
    const leftIndex = AGENT_PROVIDER_ORDER.indexOf(left as AgentProvider);
    const rightIndex = AGENT_PROVIDER_ORDER.indexOf(right as AgentProvider);
    const normalizedLeft = leftIndex === -1 ? Number.MAX_SAFE_INTEGER : leftIndex;
    const normalizedRight = rightIndex === -1 ? Number.MAX_SAFE_INTEGER : rightIndex;
    if (normalizedLeft !== normalizedRight) return normalizedLeft - normalizedRight;
    return left.localeCompare(right);
  });
}
