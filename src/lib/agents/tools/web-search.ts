import crypto from 'node:crypto';
import OpenAI from 'openai';
import { z } from 'zod';

export const webSearchArgsSchema = z.object({
  query: z.string().min(4, 'query must be at least 4 characters').max(400),
  maxResults: z.number().int().min(1).max(6).default(3),
  includeAnswer: z.boolean().default(true),
});
export type WebSearchArgs = z.infer<typeof webSearchArgsSchema>;

export type WebSearchHit = {
  id: string;
  title: string;
  url: string;
  snippet: string;
  publishedAt?: string;
  source?: string;
};

export type WebSearchResponse = {
  summary: string;
  hits: WebSearchHit[];
  query: string;
  model: string;
  usage?: {
    outputTokens?: number;
    searchTokens?: number;
  };
};

let cachedClient: OpenAI | null = null;

function getClient(): OpenAI {
  if (cachedClient) return cachedClient;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || !apiKey.trim()) {
    throw new Error('OPENAI_API_KEY missing for web search');
  }
  cachedClient = new OpenAI({ apiKey });
  return cachedClient;
}

function hashId(value: string): string {
  return crypto.createHash('sha1').update(value).digest('hex').slice(0, 16);
}

function coerceArray<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  return [];
}

export async function performWebSearch(args: WebSearchArgs): Promise<WebSearchResponse> {
  const parsed = webSearchArgsSchema.parse(args);
  const client = getClient();
  const model =
    process.env.CANVAS_STEWARD_SEARCH_MODEL ||
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
    max_output_tokens: 500,
  });

  const outputText = response.output_text?.trim();
  if (!outputText) {
    throw new Error('WEB_SEARCH_EMPTY_OUTPUT');
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(outputText);
  } catch {
    const maybeJson = response.output
      .flatMap((item) => ('content' in item ? item.content : []))
      .find((block) => block.type === 'output_text');
    if (!maybeJson || !('text' in maybeJson)) {
      throw new Error('WEB_SEARCH_INVALID_OUTPUT');
    }
    parsedJson = JSON.parse((maybeJson as any).text);
  }

  const hits = coerceArray<Partial<WebSearchHit>>((parsedJson as any)?.hits ?? []);
  const summary = typeof (parsedJson as any)?.summary === 'string' ? (parsedJson as any).summary : '';

  const normalizedHits: WebSearchHit[] = hits
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
