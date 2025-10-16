import { NextRequest } from 'next/server'
import { createOpenAI } from '@ai-sdk/openai'
import { streamText, type CoreMessage } from 'ai'
import type { AgentStreamPayload } from '@/lib/tldraw-agent/shared/types/AgentStreamPayload'
import { getAgentModelDefinition } from '@/lib/tldraw-agent/worker/models'
import { closeAndParseJson } from '@/lib/tldraw-agent/worker/do/closeAndParseJson'

const openaiKey = process.env.OPENAI_API_KEY
const openai = openaiKey ? createOpenAI({ apiKey: openaiKey }) : null
const isDevEnv = process.env.NODE_ENV !== 'production'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
	if (!openai) {
		return jsonError('Missing OPENAI_API_KEY', 500)
	}

	let payload: AgentStreamPayload
	try {
		payload = (await req.json()) as AgentStreamPayload
	} catch {
		return jsonError('Invalid JSON payload for agent stream', 400)
	}

	if (!payload || typeof payload !== 'object') {
		return jsonError('Invalid payload for agent stream', 400)
	}

	const { modelName, messages, system, responseSchema } = payload

	if (!modelName) {
		return jsonError('Missing modelName', 400)
	}

	if (!Array.isArray(messages) || messages.length === 0) {
		return jsonError('messages must be a non-empty array', 400)
	}

	const definition = getAgentModelDefinition(modelName)
	if (definition.provider !== 'openai') {
		return jsonError(`Unsupported model provider: ${definition.provider}`, 501)
	}

	const encoder = new TextEncoder()
	const stream = new ReadableStream<Uint8Array>({
		async start(controller) {
			try {
				const conversation: CoreMessage[] = messages.slice() as CoreMessage[]
				conversation.push({
					role: 'assistant',
					content: '{"actions": [{"_type":',
				} as CoreMessage)

				const { textStream } = streamText({
					model: openai(definition.id),
					system,
					messages: conversation,
					maxOutputTokens: 8_192,
					temperature: 0,
					response: responseSchema
						? {
								format: {
									type: 'json_schema',
									json_schema: {
										name: 'AgentResponse',
										strict: true,
										schema: responseSchema,
									},
								},
						  }
						: undefined,
					onError: (error) => {
						throw error
					},
				})

				let buffer = ''
				let cursor = 0
				let maybeIncompleteAction: Record<string, unknown> | null = null
				let startTime = Date.now()

				for await (const text of textStream) {
					buffer += text
					const partialObject = closeAndParseJson(buffer)
					if (!partialObject) continue

					const actions = partialObject.actions
					if (!Array.isArray(actions) || actions.length === 0) continue

					if (actions.length > cursor) {
						const baseCompleted = actions[cursor - 1] as Record<string, unknown> | undefined
						if (baseCompleted) {
							const completed = cloneAction(baseCompleted)
							controller.enqueue(encoder.encode(makeChunk(completed, true, startTime)))
							maybeIncompleteAction = null
						}
						cursor++
						startTime = Date.now()
					}

					const baseCurrent = actions[cursor - 1] as Record<string, unknown> | undefined
					if (!baseCurrent) {
						continue
					}

					const snapshot = cloneAction(baseCurrent)
					if (!maybeIncompleteAction) {
						startTime = Date.now()
					}
					maybeIncompleteAction = snapshot
					controller.enqueue(encoder.encode(makeChunk(snapshot, false, startTime)))
				}

				if (maybeIncompleteAction) {
					controller.enqueue(encoder.encode(makeChunk(maybeIncompleteAction, true, startTime)))
				}

				controller.close()
			} catch (error: any) {
				const errChunk = `data: ${JSON.stringify({ error: error?.message ?? 'Agent error' })}\n\n`
				controller.enqueue(encoder.encode(errChunk))
				controller.close()
			}
		},
	})

	return new Response(stream, {
		headers: {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache, no-transform',
			Connection: 'keep-alive',
			'X-Accel-Buffering': 'no',
		},
	})
}

function cloneAction(action: Record<string, unknown>) {
	return JSON.parse(JSON.stringify(action)) as Record<string, unknown>
}

function makeChunk(action: Record<string, unknown>, complete: boolean, startTime: number) {
	const payload = {
		...action,
		complete,
		time: Date.now() - startTime,
	}
	if (complete && isDevEnv) {
		try {
			console.log('[AgentStream] complete chunk', payload)
		} catch {}
	}
	return `data: ${JSON.stringify(payload)}\n\n`
}

function jsonError(message: string, status: number) {
	return new Response(JSON.stringify({ error: message }), {
		status,
		headers: { 'Content-Type': 'application/json' },
	})
}
