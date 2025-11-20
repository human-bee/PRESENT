import z from 'zod';
import { AgentActionUtil } from './AgentActionUtil';
const SendToBackAction = z
    .object({
    _type: z.literal('sendToBack'),
    intent: z.string(),
    shapeIds: z.array(z.string()),
})
    .meta({
    title: 'Send to Back',
    description: 'The AI sends one or more shapes to the back so that they appear behind everything else.',
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
        if (!this.agent)
            return;
        if (!action.shapeIds)
            return;
        this.agent.editor.sendToBack(action.shapeIds.map((shapeId) => `shape:${shapeId}`));
    }
}
SendToBackActionUtil.type = 'sendToBack';
//# sourceMappingURL=SendToBackActionUtil.js.map