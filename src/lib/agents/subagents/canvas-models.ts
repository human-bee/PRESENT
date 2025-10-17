import { z } from 'zod';

export const CANVAS_STEWARD_MODEL_ENV = 'CANVAS_STEWARD_MODEL';

const canvasModelNameSchema = z.enum(
  [
    'claude-haiku-4-5',
    'claude-4.5-sonnet',
    'claude-4-sonnet',
    'claude-3.5-sonnet',
    'gpt-4.1',
    'gpt-4o',
  ] as const,
);

export type CanvasModelName = z.infer<typeof canvasModelNameSchema>;
export type CanvasModelProvider = 'anthropic' | 'openai';

export interface CanvasModelDefinition {
  name: CanvasModelName;
  id: string;
  provider: CanvasModelProvider;
  thinking?: boolean;
}

const CANVAS_MODEL_DEFINITIONS: Record<CanvasModelName, CanvasModelDefinition> = {
  'claude-haiku-4-5': {
    name: 'claude-haiku-4-5',
    id: 'claude-haiku-4-5-20251001',
    provider: 'anthropic',
  },
  'claude-4.5-sonnet': {
    name: 'claude-4.5-sonnet',
    id: 'claude-sonnet-4-5',
    provider: 'anthropic',
  },
  'claude-4-sonnet': {
    name: 'claude-4-sonnet',
    id: 'claude-sonnet-4-0',
    provider: 'anthropic',
  },
  'claude-3.5-sonnet': {
    name: 'claude-3.5-sonnet',
    id: 'claude-3-5-sonnet-latest',
    provider: 'anthropic',
  },
  'gpt-4.1': {
    name: 'gpt-4.1',
    id: 'gpt-4.1-mini',
    provider: 'openai',
  },
  'gpt-4o': {
    name: 'gpt-4o',
    id: 'gpt-4o',
    provider: 'openai',
  },
};

const MODEL_ID_TO_NAME = Object.values(CANVAS_MODEL_DEFINITIONS).reduce<Map<string, CanvasModelName>>(
  (acc, definition) => {
    acc.set(definition.id.toLowerCase(), definition.name);
    return acc;
  },
  new Map(),
);

const DEFAULT_CANVAS_MODEL: CanvasModelName = 'claude-haiku-4-5';

export function getCanvasModelDefinition(modelName: CanvasModelName): CanvasModelDefinition {
  return CANVAS_MODEL_DEFINITIONS[modelName];
}

export function resolveCanvasModelName(options?: {
  explicit?: unknown;
  allowOverride?: boolean;
}): CanvasModelName {
  const { explicit, allowOverride } = options ?? {};

  const envModel = parseCanvasModelName(process.env[CANVAS_STEWARD_MODEL_ENV]);

  if (allowOverride) {
    const overrideModel = parseCanvasModelName(explicit);
    if (overrideModel) {
      return overrideModel;
    }
  }

  if (envModel) {
    return envModel;
  }

  if (allowOverride) {
    const fallback = parseCanvasModelName(explicit);
    if (fallback) return fallback;
  }

  return DEFAULT_CANVAS_MODEL;
}

function parseCanvasModelName(raw: unknown): CanvasModelName | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const normalized = trimmed.replace(/\s+/g, '').toLowerCase();
  const withoutPrefix = normalized.replace(/^(anthropic|openai|google)[:/]/, '');

  const direct = tryParseName(withoutPrefix);
  if (direct) return direct;

  const idMatch = MODEL_ID_TO_NAME.get(withoutPrefix);
  if (idMatch) return idMatch;

  return null;
}

function tryParseName(value: string): CanvasModelName | null {
  try {
    return canvasModelNameSchema.parse(value) as CanvasModelName;
  } catch {
    return null;
  }
}
