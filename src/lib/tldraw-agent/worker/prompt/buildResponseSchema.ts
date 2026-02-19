import { z } from 'zod'
import { getAgentActionUtilsRecord } from '../../shared/AgentUtils'

const FALLBACK_RESPONSE_SCHEMA = {
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
} as const

const isZodSchemaLike = (value: unknown): value is z.ZodTypeAny => {
	if (!value || typeof value !== 'object') return false
	const candidate = value as Partial<z.ZodTypeAny>
	const hasInternals = typeof (candidate as { _def?: unknown })._def === 'object'
	return hasInternals && typeof candidate.parse === 'function' && typeof candidate.safeParse === 'function'
}

const asSchemaTuple = (
	schemas: z.ZodTypeAny[]
): [z.ZodTypeAny, ...z.ZodTypeAny[]] | null => {
	return schemas.length > 0 ? (schemas as [z.ZodTypeAny, ...z.ZodTypeAny[]]) : null
}

export function buildResponseSchema() {
	const actionUtils = getAgentActionUtilsRecord()
	const actionSchemas = Object.values(actionUtils)
		.map((util) => {
			try {
				return util.getSchema()
			} catch {
				return null
			}
		})
		.filter((schema): schema is z.ZodTypeAny => isZodSchemaLike(schema))
	const schemaTuple = asSchemaTuple(actionSchemas)

	if (!schemaTuple) {
		console.warn('[TLAgent] no action schemas resolved; using fallback response schema')
		return FALLBACK_RESPONSE_SCHEMA
	}

	try {
		const actionSchema = schemaTuple.length === 1 ? schemaTuple[0] : z.union(schemaTuple)
		const schema = z.object({
			actions: z.array(actionSchema).min(1),
		})
		const toJSONSchema = (z as unknown as { toJSONSchema?: (schema: z.ZodTypeAny, options?: unknown) => unknown })
			.toJSONSchema
		if (typeof toJSONSchema !== 'function') {
			throw new Error('z.toJSONSchema unavailable')
		}
		return toJSONSchema(schema, { reused: 'ref' })
	} catch (error) {
		console.warn('[TLAgent] failed to build response schema; using fallback', {
			error: error instanceof Error ? error.message : String(error),
			schemaCount: actionSchemas.length,
		})
		return FALLBACK_RESPONSE_SCHEMA
	}
}
