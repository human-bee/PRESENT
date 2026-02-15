import { IRequest } from 'itty-router'
import { Environment } from '../environment'

export async function stream(request: IRequest, env: Environment) {
	const objectKey = getDurableObjectKey(request)
	const id = env.AGENT_DURABLE_OBJECT.idFromName(objectKey)
	const DO = env.AGENT_DURABLE_OBJECT.get(id)
	const response = await DO.fetch(request.url, {
		method: 'POST',
		body: request.body as any,
	})

		return new Response(response.body as BodyInit, {
			headers: {
				'Content-Type': 'text/event-stream',
				'Cache-Control': 'no-cache, no-transform',
				Connection: 'keep-alive',
				'X-Accel-Buffering': 'no',
				'Transfer-Encoding': 'chunked',
				'Access-Control-Allow-Origin': '*',
				'Access-Control-Allow-Methods': 'POST, OPTIONS',
				'Access-Control-Allow-Headers': 'Content-Type, X-Tldraw-Agent-Id, X-Agent-Session-Id',
			},
			})
}

function getDurableObjectKey(request: IRequest): string {
	const fromHeader =
		request.headers.get('x-tldraw-agent-id') ?? request.headers.get('x-agent-session-id')
	if (fromHeader) {
		return `agent:${sanitizeDurableObjectKey(fromHeader)}`
	}

	try {
		const url = new URL(request.url)
		const fromQuery = url.searchParams.get('agentId') ?? url.searchParams.get('sessionId')
		if (fromQuery) {
			return `agent:${sanitizeDurableObjectKey(fromQuery)}`
		}
	} catch {}

	return 'agent:anonymous'
}

function sanitizeDurableObjectKey(value: string): string {
	const normalized = value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9:_-]/g, '-')
		.replace(/-+/g, '-')
		.slice(0, 120)

	return normalized || 'anonymous'
}
