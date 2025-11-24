import z from 'zod';
import { AgentActionUtil } from './AgentActionUtil';
const CountShapesAction = z
    .object({
    _type: z.literal('count'),
    expression: z.string(),
});
export class CountShapesActionUtil extends AgentActionUtil {
    getSchema() {
        return CountShapesAction;
    }
    getInfo(action) {
        const description = action.complete ? 'Counted shapes' : 'Counting shapes';
        return {
            icon: 'search',
            description,
        };
    }
    async applyAction(action, helpers) {
        if (!action.complete)
            return;
        const { agent, editor } = helpers;
        // Add the shape count to the next request
        agent.schedule({
            data: [`Number of shapes on the canvas: ${editor.getCurrentPageShapes().length}`],
        });
    }
}
CountShapesActionUtil.type = 'count';
//# sourceMappingURL=CountShapesActionUtil.js.map