import { z } from 'zod';
import { performWebSearch } from '@/lib/agents/tools/web-search';
const GeneralSearchArgs = z
    .object({
    room: z.string().min(1, 'room is required'),
    query: z.string().min(3, 'query must be at least 3 characters'),
    maxResults: z.number().int().min(1).max(6).optional(),
    includeAnswer: z.boolean().optional(),
    topic: z.string().optional(),
    componentId: z.string().optional(),
})
    .passthrough();
const DEFAULT_RESULT_SOURCE = {
    credibility: 'medium',
    type: 'news',
};
export async function runSearchSteward({ task, params }) {
    if (task === 'search.general') {
        return runGeneralSearch(params);
    }
    return { status: 'unsupported', error: `No search steward for task: ${task}` };
}
async function runGeneralSearch(rawParams) {
    const parsed = GeneralSearchArgs.parse(rawParams);
    const { query } = parsed;
    try {
        const searchResponse = await performWebSearch({
            query,
            maxResults: parsed.maxResults ?? 3,
            includeAnswer: parsed.includeAnswer ?? true,
        });
        const panel = {
            title: `Research findings for “${query}”`,
            currentTopic: parsed.topic || query,
            results: searchResponse.hits.map((hit, index) => mapHitToResult(hit, index)),
            isLive: true,
            showCredibilityFilter: true,
            maxResults: parsed.maxResults ?? 3,
        };
        return {
            status: 'ok',
            bundle: {
                query,
                summary: searchResponse.summary,
                model: searchResponse.model,
                hits: searchResponse.hits,
            },
            panel,
            componentId: parsed.componentId,
        };
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown search failure';
        console.warn('[SearchSteward] performWebSearch failed', {
            query,
            error: message,
        });
        return {
            status: 'error',
            error: `search_failed: ${message}`,
            componentId: parsed.componentId,
        };
    }
}
function mapHitToResult(hit, index) {
    const url = typeof hit.url === 'string' ? hit.url : undefined;
    let hostname = 'web';
    if (url) {
        try {
            hostname = new URL(url).hostname.replace(/^www\./, '');
        }
        catch {
            hostname = url;
        }
    }
    return {
        id: typeof hit.id === 'string' ? hit.id : `hit-${index}`,
        title: hit.title || 'Untitled result',
        content: hit.snippet || hit.summary || 'No snippet provided.',
        source: {
            name: hit.source || hostname,
            url,
            ...DEFAULT_RESULT_SOURCE,
        },
        relevance: Math.max(10, 100 - index * 15),
        timestamp: typeof hit.publishedAt === 'string' && hit.publishedAt.trim()
            ? hit.publishedAt
            : new Date().toISOString(),
        tags: [],
    };
}
//# sourceMappingURL=search-steward.js.map