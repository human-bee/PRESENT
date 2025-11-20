import { getPromptPartUtilsRecord } from '../../shared/AgentUtils';
export function buildMessages(prompt) {
    const utils = getPromptPartUtilsRecord();
    const allMessages = [];
    for (const part of Object.values(prompt)) {
        const util = utils[part.type];
        const messages = util.buildMessages(part);
        allMessages.push(...messages);
    }
    allMessages.sort((a, b) => b.priority - a.priority);
    return toModelMessages(allMessages);
}
/**
 * Convert AgentMessage[] to ModelMessage[] for the AI SDK
 */
function toModelMessages(agentMessages) {
    return agentMessages.map((tlMessage) => {
        const content = [];
        for (const contentItem of tlMessage.content) {
            if (contentItem.type === 'image') {
                content.push({
                    type: 'image',
                    image: contentItem.image,
                });
            }
            else {
                content.push({
                    type: 'text',
                    text: contentItem.text,
                });
            }
        }
        return {
            role: tlMessage.role,
            content,
        };
    });
}
//# sourceMappingURL=buildMessages.js.map