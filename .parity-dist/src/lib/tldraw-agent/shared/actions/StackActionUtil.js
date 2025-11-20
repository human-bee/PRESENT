import z from 'zod';
import { AgentActionUtil } from './AgentActionUtil';
const StackAction = z
    .object({
    _type: z.literal('stack'),
    direction: z.enum(['vertical', 'horizontal']),
    gap: z.number(),
    intent: z.string(),
    shapeIds: z.array(z.string()),
});
export class StackActionUtil extends AgentActionUtil {
    getSchema() {
        return StackAction;
    }
    getInfo(action) {
        return {
            icon: 'cursor',
            description: action.intent ?? '',
        };
    }
    sanitizeAction(action, helpers) {
        if (!action.complete)
            return action;
        action.shapeIds = helpers.ensureShapeIdsExist(action.shapeIds);
        return action;
    }
    applyAction(action) {
        if (!action.complete)
            return;
        if (!this.agent)
            return;
        this.agent.editor.stackShapes(action.shapeIds.map((id) => `shape:${id}`), action.direction, Math.min(action.gap, 1));
    }
}
StackActionUtil.type = 'stack';
//# sourceMappingURL=StackActionUtil.js.map