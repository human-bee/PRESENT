import z from 'zod'
import { AgentAction } from '../types/AgentAction'
import { AGENT_ACTION_SCHEMAS } from './FairySchema'

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

const readLiteralValue = (schema: unknown): string | null => {
	if (!schema || typeof schema !== 'object') return null
	const candidate = schema as {
		value?: unknown
		_def?: { value?: unknown }
	}
	if (typeof candidate.value === 'string' && candidate.value.trim().length > 0) {
		return candidate.value
	}
	if (typeof candidate._def?.value === 'string' && candidate._def.value.trim().length > 0) {
		return candidate._def.value
	}
	return null
}

const extractActionType = (schema: z.ZodTypeAny): string | null => {
	const shape = (schema as unknown as { shape?: { _type?: unknown } }).shape
	return readLiteralValue(shape?._type)
}

/**
 * Build the JSON schema for the agent's response format.
 */
export function buildResponseSchema(availableActionTypes: AgentAction['_type'][]) {
	const availableActionSchemas = AGENT_ACTION_SCHEMAS.filter((schema) => {
		if (!isZodSchemaLike(schema)) return false
		const actionType = extractActionType(schema)
		return typeof actionType === 'string' && availableActionTypes.includes(actionType as AgentAction['_type'])
	})
	const schemaTuple = asSchemaTuple(availableActionSchemas)

	if (!schemaTuple) {
		console.warn('[FairyShared] no action schemas resolved; using fallback response schema', {
			actionCount: availableActionTypes.length,
		})
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
		console.warn('[FairyShared] failed to build response schema; using fallback', {
			error: error instanceof Error ? error.message : String(error),
			actionCount: availableActionSchemas.length,
		})
		return FALLBACK_RESPONSE_SCHEMA
	}
}
