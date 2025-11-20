import { z } from 'zod';
export const CANVAS_STEWARD_MODEL_ENV = 'CANVAS_STEWARD_MODEL';
const canvasModelNameSchema = z.enum([
    'claude-haiku-4-5',
    'claude-sonnet-4-5',
    'gpt-5',
    'gpt-5-mini',
]);
const MODEL_ALIASES = {
    'claude-sonnet-4-5': 'claude-sonnet-4-5',
    'claude-sonnet-4-5-20250929': 'claude-sonnet-4-5',
    'claude-4-5-sonnet': 'claude-sonnet-4-5',
    'claude-4.5-sonnet': 'claude-sonnet-4-5',
    'claude-4-sonnet': 'claude-sonnet-4-5',
    'claude-3.5-sonnet': 'claude-sonnet-4-5',
    'claude-3-5-sonnet': 'claude-sonnet-4-5',
    'claude-sonnet-3.5': 'claude-sonnet-4-5',
    'gpt-4o': 'gpt-5-mini',
    'gpt-4.1': 'gpt-5-mini',
};
const CANVAS_MODEL_DEFINITIONS = {
    'claude-haiku-4-5': {
        name: 'claude-haiku-4-5',
        id: 'claude-haiku-4-5-20251001',
        provider: 'anthropic',
    },
    'claude-sonnet-4-5': {
        name: 'claude-sonnet-4-5',
        id: 'claude-sonnet-4-5-20250929',
        provider: 'anthropic',
    },
    'gpt-5': {
        name: 'gpt-5',
        id: 'gpt-5',
        provider: 'openai',
    },
    'gpt-5-mini': {
        name: 'gpt-5-mini',
        id: 'gpt-5-mini',
        provider: 'openai',
    },
};
const MODEL_ID_TO_NAME = Object.values(CANVAS_MODEL_DEFINITIONS).reduce((acc, definition) => {
    acc.set(definition.id.toLowerCase(), definition.name);
    return acc;
}, new Map());
const DEFAULT_CANVAS_MODEL = 'claude-haiku-4-5';
export function getCanvasModelDefinition(modelName) {
    return CANVAS_MODEL_DEFINITIONS[modelName];
}
export function resolveCanvasModelName(options) {
    const { explicit, allowOverride } = options ?? {};
    const envModel = normalizeCanvasModelName(process.env[CANVAS_STEWARD_MODEL_ENV]);
    const explicitModel = normalizeCanvasModelName(explicit);
    if (envModel) {
        return envModel;
    }
    if (allowOverride === true && explicitModel) {
        return explicitModel;
    }
    return DEFAULT_CANVAS_MODEL;
}
export function normalizeCanvasModelName(raw) {
    if (typeof raw !== 'string')
        return null;
    const trimmed = raw.trim();
    if (!trimmed)
        return null;
    const normalized = trimmed.replace(/\s+/g, '').toLowerCase();
    const withoutPrefix = normalized.replace(/^(anthropic|openai|google)[:/]/, '');
    const alias = MODEL_ALIASES[withoutPrefix];
    if (alias)
        return alias;
    const direct = tryParseName(withoutPrefix);
    if (direct)
        return direct;
    const idMatch = MODEL_ID_TO_NAME.get(withoutPrefix);
    if (idMatch)
        return idMatch;
    return null;
}
function tryParseName(value) {
    try {
        return canvasModelNameSchema.parse(value);
    }
    catch {
        return null;
    }
}
//# sourceMappingURL=canvas-models.js.map