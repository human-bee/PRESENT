import { PromptPartUtil } from './PromptPartUtil';
/**
 * This prompt part collects up data retrieved by agent actions in the previous request.
 */
export class DataPartUtil extends PromptPartUtil {
    getPriority() {
        return -200; // API data should come right before the user message but after most other parts
    }
    async getPart(request) {
        const { data } = request;
        const values = await Promise.all(data.map(async (item) => {
            try {
                return await item;
            }
            catch (error) {
                console.error('Error retrieving data:', error);
                // Tell the agent that something went wrong
                return 'An error occurred while retrieving some data.';
            }
        }));
        return {
            type: 'data',
            data: values,
        };
    }
    buildContent({ data }) {
        if (data.length === 0)
            return [];
        const formattedData = data.map((item) => {
            return `${JSON.stringify(item)}`;
        });
        return ["Here's the data you requested:", ...formattedData];
    }
}
DataPartUtil.type = 'data';
//# sourceMappingURL=DataPartUtil.js.map