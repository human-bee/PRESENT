import { TLShapeId } from 'tldraw'
import z from 'zod'
import { AgentHelpers } from '../AgentHelpers'
import { Streaming } from '../types/Streaming'
import { AgentActionUtil } from './AgentActionUtil'

const BringToFrontAction = z
	.object({
		_type: z.literal('bringToFront'),
		intent: z.string(),
		shapeIds: z.array(z.string()),
	})
	

type BringToFrontAction = z.infer<typeof BringToFrontAction>

export class BringToFrontActionUtil extends AgentActionUtil<BringToFrontAction> {
	static override type = 'bringToFront' as const

	override getSchema() {
		return BringToFrontAction
	}

	override getInfo(action: Streaming<BringToFrontAction>) {
		return {
			icon: 'cursor' as const,
			description: action.intent ?? '',
		}
	}

	override sanitizeAction(action: Streaming<BringToFrontAction>, helpers: AgentHelpers) {
		action.shapeIds = helpers.ensureShapeIdsExist(action.shapeIds ?? [])
		return action
	}

	override applyAction(action: Streaming<BringToFrontAction>) {
		if (!action.complete) return
		if (!this.agent) return

		const shapeIds = action.shapeIds ?? []
		if (shapeIds.length === 0) return

		this.agent.editor.bringToFront(shapeIds.map((shapeId) => `shape:${shapeId}` as TLShapeId))
	}
}
