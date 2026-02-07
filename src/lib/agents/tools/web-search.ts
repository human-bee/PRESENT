import crypto from 'node:crypto';
import OpenAI from 'openai';
import { z } from 'zod';
import { BYOK_REQUIRED } from '@/lib/agents/shared/byok-flags';

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

const clientByKey = new Map<string, OpenAI>();

function getClient(apiKey?: string): OpenAI {
  const explicit = typeof apiKey === 'string' ? apiKey.trim() : '';
  if (BYOK_REQUIRED) {
    if (!explicit) {
      throw new Error('BYOK_MISSING_KEY:openai');
    }
    const cached = clientByKey.get(explicit);
    if (cached) return cached;
    const client = new OpenAI({ apiKey: explicit });
    clientByKey.set(explicit, client);
    return client;
  }

  const fallback = explicit || (process.env.OPENAI_API_KEY ?? '').trim();
  if (!fallback) {
    throw new Error('OPENAI_API_KEY missing for web search');
  }

  const cached = clientByKey.get(fallback);
  if (cached) return cached;
  const client = new OpenAI({ apiKey: fallback });
  clientByKey.set(fallback, client);
  return client;
}

function hashId(value: string): string {
  return crypto.createHash('sha1').update(value).digest('hex').slice(0, 16);
}

function coerceArray<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  return [];
}

const collectTextCandidates = (
  response: OpenAI.Responses.Response,
  rawText?: string | null,
): string[] => {
  const candidates: string[] = [];
  if (rawText && rawText.trim()) candidates.push(rawText.trim());
  const outputItems = Array.isArray((response as any)?.output) ? (response as any).output : [];
  for (const item of outputItems) {
    if (!item || typeof item !== 'object') continue;
    if (typeof (item as any).text === 'string' && (item as any).text.trim()) {
      candidates.push((item as any).text.trim());
    }
    const content = Array.isArray((item as any).content) ? (item as any).content : [];
    for (const chunk of content) {
      if (chunk && typeof chunk.text === 'string' && chunk.text.trim()) {
        candidates.push(chunk.text.trim());
      }
    }
  }
  return candidates;
};

const tryParseJsonCandidate = (candidate: string): any | null => {
  const trimmed = candidate.trim().replace(/\u0000/g, '');
  if (!trimmed) return null;
  const attempts: string[] = [trimmed];
  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (first !== -1 && last !== -1 && last > first) {
    attempts.push(trimmed.slice(first, last + 1));
  }
  for (const attempt of attempts) {
    try {
      return JSON.parse(attempt);
    } catch {
      continue;
    }
  }
  return null;
};

export async function performWebSearch(
  args: WebSearchArgs,
  options?: { apiKey?: string },
): Promise<WebSearchResponse> {
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
  const client = getClient(options?.apiKey);
  const model =
    process.env.CANVAS_STEWARD_SEARCH_MODEL ||
    process.env.DEBATE_STEWARD_SEARCH_MODEL ||
    'gpt-5-mini';

  const systemPrompt = `You are a JSON API for web evidence used in debate fact-checking.

You MUST call web_search to gather live evidence.

Return STRICT JSON only (no markdown, no backticks, no commentary) with shape:
{
  "summary": string,
  "hits": [
    {
      "title": string,
      "url": string,
      "snippet": string,
      "publishedAt": string | null,
      "source": string | null
    }
  ]
}

Rules:
- hits.length must equal Max results.
- summary must be <= 280 characters.
- snippet must be <= 180 characters and state concrete, checkable facts relevant to the query.
- url must be a direct https:// URL (not a generic homepage when avoidable).
- Prefer authoritative sources.`;

  const userPrompt = `Query: ${parsed.query}
Max results: ${parsed.maxResults}
Instructions:
- Include both supporting and refuting evidence when available.
- Prefer recent sources (<= 18 months) when possible.
- Return exactly ${parsed.maxResults} hits.`;

  const response = await client.responses.create({
    model,
    reasoning: { effort: 'low' },
    input: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    tools: [{ type: 'web_search' }],
    max_output_tokens: 1200,
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
    (error as Error & { metadata?: unknown }).metadata = {
      outputText: response.output_text,
      output: (response as any).output,
    };
    throw error;
  }

  const hits = coerceArray<Partial<WebSearchHit>>((structured as any)?.hits ?? []);
  const summary = typeof (structured as any)?.summary === 'string' ? (structured as any).summary : '';

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
