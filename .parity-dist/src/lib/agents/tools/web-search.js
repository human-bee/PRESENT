import crypto from 'node:crypto';
import OpenAI from 'openai';
import { z } from 'zod';
export const webSearchArgsSchema = z.object({
    query: z.string().min(4, 'query must be at least 4 characters').max(400),
    maxResults: z.number().int().min(1).max(6).default(3),
    includeAnswer: z.boolean().default(true),
});
let cachedClient = null;
function getClient() {
    if (cachedClient)
        return cachedClient;
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey || !apiKey.trim()) {
        throw new Error('OPENAI_API_KEY missing for web search');
    }
    cachedClient = new OpenAI({ apiKey });
    return cachedClient;
}
function hashId(value) {
    return crypto.createHash('sha1').update(value).digest('hex').slice(0, 16);
}
function coerceArray(value) {
    if (Array.isArray(value))
        return value;
    return [];
}
const collectTextCandidates = (response, rawText) => {
    const candidates = [];
    if (rawText && rawText.trim())
        candidates.push(rawText.trim());
    const outputItems = Array.isArray(response?.output) ? response.output : [];
    for (const item of outputItems) {
        if (!item || typeof item !== 'object')
            continue;
        if (typeof item.text === 'string' && item.text.trim()) {
            candidates.push(item.text.trim());
        }
        const content = Array.isArray(item.content) ? item.content : [];
        for (const chunk of content) {
            if (chunk && typeof chunk.text === 'string' && chunk.text.trim()) {
                candidates.push(chunk.text.trim());
            }
        }
    }
    return candidates;
};
const tryParseJsonCandidate = (candidate) => {
    const trimmed = candidate.trim().replace(/\u0000/g, '');
    if (!trimmed)
        return null;
    const attempts = [trimmed];
    const first = trimmed.indexOf('{');
    const last = trimmed.lastIndexOf('}');
    if (first !== -1 && last !== -1 && last > first) {
        attempts.push(trimmed.slice(first, last + 1));
    }
    for (const attempt of attempts) {
        try {
            return JSON.parse(attempt);
        }
        catch {
            continue;
        }
    }
    return null;
};
export async function performWebSearch(args) {
    const parsed = webSearchArgsSchema.parse(args);
    if (process.env.MOCK_WEB_SEARCH === 'true') {
        const hashed = hashId(parsed.query);
        const hits = Array.from({ length: parsed.maxResults }).map((_, index) => ({
            id: `mock-${index + 1}-${hashed}`,
            title: `Mock evidence #${index + 1} for ${parsed.query}`,
            url: `https://example.com/mock/${hashed}/${index + 1}`,
            snippet: `Synthetic snippet ${index + 1} supporting fact-checking for "${parsed.query}".`,
            publishedAt: new Date(2024, 0, 1 + index).toISOString(),
            source: 'MockSearch',
        }));
        return {
            summary: `Mock summary for "${parsed.query}"`,
            hits,
            query: parsed.query,
            model: 'mock-web-search',
        };
    }
    const client = getClient();
    const model = process.env.CANVAS_STEWARD_SEARCH_MODEL ||
        process.env.DEBATE_STEWARD_SEARCH_MODEL ||
        'gpt-5-mini';
    const systemPrompt = `You are a meticulous research librarian. Use web_search to gather live evidence for debate fact-checking. 
Return STRICT JSON with shape:
{
  "summary": string,
  "hits": [
    {
      "title": string,
      "url": string,
      "snippet": string,
      "publishedAt"?: string,
      "source"?: string
    }
  ]
}
Do not include markdown or commentary. Snippets must cite concrete facts supporting or refuting the query. Prefer authoritative sources.`;
    const userPrompt = `Query: ${parsed.query}
Max results: ${parsed.maxResults}
Instructions: Cite recent facts (<= 18 months old when possible). Provide direct URLs, not generic homepages.`;
    const response = await client.responses.create({
        model,
        reasoning: { effort: 'medium' },
        input: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
        ],
        tools: [{ type: 'web_search' }],
        max_output_tokens: 600,
    });
    const structured = (() => {
        const candidates = collectTextCandidates(response, response.output_text);
        for (const candidate of candidates) {
            const parsedCandidate = tryParseJsonCandidate(candidate);
            if (parsedCandidate && typeof parsedCandidate === 'object') {
                return parsedCandidate;
            }
        }
        return null;
    })();
    if (!structured || typeof structured !== 'object') {
        const error = new Error('WEB_SEARCH_INVALID_OUTPUT');
        error.metadata = {
            outputText: response.output_text,
            output: response.output,
        };
        throw error;
    }
    const hits = coerceArray(structured?.hits ?? []);
    const summary = typeof structured?.summary === 'string' ? structured.summary : '';
    const normalizedHits = hits
        .map((hit) => ({
        id: hit.url ? `source-${hashId(hit.url)}` : `source-${hashId(hit.title ?? Math.random().toString())}`,
        title: hit.title?.trim() || 'Untitled source',
        url: hit.url ?? '',
        snippet: hit.snippet?.trim() || '',
        publishedAt: hit.publishedAt,
        source: hit.source?.trim(),
    }))
        .filter((hit) => Boolean(hit.url) && Boolean(hit.snippet));
    if (!normalizedHits.length) {
        throw new Error('WEB_SEARCH_NO_RESULTS');
    }
    const usage = response.usage
        ? {
            outputTokens: response.usage.output_tokens,
            searchTokens: response.usage.total_tokens - response.usage.output_tokens,
        }
        : undefined;
    return {
        summary: summary || `Top findings for "${parsed.query}"`,
        hits: normalizedHits.slice(0, parsed.maxResults),
        query: parsed.query,
        model,
        usage,
    };
}
//# sourceMappingURL=web-search.js.map