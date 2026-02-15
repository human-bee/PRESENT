const STREAM_RESPONSE_HEADERS = {
	'Content-Type': 'text/event-stream',
	'Cache-Control': 'no-cache, no-transform',
	Connection: 'keep-alive',
	'X-Accel-Buffering': 'no',
	'Transfer-Encoding': 'chunked',
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Methods': 'POST, OPTIONS',
	'Access-Control-Allow-Headers': 'Content-Type',
} as const

export function createStreamResponse(body: BodyInit | null, init?: Omit<ResponseInit, 'headers'>) {
	return new Response(body, {
		...init,
		headers: STREAM_RESPONSE_HEADERS,
	})
}
