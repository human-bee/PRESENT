import z from 'zod';
import { AgentActionUtil } from './AgentActionUtil';
const BringToFrontAction = z
    .object({
    _type: z.literal('bringToFront'),
    intent: z.string(),
    shapeIds: z.array(z.string()),
})
    .meta({
    title: 'Bring to Front',
    description: 'The AI brings one or more shapes to the front so that they appear in front of everything else.',
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
        if (!this.agent)
            return;
        if (!action.shapeIds)
            return;
        this.agent.editor.bringToFront(action.shapeIds.map((shapeId) => `shape:${shapeId}`));
    }
}
BringToFrontActionUtil.type = 'bringToFront';
//# sourceMappingURL=BringToFrontActionUtil.js.map