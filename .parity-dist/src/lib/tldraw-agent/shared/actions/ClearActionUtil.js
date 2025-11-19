import z from 'zod';
import { AgentActionUtil } from './AgentActionUtil';
const ClearAction = z
    .object({
    // All agent actions must have a _type field
    // We use an underscore to encourage the model to put this field first
    _type: z.literal('clear'),
});
export class ClearActionUtil extends AgentActionUtil {
    /**
     * Tell the model what the action's schema is
     */
    getSchema() {
        return ClearAction;
    }
    /**
     * Tell the model how to display this action in the chat history UI
     */
    getInfo() {
        return {
            icon: 'trash',
            description: 'Cleared the canvas',
        };
    }
    /**
     * Tell the model how to apply the action
     */
    applyAction(action) {
        // Don't do anything if the action hasn't finished streaming
        if (!action.complete)
            return;
        // Delete all shapes on the page
        if (!this.agent)
            return;
        const { editor } = this.agent;
        const allShapes = editor.getCurrentPageShapes();
        editor.deleteShapes(allShapes);
    }
}
ClearActionUtil.type = 'clear';
//# sourceMappingURL=ClearActionUtil.js.map