import z from 'zod';
import { AgentActionUtil } from './AgentActionUtil';
const ThinkAction = z
    .object({
    _type: z.literal('think'),
    text: z.string(),
})
    .meta({ title: 'Think', description: 'The AI describes its intent or reasoning.' });
export class ThinkActionUtil extends AgentActionUtil {
    getSchema() {
        return ThinkAction;
    }
    getInfo(action) {
        const time = Math.floor(action.time / 1000);
        let summary = `Thought for ${time} seconds`;
        if (time === 0)
            summary = 'Thought for less than a second';
        if (time === 1)
            summary = 'Thought for 1 second';
        return {
            icon: 'brain',
            description: action.text ?? (action.complete ? 'Thinking...' : null),
            summary,
        };
    }
}
ThinkActionUtil.type = 'think';
//# sourceMappingURL=ThinkActionUtil.js.map