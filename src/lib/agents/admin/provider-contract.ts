export const AGENT_PROVIDER_VALUES = [
  'openai',
  'anthropic',
  'google',
  'cerebras',
  'together',
  'fal',
  'xai',
  'debug',
  'unknown',
] as const;

export type AgentProvider = (typeof AGENT_PROVIDER_VALUES)[number];

export const AGENT_PROVIDER_SOURCE_VALUES = [
  'explicit',
  'model_inferred',
  'runtime_selected',
  'task_params',
  'payload',
  'unknown',
] as const;

export type AgentProviderSource = (typeof AGENT_PROVIDER_SOURCE_VALUES)[number];

export const AGENT_PROVIDER_PATH_VALUES = [
  'primary',
  'fallback',
  'fast',
  'slow',
  'shadow',
  'teacher',
  'unknown',
] as const;

export type AgentProviderPath = (typeof AGENT_PROVIDER_PATH_VALUES)[number];
