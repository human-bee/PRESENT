import { z } from 'zod';
import { AgentActionUtil } from './AgentActionUtil';
const AddDetailAction = z.object({
    _type: z.literal('add-detail'),
    intent: z.string(),
});
export class AddDetailActionUtil extends AgentActionUtil {
    getSchema() {
        return AddDetailAction;
    }
    getInfo(action) {
        const label = 'Adding detail';
        const text = action.intent?.startsWith('#') ? `\n\n${action.intent}` : action.intent;
        const description = `**${label}:** ${text ?? ''}`;
        return {
            icon: 'pencil',
            description,
        };
    }
    applyAction(action) {
        if (!action.complete)
            return;
        if (!this.agent)
            return;
        this.agent.schedule('Add detail to the canvas.');
    }
}
AddDetailActionUtil.type = 'add-detail';
//# sourceMappingURL=AddDetailActionUtil.js.map