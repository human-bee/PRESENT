import type { BasePromptPart } from '@tldraw/fairy-shared/types/BasePromptPart'
import type { PromptPart } from '@tldraw/fairy-shared/types/PromptPart'

export type BaseAgentPrompt<T extends BasePromptPart = BasePromptPart> = Partial<{
	[P in T as P['type']]: P
}>

export type AgentPrompt = BaseAgentPrompt<PromptPart>
