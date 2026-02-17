type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type JsonDisplayMode = 'pretty' | 'raw';

const SENSITIVE_KEY_PATTERN =
  /(token|secret|password|authorization|api[_-]?key|cookie|session|jwt|signature|email|phone)/i;
const BEARER_TOKEN_PATTERN = /bearer\s+[a-z0-9._-]+/i;

const maskStringValue = (value: string): string => {
  if (value.length === 0) return value;
  if (BEARER_TOKEN_PATTERN.test(value)) {
    return '[masked-bearer]';
  }
  if (value.includes('@')) {
    return '[masked-email]';
  }
  if (value.length > 80) {
    return `[masked:${value.length}]`;
  }
  return '[masked]';
};

const maskValue = (value: unknown, keyHint?: string): JsonValue => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (keyHint && SENSITIVE_KEY_PATTERN.test(keyHint)) {
      return maskStringValue(value);
    }
    if (BEARER_TOKEN_PATTERN.test(value)) {
      return '[masked-bearer]';
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => maskValue(item));
  }
  if (typeof value === 'object') {
    const output: { [key: string]: JsonValue } = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEY_PATTERN.test(key)) {
        if (typeof nested === 'string') {
          output[key] = maskStringValue(nested);
        } else if (nested === null || nested === undefined) {
          output[key] = null;
        } else if (typeof nested === 'number' || typeof nested === 'boolean') {
          output[key] = '[masked]';
        } else {
          output[key] = '[masked-object]';
        }
      } else {
        output[key] = maskValue(nested, key);
      }
    }
    return output;
  }
  return String(value);
};

export const maskSensitiveJson = (value: unknown): JsonValue => maskValue(value);

export const formatJsonForDisplay = (
  value: unknown,
  options?: { mode?: JsonDisplayMode; maskSensitive?: boolean },
): string => {
  const mode = options?.mode === 'raw' ? 'raw' : 'pretty';
  const maskedValue = options?.maskSensitive === false ? value : maskSensitiveJson(value);
  try {
    return mode === 'raw'
      ? JSON.stringify(maskedValue)
      : JSON.stringify(maskedValue, null, 2);
  } catch {
    return mode === 'raw' ? String(maskedValue) : JSON.stringify(String(maskedValue));
  }
};
