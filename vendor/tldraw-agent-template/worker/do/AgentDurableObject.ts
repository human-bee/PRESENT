import { DurableObject } from 'cloudflare:workers'
import { AutoRouter, error } from 'itty-router'
import { AgentAction } from '../../shared/types/AgentAction'
import { AgentPrompt } from '../../shared/types/AgentPrompt'
import { Streaming } from '../../shared/types/Streaming'
import { Environment } from '../environment'
import { AgentService } from './AgentService'

const DEFAULT_IDLE_TIMEOUT_MS = 30_000
const DEFAULT_MAX_DURATION_MS = 180_000
const MIN_IDLE_TIMEOUT_MS = 5_000
const MIN_MAX_DURATION_MS = 30_000
const MAX_TIMEOUT_MS = 900_000

type StreamCloseReason =
	| 'complete'
	| 'client_disconnected'
	| 'idle_timeout'
	| 'max_duration'
	| 'error'

export class AgentDurableObject extends DurableObject<Environment> {
	service: AgentService

	constructor(ctx: DurableObjectState, env: Environment) {
		super(ctx, env)
		this.service = new AgentService(this.env) // swap this with your own service
	}

	private readonly router = AutoRouter({
		catch: (e) => {
			console.error(e)
			return error(e)
		},
	}).post('/stream', (request) => this.stream(request))

	// `fetch` is the entry point for all requests to the Durable Object
	override fetch(request: Request): Response | Promise<Response> {
		return this.router.fetch(request)
	}

	/**
	 * Stream changes from the model.
	 *
	 * @param request - The request object containing the prompt.
	 * @returns A Promise that resolves to a Response object containing the streamed changes.
	 */
	private async stream(request: Request): Promise<Response> {
		const encoder = new TextEncoder()
		const { readable, writable } = new TransformStream()
		const writer = writable.getWriter()
		const startedAt = Date.now()
		const idleTimeoutMs = parseTimeoutMs(
			this.env.AGENT_STREAM_IDLE_TIMEOUT_MS,
			DEFAULT_IDLE_TIMEOUT_MS,
			MIN_IDLE_TIMEOUT_MS
		)
		const maxDurationMs = parseTimeoutMs(
			this.env.AGENT_STREAM_MAX_DURATION_MS,
			DEFAULT_MAX_DURATION_MS,
			MIN_MAX_DURATION_MS
		)

		const response: { changes: Streaming<AgentAction>[] } = { changes: [] }
		let closeReason: StreamCloseReason = 'complete'
		let stopRequested = false
		let streamClosed = false
		const abortController = new AbortController()
		let idleTimer: ReturnType<typeof setTimeout> | null = null
		const maxTimer = setTimeout(() => stop('max_duration'), maxDurationMs)

		const closeStream = async () => {
			if (streamClosed) return
			streamClosed = true
			try {
				await writer.close()
			} catch (closeError) {
				try {
					await writer.abort(closeError)
				} catch {}
			}
		}

		const stop = (reason: StreamCloseReason) => {
			if (stopRequested) return
			stopRequested = true
			closeReason = reason
			abortController.abort(reason)
		}

		const resetIdleTimer = () => {
			if (idleTimer) clearTimeout(idleTimer)
			idleTimer = setTimeout(() => stop('idle_timeout'), idleTimeoutMs)
		}

		const onClientAbort = () => stop('client_disconnected')
		request.signal.addEventListener('abort', onClientAbort, { once: true })
		resetIdleTimer()

		;(async () => {
			try {
				const prompt = (await request.json()) as AgentPrompt

				for await (const change of this.service.stream(prompt, abortController.signal)) {
					if (stopRequested) break
					resetIdleTimer()
					response.changes.push(change)
					const data = `data: ${JSON.stringify(change)}\n\n`
					await writer.write(encoder.encode(data))
					await writer.ready
				}
				await closeStream()
			} catch (error: any) {
				if (stopRequested) {
					await closeStream()
					return
				}

				closeReason = 'error'
				console.error('Stream error:', error)

				// Send error through the stream
				const errorData = `data: ${JSON.stringify({ error: error.message })}\n\n`
				try {
					await writer.write(encoder.encode(errorData))
					await closeStream()
				} catch (writeError) {
					await writer.abort(writeError)
				}
			} finally {
				if (idleTimer) clearTimeout(idleTimer)
				clearTimeout(maxTimer)
				request.signal.removeEventListener('abort', onClientAbort)
				console.info('[AgentDurableObject] stream closed', {
					reason: closeReason,
					durationMs: Date.now() - startedAt,
					idleTimeoutMs,
					maxDurationMs,
				})
			}
		})()

		return new Response(readable, {
			headers: {
				'Content-Type': 'text/event-stream',
				'Cache-Control': 'no-cache, no-transform',
				Connection: 'keep-alive',
				'X-Accel-Buffering': 'no',
				'Transfer-Encoding': 'chunked',
				'Access-Control-Allow-Origin': '*',
				'Access-Control-Allow-Methods': 'POST, OPTIONS',
				'Access-Control-Allow-Headers': 'Content-Type',
			},
		})
	}
}

function parseTimeoutMs(rawValue: string | undefined, fallback: number, min: number) {
	if (!rawValue) return fallback
	const parsed = Number.parseInt(rawValue, 10)
	if (!Number.isFinite(parsed)) return fallback
	return Math.max(min, Math.min(MAX_TIMEOUT_MS, parsed))
}
