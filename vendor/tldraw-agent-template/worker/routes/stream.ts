import { IRequest } from 'itty-router'
import { Environment } from '../environment'
import { createStreamResponse } from '../stream-response'

export async function stream(request: IRequest, env: Environment) {
	const objectKey = getDurableObjectKey(request)
	const id = env.AGENT_DURABLE_OBJECT.idFromName(objectKey)
	const DO = env.AGENT_DURABLE_OBJECT.get(id)
	const response = await DO.fetch(request.url, {
		method: 'POST',
		body: request.body as any,
	})

	return createStreamResponse(response.body as BodyInit)
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
