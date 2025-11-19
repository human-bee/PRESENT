import z from 'zod';
import { AgentActionUtil } from './AgentActionUtil';
const SetMyViewAction = z
    .object({
    _type: z.literal('setMyView'),
    intent: z.string(),
    x: z.number(),
    y: z.number(),
    w: z.number(),
    h: z.number(),
})
    .meta({
    title: 'Set My View',
    description: 'The AI changes the bounds of its own viewport to navigate to other areas of the canvas if needed.',
});
export class SetMyViewActionUtil extends AgentActionUtil {
    getSchema() {
        return SetMyViewAction;
    }
    getInfo(action) {
        const label = action.complete ? 'Move camera' : 'Moving camera';
        const text = action.intent?.startsWith('#') ? `\n\n${action.intent}` : action.intent;
        return {
            icon: 'eye',
            description: `**${label}**: ${text ?? ''}`,
        };
    }
    applyAction(action, helpers) {
        if (!action.complete)
            return;
        if (!this.agent)
            return;
        const bounds = helpers.removeOffsetFromBox({
            x: action.x,
            y: action.y,
            w: action.w,
            h: action.h,
        });
        this.agent.schedule({ bounds });
    }
}
SetMyViewActionUtil.type = 'setMyView';
//# sourceMappingURL=SetMyViewActionUtil.js.map