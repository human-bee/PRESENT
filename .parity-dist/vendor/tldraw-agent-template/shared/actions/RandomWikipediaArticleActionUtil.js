import z from 'zod';
import { AgentActionUtil } from './AgentActionUtil';
const RandomWikipediaArticleAction = z
    .object({
    _type: z.literal('getInspiration'),
})
    .meta({
    title: 'Get inspiration',
    description: 'The AI gets inspiration from a random Wikipedia article.',
});
export class RandomWikipediaArticleActionUtil extends AgentActionUtil {
    getSchema() {
        return RandomWikipediaArticleAction;
    }
    getInfo(action) {
        const description = action.complete
            ? 'Got random Wikipedia article'
            : 'Getting random Wikipedia article';
        return {
            icon: 'search',
            description,
        };
    }
    async applyAction(action, _helpers) {
        // Wait until the action has finished streaming
        if (!action.complete)
            return;
        if (!this.agent)
            return;
        const article = await fetchRandomWikipediaArticle();
        this.agent.schedule({ data: [article] });
    }
}
RandomWikipediaArticleActionUtil.type = 'getInspiration';
export async function fetchRandomWikipediaArticle() {
    const response = await fetch('https://en.wikipedia.org/api/rest_v1/page/random/summary', {
        headers: { 'User-Agent': 'tldraw' },
    });
    if (!response.ok) {
        throw new Error(`Wikipedia API returned status ${response.status}, ${response.statusText}`);
    }
    const data = await response.json();
    return {
        title: data.title,
        extract: data.extract,
        url: data.content_urls.desktop.page,
        pageId: data.pageid,
    };
}
//# sourceMappingURL=RandomWikipediaArticleActionUtil.js.map