import z from 'zod';
import { AgentActionUtil } from './AgentActionUtil';
const DistributeAction = z
    .object({
    _type: z.literal('distribute'),
    direction: z.enum(['horizontal', 'vertical']),
    intent: z.string(),
    shapeIds: z.array(z.string()),
})
    .meta({
    title: 'Distribute',
    description: 'The AI distributes shapes horizontally or vertically.',
});
export class DistributeActionUtil extends AgentActionUtil {
    getSchema() {
        return DistributeAction;
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
        this.agent.editor.distributeShapes(action.shapeIds.map((id) => `shape:${id}`), action.direction);
    }
}
DistributeActionUtil.type = 'distribute';
//# sourceMappingURL=DistributeActionUtil.js.map