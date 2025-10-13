import type { CoreMessage } from 'ai'
import type { AgentModelName, AgentModelProvider } from '../../worker/models'

export interface AgentStreamPayload {
	modelName: AgentModelName
	modelId: string
	provider?: AgentModelProvider
	system?: string
	messages: CoreMessage[]
	responseSchema?: Record<string, unknown>
}
