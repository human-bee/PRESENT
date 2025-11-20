import { normalizeCanvasModelName } from '@/lib/agents/subagents/canvas-models';
/**
 * Get the full information about a model from its name.
 * @param modelName - The name of the model.
 * @returns The full definition of the model.
 */
export function getAgentModelDefinition(modelName) {
    const definition = AGENT_MODEL_DEFINITIONS[modelName];
    if (!definition) {
        throw new Error(`Model ${modelName} not found`);
    }
    return definition;
}
export const AGENT_MODEL_DEFINITIONS = {
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
export const DEFAULT_MODEL_NAME = normalizeCanvasModelName(process.env.CANVAS_STEWARD_MODEL) ?? 'claude-sonnet-4-5';
//# sourceMappingURL=models.js.map