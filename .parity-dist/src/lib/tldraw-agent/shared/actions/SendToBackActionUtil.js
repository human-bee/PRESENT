import z from 'zod';
import { AgentActionUtil } from './AgentActionUtil';
const SendToBackAction = z
    .object({
    _type: z.literal('sendToBack'),
    intent: z.string(),
    shapeIds: z.array(z.string()),
});
export class SendToBackActionUtil extends AgentActionUtil {
    getSchema() {
        return SendToBackAction;
    }
    getInfo(action) {
        return {
            icon: 'cursor',
            description: action.intent ?? '',
        };
    }
    sanitizeAction(action, helpers) {
        action.shapeIds = helpers.ensureShapeIdsExist(action.shapeIds ?? []);
        return action;
    }
    applyAction(action) {
        if (!action.complete)
            return;
        if (!this.agent)
            return;
        const shapeIds = action.shapeIds ?? [];
        if (shapeIds.length === 0)
            return;
        this.agent.editor.sendToBack(shapeIds.map((shapeId) => `shape:${shapeId}`));
    }
}
SendToBackActionUtil.type = 'sendToBack';
//# sourceMappingURL=SendToBackActionUtil.js.map