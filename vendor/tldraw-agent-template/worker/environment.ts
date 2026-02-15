type DurableObjectNamespace = any

export interface Environment {
	AGENT_DURABLE_OBJECT: DurableObjectNamespace
	OPENAI_API_KEY: string
	ANTHROPIC_API_KEY: string
	GOOGLE_API_KEY: string
	AGENT_STREAM_IDLE_TIMEOUT_MS?: string
	AGENT_STREAM_MAX_DURATION_MS?: string
}
