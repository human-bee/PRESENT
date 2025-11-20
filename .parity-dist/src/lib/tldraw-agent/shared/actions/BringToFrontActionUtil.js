import z from 'zod';
import { AgentActionUtil } from './AgentActionUtil';
const BringToFrontAction = z
    .object({
    _type: z.literal('bringToFront'),
    intent: z.string(),
    shapeIds: z.array(z.string()),
});
export class BringToFrontActionUtil extends AgentActionUtil {
    getSchema() {
        return BringToFrontAction;
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
        this.agent.editor.bringToFront(shapeIds.map((shapeId) => `shape:${shapeId}`));
    }
}
BringToFrontActionUtil.type = 'bringToFront';
//# sourceMappingURL=BringToFrontActionUtil.js.map