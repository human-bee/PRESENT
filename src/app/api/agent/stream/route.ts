import { NextRequest } from 'next/server'
import { streamText, type CoreMessage } from 'ai'
import type { AgentStreamPayload } from '@/lib/tldraw-agent/shared/types/AgentStreamPayload'
import { getAgentModelDefinition } from '@/lib/tldraw-agent/worker/models'
import { closeAndParseJson } from '@/lib/tldraw-agent/worker/do/closeAndParseJson'
import { getCanvasAgentService } from '@/lib/agents/subagents/canvas-agent-service'
import { resolveCanvasModelName } from '@/lib/agents/subagents/canvas-models'

const isDevEnv = process.env.NODE_ENV !== 'production'
const CANVAS_STEWARD_DEBUG = process.env.CANVAS_STEWARD_DEBUG === 'true'
const debugLog = (...args: unknown[]) => {
	if (CANVAS_STEWARD_DEBUG) {
		try {
			console.log('[AgentStream]', ...args)
		} catch {}
	}
}

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
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

	let service
	try {
		service = getCanvasAgentService()
	} catch (error: any) {
		return jsonError(error?.message ?? 'Canvas agent service is not configured', 503)
	}

	const requestedDefinition = getAgentModelDefinition(modelName)
	const desiredModel = resolveCanvasModelName({
		explicit: requestedDefinition.name,
		allowOverride: true,
	})
	const { model, modelDefinition, providerOptions } = service.getModelForStreaming(desiredModel)
	debugLog('stream.start', {
		requestedModel: modelName,
		resolvedModel: modelDefinition.name,
		provider: modelDefinition.provider,
		messageCount: messages.length,
	})

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
					model,
					system,
					messages: conversation,
					maxOutputTokens: 8_192,
					temperature: 0,
					providerOptions,
					response:
						modelDefinition.provider === 'openai' && responseSchema
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
						debugLog('stream.error', error instanceof Error ? error.message : error)
						throw error
					},
				})

				const providerId = (model as { provider?: string } | undefined)?.provider ?? ''
				const canForceResponseStart =
					providerId === 'anthropic.messages' || providerId === 'google.generative-ai'

				let buffer = canForceResponseStart ? '{"actions": [{"_type":' : ''
				let cursor = 0
				let maybeIncompleteAction: Record<string, unknown> | null = null
				let startTime = Date.now()
				let emittedChunks = 0

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
							emittedChunks += 1
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
					emittedChunks += 1
				}

				if (maybeIncompleteAction) {
					controller.enqueue(encoder.encode(makeChunk(maybeIncompleteAction, true, startTime)))
					emittedChunks += 1
				}

				if (emittedChunks === 0) {
					const preview = buffer.slice(0, 2_000)
					debugLog('stream.noActions', {
						model: modelDefinition.name,
						bufferPreview: preview,
						bufferLength: buffer.length,
					})
					const errChunk = `data: ${JSON.stringify({
						error: 'Canvas agent did not return any actions',
					})}\n\n`
					controller.enqueue(encoder.encode(errChunk))
				}

				controller.close()
			} catch (error: any) {
				debugLog('stream.exception', error?.message ?? error)
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
	debugLog('stream.chunk', { complete, time: payload.time, keys: Object.keys(action) })
	return `data: ${JSON.stringify(payload)}\n\n`
}

function jsonError(message: string, status: number) {
	return new Response(JSON.stringify({ error: message }), {
		status,
		headers: { 'Content-Type': 'application/json' },
	})
}
