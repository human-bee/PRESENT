type JsonRecord = Record<string, unknown>;

export type AgentProvider =
  | 'openai'
  | 'anthropic'
  | 'google'
  | 'cerebras'
  | 'together'
  | 'debug'
  | 'unknown';

export type AgentProviderSource =
  | 'explicit'
  | 'model_inferred'
  | 'runtime_selected'
  | 'task_params'
  | 'payload'
  | 'unknown';

export type AgentProviderPath =
  | 'primary'
  | 'fallback'
  | 'fast'
  | 'slow'
  | 'shadow'
  | 'teacher'
  | 'unknown';

export type AgentProviderParity = {
  provider: AgentProvider;
  model: string | null;
  providerSource: AgentProviderSource;
  providerPath: AgentProviderPath;
  providerRequestId: string | null;
};

type ProviderParityInput = {
  provider?: unknown;
  model?: unknown;
  providerSource?: unknown;
  providerPath?: unknown;
  providerRequestId?: unknown;
  stage?: unknown;
  status?: unknown;
  task?: unknown;
  params?: unknown;
  payload?: unknown;
};

type ProviderLinkContext = {
  traceId?: string | null;
  requestId?: string | null;
  providerRequestId?: string | null;
  model?: string | null;
  room?: string | null;
  taskId?: string | null;
};

const PROVIDER_VALUES: AgentProvider[] = [
  'openai',
  'anthropic',
  'google',
  'cerebras',
  'together',
  'debug',
  'unknown',
];

const PROVIDER_SOURCE_VALUES: AgentProviderSource[] = [
  'explicit',
  'model_inferred',
  'runtime_selected',
  'task_params',
  'payload',
  'unknown',
];

const PROVIDER_PATH_VALUES: AgentProviderPath[] = [
  'primary',
  'fallback',
  'fast',
  'slow',
  'shadow',
  'teacher',
  'unknown',
];

const PROVIDER_LINK_TEMPLATE_ENV: Record<Exclude<AgentProvider, 'debug' | 'unknown'>, string> = {
  openai: 'AGENT_ADMIN_PROVIDER_LINK_TEMPLATE_OPENAI',
  anthropic: 'AGENT_ADMIN_PROVIDER_LINK_TEMPLATE_ANTHROPIC',
  cerebras: 'AGENT_ADMIN_PROVIDER_LINK_TEMPLATE_CEREBRAS',
  google: 'AGENT_ADMIN_PROVIDER_LINK_TEMPLATE_GOOGLE',
  together: 'AGENT_ADMIN_PROVIDER_LINK_TEMPLATE_TOGETHER',
};

const normalizeString = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const asRecord = (value: unknown): JsonRecord | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as JsonRecord;
};

const readString = (record: JsonRecord | null, key: string): string | null => {
  if (!record) return null;
  return normalizeString(record[key]);
};

const readNestedRecord = (record: JsonRecord | null, key: string): JsonRecord | null => {
  if (!record) return null;
  return asRecord(record[key]);
};

const normalizeProviderInternal = (value: unknown): AgentProvider | null => {
  const normalized = normalizeString(value)?.toLowerCase();
  if (!normalized) return null;
  if (PROVIDER_VALUES.includes(normalized as AgentProvider)) {
    return normalized as AgentProvider;
  }
  if (normalized === 'openai.responses' || normalized === 'openai.chat.completions') return 'openai';
  if (normalized === 'anthropic.messages') return 'anthropic';
  if (normalized === 'google.generative-ai' || normalized === 'gemini' || normalized === 'vertex_ai') {
    return 'google';
  }
  if (normalized.includes('cerebras')) return 'cerebras';
  if (normalized.includes('together')) return 'together';
  if (normalized.includes('debug') || normalized.includes('fake')) return 'debug';
  return null;
};

export const normalizeProvider = (value: unknown): AgentProvider => {
  return normalizeProviderInternal(value) ?? 'unknown';
};

export const normalizeProviderSource = (value: unknown): AgentProviderSource => {
  const normalized = normalizeString(value)?.toLowerCase();
  if (!normalized) return 'unknown';
  if (PROVIDER_SOURCE_VALUES.includes(normalized as AgentProviderSource)) {
    return normalized as AgentProviderSource;
  }
  return 'unknown';
};

export const normalizeProviderPath = (value: unknown): AgentProviderPath => {
  const normalized = normalizeString(value)?.toLowerCase();
  if (!normalized) return 'unknown';
  if (PROVIDER_PATH_VALUES.includes(normalized as AgentProviderPath)) {
    return normalized as AgentProviderPath;
  }
  return 'unknown';
};

export const inferProviderFromModel = (value: unknown): AgentProvider | null => {
  const normalized = normalizeString(value)?.toLowerCase();
  if (!normalized) return null;
  const withoutPrefix = normalized.replace(/^(openai|anthropic|google|cerebras|together)[:/]/, '');
  if (withoutPrefix.startsWith('gpt') || withoutPrefix.startsWith('o1') || withoutPrefix.startsWith('o3') || withoutPrefix.startsWith('o4')) {
    return 'openai';
  }
  if (withoutPrefix.startsWith('claude')) return 'anthropic';
  if (withoutPrefix.startsWith('gemini')) return 'google';
  if (
    withoutPrefix.startsWith('llama') ||
    withoutPrefix.startsWith('qwen') ||
    withoutPrefix.startsWith('gpt-oss')
  ) {
    return 'cerebras';
  }
  if (withoutPrefix.includes('flux') || withoutPrefix.includes('black-forest-labs/')) return 'together';
  if (withoutPrefix.startsWith('debug/') || withoutPrefix === 'fake') return 'debug';
  return normalizeProviderInternal(normalized);
};

