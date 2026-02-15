import { IRequest } from 'itty-router'
import { Environment } from '../environment'
import { createStreamResponse } from '../stream-response'

export async function stream(request: IRequest, env: Environment) {
	// eventually... use some kind of per-user id, so that each user has their own worker
	const id = env.AGENT_DURABLE_OBJECT.idFromName('anonymous')
	const DO = env.AGENT_DURABLE_OBJECT.get(id)
	const response = await DO.fetch(request.url, {
		method: 'POST',
		body: request.body as any,
	})

	return createStreamResponse(response.body as BodyInit)
}
