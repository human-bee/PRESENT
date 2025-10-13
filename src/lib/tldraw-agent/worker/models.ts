export const DEFAULT_MODEL_NAME = 'gpt-4.1'

export type AgentModelName = keyof typeof AGENT_MODEL_DEFINITIONS
export type AgentModelProvider = 'openai'

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
	'gpt-4o': {
		name: 'gpt-4o',
		id: 'gpt-4o',
		provider: 'openai',
	},
	'gpt-4.1': {
		name: 'gpt-4.1',
		id: 'gpt-4.1-mini',
		provider: 'openai',
	},
} as const