const inferProviderPath = (input: ProviderParityInput): AgentProviderPath => {
  const fromStatus = normalizeString(input.status)?.toLowerCase() ?? '';
  const fromStage = normalizeString(input.stage)?.toLowerCase() ?? '';
  const fromTask = normalizeString(input.task)?.toLowerCase() ?? '';
  if (fromStatus.includes('fallback') || fromStage === 'fallback') return 'fallback';
  if (fromTask.includes('fast') || fromStatus.includes('fast')) return 'fast';
  if (fromTask.includes('shadow') || fromStatus.includes('shadow')) return 'shadow';
  if (fromTask.includes('teacher') || fromStatus.includes('teacher')) return 'teacher';
  return 'unknown';
};

const extractProviderRequestId = (
  payload: JsonRecord | null,
  params: JsonRecord | null,
  explicit: unknown,
): string | null => {
  const direct = normalizeString(explicit);
  if (direct) return direct;
  const payloadTrace = readNestedRecord(payload, '_trace');
  return (
    normalizeString(payload?.provider_request_id) ??
    normalizeString(payload?.providerRequestId) ??
    normalizeString(payload?.openaiResponseId) ??
    normalizeString(payload?.anthropicRequestId) ??
    normalizeString(payloadTrace?.providerRequestId) ??
    normalizeString(params?.provider_request_id) ??
    normalizeString(params?.providerRequestId) ??
    null
  );
};

export const deriveProviderParity = (input: ProviderParityInput): AgentProviderParity => {
  const payload = asRecord(input.payload);
  const params = asRecord(input.params);
  const payloadTrace = readNestedRecord(payload, '_trace');
  const payloadModelCtx = readNestedRecord(payload, 'model');

  const explicitProvider = normalizeProviderInternal(input.provider);
  const explicitModel = normalizeString(input.model);
  const explicitSource = normalizeProviderSource(input.providerSource);
  const explicitPath = normalizeProviderPath(input.providerPath);

  const paramsProvider =
    normalizeProviderInternal(params?.provider) ??
    normalizeProviderInternal(params?.providerName) ??
    normalizeProviderInternal(readNestedRecord(params, 'metadata')?.provider);
  const payloadProvider =
    normalizeProviderInternal(payload?.provider) ??
    normalizeProviderInternal(payload?.providerName) ??
    normalizeProviderInternal(payloadModelCtx?.provider) ??
    normalizeProviderInternal(payloadTrace?.provider);

  const paramsModel =
    normalizeString(params?.model) ??
    normalizeString(params?.modelName) ??
    normalizeString(readNestedRecord(params, 'metadata')?.model);
  const payloadModel =
    normalizeString(payload?.model) ??
    normalizeString(payload?.modelName) ??
    normalizeString(payloadModelCtx?.name) ??
    normalizeString(payloadTrace?.model);

  const candidateModel = explicitModel ?? paramsModel ?? payloadModel ?? null;
  const inferredFromModel = inferProviderFromModel(candidateModel);

  const provider =
    explicitProvider ??
    paramsProvider ??
    payloadProvider ??
    inferredFromModel ??
    'unknown';

  let providerSource: AgentProviderSource = 'unknown';
  if (explicitSource !== 'unknown') {
    providerSource = explicitSource;
  } else if (explicitProvider || explicitModel) {
    providerSource = explicitProvider ? 'explicit' : 'model_inferred';
  } else if (paramsProvider || paramsModel) {
    providerSource = paramsProvider ? 'task_params' : 'model_inferred';
  } else if (payloadProvider || payloadModel) {
    providerSource = payloadProvider ? 'payload' : 'model_inferred';
  }
  if (providerSource === 'unknown' && inferredFromModel) {
    providerSource = 'model_inferred';
  }

  let providerPath = explicitPath;
  if (providerPath === 'unknown') {
    providerPath =
      normalizeProviderPath(params?.provider_path) !== 'unknown'
        ? normalizeProviderPath(params?.provider_path)
        : normalizeProviderPath(params?.providerPath);
  }
  if (providerPath === 'unknown') {
    providerPath =
      normalizeProviderPath(payload?.provider_path) !== 'unknown'
        ? normalizeProviderPath(payload?.provider_path)
        : normalizeProviderPath(payload?.providerPath);
  }
  if (providerPath === 'unknown') {
    providerPath = inferProviderPath(input);
  }

  const providerRequestId = extractProviderRequestId(payload, params, input.providerRequestId);

  return {
    provider,
    model: candidateModel,
    providerSource,
    providerPath,
    providerRequestId,
  };
};

const interpolateTemplate = (template: string, context: ProviderLinkContext): string => {
  const replacements: Record<string, string> = {
    traceId: context.traceId ?? '',
    requestId: context.requestId ?? '',
    providerRequestId: context.providerRequestId ?? '',
    model: context.model ?? '',
    room: context.room ?? '',
    taskId: context.taskId ?? '',
  };
  return Object.entries(replacements).reduce((next, [key, value]) => {
    return next.split(`{${key}}`).join(encodeURIComponent(value));
  }, template);
};

const readProviderLinkTemplate = (provider: AgentProvider): string | null => {
  if (provider === 'debug' || provider === 'unknown') return null;
  const envKey = PROVIDER_LINK_TEMPLATE_ENV[provider];
  const value = normalizeString(process.env[envKey]);
  if (!value) return null;
  return value;
};

export const buildProviderLinkUrl = (
  provider: AgentProvider,
  context: ProviderLinkContext,
): string | null => {
  const template = readProviderLinkTemplate(provider);
  if (!template) return null;
  try {
    const rendered = interpolateTemplate(template, context);
    return new URL(rendered).toString();
  } catch {
    return null;
  }
};
