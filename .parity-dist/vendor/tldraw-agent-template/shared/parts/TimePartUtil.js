import { PromptPartUtil } from './PromptPartUtil';
export class TimePartUtil extends PromptPartUtil {
    getPart() {
        return {
            type: 'time',
            time: new Date().toLocaleTimeString(),
        };
    }
    buildContent({ time }) {
        return ["The user's current time is:", time];
    }
}
TimePartUtil.type = 'time';
//# sourceMappingURL=TimePartUtil.js.map