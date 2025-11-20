import { PromptPartUtil } from './PromptPartUtil';
export class MessagesPartUtil extends PromptPartUtil {
    getPriority() {
        return -Infinity; // user message should be last (highest priority)
    }
    getPart(request) {
        const { messages, type } = request;
        return {
            type: 'messages',
            messages,
            requestType: type,
        };
    }
    buildContent({ messages, requestType }) {
        let responsePart = [];
        switch (requestType) {
            case 'user':
                responsePart = getUserPrompt(messages);
                break;
            case 'schedule':
                responsePart = getSchedulePrompt(messages);
                break;
            case 'todo':
                responsePart = getTodoPrompt(messages);
                break;
        }
        return responsePart;
    }
}
MessagesPartUtil.type = 'messages';
function getUserPrompt(message) {
    return [
        `Using the events provided in the response schema, here's what I want you to do:`,
        ...message,
    ];
}
function getSchedulePrompt(message) {
    return [
        "Using the events provided in the response schema, here's what you should do:",
        ...message,
    ];
}
function getTodoPrompt(message) {
    return [
        'There are still outstanding todo items. Please continue. For your reference, the most recent message I gave you was this:',
        ...message,
    ];
}
//# sourceMappingURL=MessagesPartUtil.js.map