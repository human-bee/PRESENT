type RetryProvider = 'anthropic' | 'openai' | 'google' | 'generic';

const RETRYABLE_STATUS_CODES = new Set([408, 409, 425, 429, 500, 502, 503, 504, 529]);

export interface ProviderRetryContext {
  provider: RetryProvider;
  attempt: number;
  maxAttempts: number;
  delayMs: number;
  error: unknown;
}

export interface ProviderRetryOptions {
  provider?: RetryProvider;
  attempts?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  jitterRatio?: number;
  sleep?: (ms: number) => Promise<void>;
  onRetry?: (context: ProviderRetryContext) => void;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const safeJson = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

const coerceStatusCode = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const collectStatusCandidates = (error: unknown): unknown[] => {
  const raw = error as Record<string, unknown> | null | undefined;
  const cause = raw?.cause as Record<string, unknown> | null | undefined;
  const response = raw?.response as Record<string, unknown> | null | undefined;
  return [
    raw?.statusCode,
    raw?.status,
    raw?.code,
    cause?.statusCode,
    cause?.status,
    cause?.code,
    response?.statusCode,
    response?.status,
  ];
};

const collectErrorText = (error: unknown): string => {
  const raw = error as Record<string, unknown> | null | undefined;
  const cause = raw?.cause as Record<string, unknown> | null | undefined;
  const text = [
    raw?.message,
    raw?.detail,
    raw?.details,
    raw?.responseBody,
    raw?.body,
    raw?.data,
    cause?.message,
    cause?.detail,
    cause?.details,
    cause?.responseBody,
    cause?.body,
    cause?.data,
  ]
    .map(safeJson)
    .join(' ')
    .toLowerCase();

  return text;
};

export function isRetryableProviderError(
  error: unknown,
  options?: { provider?: RetryProvider },
): boolean {
  const provider = options?.provider ?? 'generic';
  for (const candidate of collectStatusCandidates(error)) {
    const status = coerceStatusCode(candidate);
    if (status !== null && RETRYABLE_STATUS_CODES.has(status)) {
      return true;
    }
  }

  const text = collectErrorText(error);
  if (!text) return false;

  if (
    text.includes('overloaded') ||
    text.includes('temporarily unavailable') ||
    text.includes('too many requests') ||
    text.includes('rate limit') ||
    text.includes('gateway timeout') ||
    text.includes('timed out') ||
    text.includes('timeout') ||
    text.includes('connection reset') ||
    text.includes('upstream connect error')
  ) {
    return true;
  }

  if (provider === 'anthropic' && text.includes('"code":529')) {
    return true;
  }

  return false;
}

export function describeRetryError(error: unknown): string {
  if (error instanceof Error) return error.message;
  const text = safeJson(error);
  return text.length > 300 ? `${text.slice(0, 300)}...` : text;
}

const clampNumber = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function parseRetryEnvInt(
  value: string | undefined,
  fallback: number,
  opts: { min?: number; max?: number } = {},
): number {
  const parsed = Number.parseInt(value ?? '', 10);
  const candidate = Number.isFinite(parsed) ? parsed : fallback;
  const min = opts.min ?? Number.MIN_SAFE_INTEGER;
  const max = opts.max ?? Number.MAX_SAFE_INTEGER;
  return clampNumber(candidate, min, max);
}

const computeDelayMs = (
  retryAttempt: number,
  options: Pick<ProviderRetryOptions, 'initialDelayMs' | 'maxDelayMs' | 'jitterRatio'>,
): number => {
  const initial = clampNumber(options.initialDelayMs ?? 250, 0, 60_000);
  const maxDelay = clampNumber(options.maxDelayMs ?? 4_000, 1, 120_000);
  const jitterRatio = clampNumber(options.jitterRatio ?? 0.2, 0, 0.95);
  const baseDelay = Math.min(maxDelay, initial * 2 ** Math.max(0, retryAttempt - 1));
  if (baseDelay <= 0 || jitterRatio <= 0) return Math.round(baseDelay);
  const jitter = baseDelay * jitterRatio;
  return Math.max(0, Math.round(baseDelay - jitter + Math.random() * jitter * 2));
};

export async function withProviderRetry<T>(
  operation: () => Promise<T>,
  options: ProviderRetryOptions = {},
): Promise<T> {
  const provider = options.provider ?? 'generic';
  const maxAttempts = clampNumber(options.attempts ?? 3, 1, 10);
  const sleep = options.sleep ?? defaultSleep;

  let attempt = 0;
  while (true) {
    try {
      return await operation();
    } catch (error) {
      attempt += 1;
      const shouldRetry =
        attempt < maxAttempts && isRetryableProviderError(error, { provider });
      if (!shouldRetry) {
        throw error;
      }
      const delayMs = computeDelayMs(attempt, options);
      options.onRetry?.({
        provider,
        attempt,
        maxAttempts,
        delayMs,
        error,
      });
      await sleep(delayMs);
    }
  }
}
