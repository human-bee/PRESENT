import { z } from 'zod';
import { performWebSearch, type WebSearchHit } from '@/lib/agents/tools/web-search';
import type { JsonObject } from '@/lib/utils/json-schema';

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

export type SearchStewardInput = {
  task: string;
  params: JsonObject;
};

export type ResearchResultCard = {
  id: string;
  title: string;
  content: string;
  source: {
    name: string;
    url?: string;
    credibility: 'high' | 'medium' | 'low';
    type: 'news' | 'academic' | 'wiki' | 'blog' | 'social' | 'government' | 'other';
  };
  relevance: number;
  timestamp: string;
  tags?: string[];
  factCheck?: {
    status: 'verified' | 'disputed' | 'unverified' | 'false';
    confidence: number;
  };
};

export type ResearchPanelPayload = {
  title: string;
  currentTopic?: string;
  results: ResearchResultCard[];
  isLive?: boolean;
  showCredibilityFilter?: boolean;
  maxResults?: number;
};

export type SearchStewardResult = {
  status: 'ok' | 'error' | 'unsupported';
  bundle?: {
    query: string;
    summary: string;
    model: string;
    hits: WebSearchHit[];
    _trace?: {
      provider: 'openai';
      model: string;
      providerSource: 'runtime_selected';
      providerPath: 'primary';
      providerRequestId?: string;
    };
  };
  panel?: ResearchPanelPayload;
  componentId?: string;
  error?: string;
};

const DEFAULT_RESULT_SOURCE = {
  credibility: 'medium' as const,
  type: 'news' as const,
};

export async function runSearchSteward({ task, params }: SearchStewardInput): Promise<SearchStewardResult> {
  if (task === 'search.general') {
    return runGeneralSearch(params);
  }

  return { status: 'unsupported', error: `No search steward for task: ${task}` };
}

async function runGeneralSearch(rawParams: JsonObject): Promise<SearchStewardResult> {
  const parsed = GeneralSearchArgs.parse(rawParams);
  const { query } = parsed;
  try {
    const searchResponse = await performWebSearch({
      query,
      maxResults: parsed.maxResults ?? 3,
      includeAnswer: parsed.includeAnswer ?? true,
    });

    const panel: ResearchPanelPayload = {
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
        _trace: searchResponse._trace,
      },
      panel,
      componentId: parsed.componentId,
    };
  } catch (error) {
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

function mapHitToResult(hit: any, index: number): ResearchResultCard {
  const url: string | undefined = typeof hit.url === 'string' ? hit.url : undefined;
  let hostname = 'web';
  if (url) {
    try {
      hostname = new URL(url).hostname.replace(/^www\./, '');
    } catch {
      hostname = url;
    }
  }

  return {
    id: typeof hit.id === 'string' ? hit.id : `hit-${index}`,
    title: (hit.title as string) || 'Untitled result',
    content: (hit.snippet as string) || (hit.summary as string) || 'No snippet provided.',
    source: {
      name: (hit.source as string) || hostname,
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
