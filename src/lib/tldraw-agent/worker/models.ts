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
} as const
