import z from 'zod';
import { AgentActionUtil } from './AgentActionUtil';
const DeleteAction = z
    .object({
    _type: z.literal('delete'),
    intent: z.string(),
    shapeId: z.string(),
})
    .meta({ title: 'Delete', description: 'The AI deletes a shape.' });
export class DeleteActionUtil extends AgentActionUtil {
    getSchema() {
        return DeleteAction;
    }
    getInfo(action) {
        return {
            icon: 'trash',
            description: action.intent ?? '',
            canGroup: (other) => other._type === 'delete',
        };
    }
    sanitizeAction(action, helpers) {
        if (!action.complete)
            return action;
        const shapeId = helpers.ensureShapeIdExists(action.shapeId);
        if (!shapeId)
            return null;
        action.shapeId = shapeId;
        return action;
    }
    applyAction(action) {
        if (!action.complete)
            return;
        if (!this.agent)
            return;
        this.agent.editor.deleteShape(`shape:${action.shapeId}`);
    }
}
DeleteActionUtil.type = 'delete';
//# sourceMappingURL=DeleteActionUtil.js.map