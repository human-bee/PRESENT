import { toRichText } from 'tldraw';
import z from 'zod';
import { AgentActionUtil } from './AgentActionUtil';
const LabelAction = z
    .object({
    _type: z.literal('label'),
    intent: z.string(),
    shapeId: z.string(),
    text: z.string(),
})
    .meta({ title: 'Label', description: "The AI changes a shape's text." });
export class LabelActionUtil extends AgentActionUtil {
    getSchema() {
        return LabelAction;
    }
    getInfo(action) {
        return {
            icon: 'pencil',
            description: action.intent ?? '',
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
        const { editor } = this.agent;
        const shapeId = `shape:${action.shapeId}`;
        const shape = editor.getShape(shapeId);
        if (!shape)
            return;
        if (!('richText' in shape.props)) {
            console.warn(`Shape type "${shape.type}" does not support richText labels`);
            return;
        }
        editor.updateShape({
            id: shapeId,
            type: shape.type,
            props: { richText: toRichText(action.text ?? '') },
        });
    }
}
LabelActionUtil.type = 'label';
//# sourceMappingURL=LabelActionUtil.js.map