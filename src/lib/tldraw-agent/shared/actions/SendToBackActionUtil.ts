import { TLShapeId } from 'tldraw'
import z from 'zod'
import { AgentHelpers } from '../AgentHelpers'
import { Streaming } from '../types/Streaming'
import { AgentActionUtil } from './AgentActionUtil'

const SendToBackAction = z
	.object({
		_type: z.literal('sendToBack'),
		intent: z.string(),
		shapeIds: z.array(z.string()),
	})
	

type SendToBackAction = z.infer<typeof SendToBackAction>

export class SendToBackActionUtil extends AgentActionUtil<SendToBackAction> {
	static override type = 'sendToBack' as const

	override getSchema() {
		return SendToBackAction
	}

	override getInfo(action: Streaming<SendToBackAction>) {
		return {
			icon: 'cursor' as const,
			description: action.intent ?? '',
		}
	}

	override sanitizeAction(action: Streaming<SendToBackAction>, helpers: AgentHelpers) {
		action.shapeIds = helpers.ensureShapeIdsExist(action.shapeIds ?? [])
		return action
	}

	override applyAction(action: Streaming<SendToBackAction>) {
		if (!action.complete) return
		if (!this.agent) return

		const shapeIds = action.shapeIds ?? []
		if (shapeIds.length === 0) return

		this.agent.editor.sendToBack(shapeIds.map((shapeId) => `shape:${shapeId}` as TLShapeId))
	}
}
