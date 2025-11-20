import { PromptPartUtil } from './PromptPartUtil';
export class ModelNamePartUtil extends PromptPartUtil {
    /**
     * Get the specified model name for the request.
     */
    getPart(request) {
        return {
            type: 'modelName',
            name: request.modelName,
        };
    }
    /**
     * Use the specified model name for this request.
     */
    getModelName(part) {
        return part.name;
    }
}
ModelNamePartUtil.type = 'modelName';
//# sourceMappingURL=ModelNamePartUtil.js.map