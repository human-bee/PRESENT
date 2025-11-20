import z from 'zod';
import { AgentActionUtil } from './AgentActionUtil';
const MessageAction = z
    .object({
    _type: z.literal('message'),
    text: z.string(),
})
    .meta({ title: 'Message', description: 'The AI sends a message to the user.' });
export class MessageActionUtil extends AgentActionUtil {
    getSchema() {
        return MessageAction;
    }
    getInfo(action) {
        return {
            description: action.text ?? '',
            canGroup: () => false,
        };
    }
}
MessageActionUtil.type = 'message';
//# sourceMappingURL=MessageActionUtil.js.map