import { z } from 'zod'
import { zodToJsonSchema } from 'zod-to-json-schema'
import { getAgentActionUtilsRecord } from '../../shared/AgentUtils'

export function buildResponseSchema() {
	const actionUtils = getAgentActionUtilsRecord()
	const actionSchemas = Object.values(actionUtils)
		.map((util) => util.getSchema())
		.filter((schema): schema is z.ZodTypeAny => {
			if (!schema || typeof schema !== 'object') return false
			return typeof (schema as z.ZodTypeAny).safeParse === 'function'
		})

	if (actionSchemas.length === 0) {
		console.warn('[TLAgent] no action schemas resolved; using fallback response schema')
		return {
			type: 'object',
			properties: {
				actions: {
					type: 'array',
					items: {
						type: 'object',
						properties: {
							_type: { type: 'string' },
						},
						required: ['_type'],
						additionalProperties: true,
					},
				},
			},
			required: ['actions'],
			additionalProperties: false,
		}
	}

	const actionSchema = z.union(actionSchemas)
	const schema = z.object({
		actions: z.array(actionSchema),
	})

	try {
		return zodToJsonSchema(schema as any, {
			name: 'AgentResponse',
			$refStrategy: 'root',
		})
	} catch (error) {
		console.warn('[TLAgent] failed to build response schema; using fallback', {
			error: error instanceof Error ? error.message : String(error),
		})
		return {
			type: 'object',
			properties: {
				actions: {
					type: 'array',
					items: {
						type: 'object',
						properties: {
							_type: { type: 'string' },
						},
						required: ['_type'],
						additionalProperties: true,
					},
				},
			},
			required: ['actions'],
			additionalProperties: false,
		}
	}
}
