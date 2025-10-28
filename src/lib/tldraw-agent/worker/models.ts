export const DEFAULT_MODEL_NAME = 'claude-haiku-4-5'

export type AgentModelName = keyof typeof AGENT_MODEL_DEFINITIONS
export type AgentModelProvider = 'openai' | 'anthropic'

export interface AgentModelDefinition {
	name: AgentModelName
	id: string
	provider: AgentModelProvider

	// Overrides the default thinking behavior for that provider
	thinking?: boolean
}

/**
 * Get the full information about a model from its name.
 * @param modelName - The name of the model.
 * @returns The full definition of the model.
 */
export function getAgentModelDefinition(modelName: AgentModelName): AgentModelDefinition {
	const definition = AGENT_MODEL_DEFINITIONS[modelName]
	if (!definition) {
		throw new Error(`Model ${modelName} not found`)
	}
	return definition
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
} as const
