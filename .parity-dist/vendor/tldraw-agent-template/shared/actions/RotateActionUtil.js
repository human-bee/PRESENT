import z from 'zod';
import { AgentActionUtil } from './AgentActionUtil';
const RotateAction = z
    .object({
    _type: z.literal('rotate'),
    centerY: z.number(),
    degrees: z.number(),
    intent: z.string(),
    originX: z.number(),
    originY: z.number(),
    shapeIds: z.array(z.string()),
})
    .meta({
    title: 'Rotate',
    description: 'The AI rotates one or more shapes around an origin point.',
});
export class RotateActionUtil extends AgentActionUtil {
    getSchema() {
        return RotateAction;
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
    applyAction(action, helpers) {
        if (!this.agent)
            return;
        if (!action.shapeIds || !action.degrees || !action.originX || !action.originY) {
            return;
        }
        const origin = helpers.removeOffsetFromVec({ x: action.originX, y: action.originY });
        const shapeIds = action.shapeIds.map((shapeId) => `shape:${shapeId}`);
        const radians = (action.degrees * Math.PI) / 180;
        this.agent.editor.rotateShapesBy(shapeIds, radians, { center: origin });
    }
}
RotateActionUtil.type = 'rotate';
//# sourceMappingURL=RotateActionUtil.js.map