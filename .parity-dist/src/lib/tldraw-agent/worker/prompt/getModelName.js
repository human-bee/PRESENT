import { getPromptPartUtilsRecord } from '../../shared/AgentUtils';
import { DEFAULT_MODEL_NAME } from '../models';
/**
 * Get the selected model name from a prompt.
 */
export function getModelName(prompt) {
    const utils = getPromptPartUtilsRecord();
    for (const part of Object.values(prompt)) {
        const util = utils[part.type];
        if (!util)
            continue;
        const modelName = util.getModelName(part);
        if (modelName)
            return modelName;
    }
    return DEFAULT_MODEL_NAME;
}
//# sourceMappingURL=getModelName.js.map