import z from 'zod';
import { AgentActionUtil } from './AgentActionUtil';
const AlignAction = z
    .object({
    _type: z.literal('align'),
    alignment: z.enum(['top', 'bottom', 'left', 'right', 'center-horizontal', 'center-vertical']),
    gap: z.number(),
    intent: z.string(),
    shapeIds: z.array(z.string()),
});
export class AlignActionUtil extends AgentActionUtil {
    getSchema() {
        return AlignAction;
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
        this.agent.editor.alignShapes(action.shapeIds.map((id) => `shape:${id}`), action.alignment);
    }
}
AlignActionUtil.type = 'align';
//# sourceMappingURL=AlignActionUtil.js.map