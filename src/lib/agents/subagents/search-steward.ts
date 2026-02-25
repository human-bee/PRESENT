import { z } from 'zod';
import { performWebSearch, type WebSearchHit } from '@/lib/agents/tools/web-search';
import type { JsonObject } from '@/lib/utils/json-schema';
import { getDecryptedUserModelKey } from '@/lib/agents/shared/user-model-keys';
import { resolveSharedKeyBySession } from '@/lib/agents/control-plane/shared-keys';
import { resolveModelControl } from '@/lib/agents/control-plane/resolver';
import { BYOK_ENABLED } from '@/lib/agents/shared/byok-flags';

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
      configVersion?: string;
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
    const requesterUserId =
      typeof rawParams.requesterUserId === 'string' && rawParams.requesterUserId.trim()
        ? rawParams.requesterUserId.trim()
        : null;
    const billingUserId =
      BYOK_ENABLED &&
      typeof rawParams.billingUserId === 'string' &&
      rawParams.billingUserId.trim()
        ? rawParams.billingUserId.trim()
        : null;
    const sharedUnlockSessionId =
      BYOK_ENABLED &&
      typeof rawParams.sharedUnlockSessionId === 'string' &&
      rawParams.sharedUnlockSessionId.trim()
        ? rawParams.sharedUnlockSessionId.trim()
        : null;
    const resolvedControl = await resolveModelControl({
      task: 'search.general',
      room: parsed.room,
      userId: requesterUserId ?? undefined,
      billingUserId: billingUserId ?? undefined,
      includeUserScope: true,
    }).catch(() => ({
      effective: {} as Record<string, unknown>,
      configVersion: 'env-fallback',
    }));
    const resolvedSearchModel = resolvedControl.effective.models?.searchModel;
    const resolvedSearchKnobs = resolvedControl.effective.knobs?.search;
    const byokUserId = BYOK_ENABLED ? (billingUserId || requesterUserId) : null;
    const byokKey = byokUserId
      ? await getDecryptedUserModelKey({ userId: byokUserId, provider: 'openai' })
      : null;
    const sharedKey =
      !byokKey && sharedUnlockSessionId && requesterUserId
        ? await resolveSharedKeyBySession({
            sessionId: sharedUnlockSessionId,
            userId: requesterUserId,
            provider: 'openai',
            roomScope: parsed.room,
          })
        : null;
    if (BYOK_ENABLED && !byokKey && !sharedKey) {
      throw new Error('BYOK_MISSING_KEY:openai');
    }
    const searchResponse = await performWebSearch({
      query,
      maxResults: parsed.maxResults ?? resolvedSearchKnobs?.maxResults ?? 3,
      includeAnswer: parsed.includeAnswer ?? resolvedSearchKnobs?.includeAnswer ?? true,
    }, {
      apiKey: byokKey ?? sharedKey ?? undefined,
      model: resolvedSearchModel ?? resolvedSearchKnobs?.model,
      configVersion: resolvedControl.configVersion,
      cacheTtlMs:
        typeof resolvedSearchKnobs?.cacheTtlSec === 'number'
          ? resolvedSearchKnobs.cacheTtlSec * 1000
          : undefined,
      costPerMinuteLimit: resolvedSearchKnobs?.costPerMinuteLimit,
    });

    const panel: ResearchPanelPayload = {
      title: `Research findings for “${query}”`,
      currentTopic: parsed.topic || query,
      results: searchResponse.hits.map((hit, index) => mapHitToResult(hit, index)),
      isLive: true,
      showCredibilityFilter: true,
      maxResults: parsed.maxResults ?? resolvedSearchKnobs?.maxResults ?? 3,
    };

    return {
      status: 'ok',
      bundle: {
        query,
        summary: searchResponse.summary,
        model: searchResponse.model,
        hits: searchResponse.hits,
        _trace: {
          ...searchResponse._trace,
          configVersion: resolvedControl.configVersion,
        },
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

const asRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
};

function mapHitToResult(hit: unknown, index: number): ResearchResultCard {
  const hitRecord = asRecord(hit) ?? {};
  const url: string | undefined = typeof hitRecord.url === 'string' ? hitRecord.url : undefined;
  let hostname = 'web';
  if (url) {
    try {
      hostname = new URL(url).hostname.replace(/^www\./, '');
    } catch {
      hostname = url;
    }
  }

  return {
    id: typeof hitRecord.id === 'string' ? hitRecord.id : `hit-${index}`,
    title: typeof hitRecord.title === 'string' ? hitRecord.title : 'Untitled result',
    content:
      (typeof hitRecord.snippet === 'string' && hitRecord.snippet) ||
      (typeof hitRecord.summary === 'string' && hitRecord.summary) ||
      'No snippet provided.',
    source: {
      name: typeof hitRecord.source === 'string' ? hitRecord.source : hostname,
      url,
      ...DEFAULT_RESULT_SOURCE,
    },
    relevance: Math.max(10, 100 - index * 15),
    timestamp: typeof hitRecord.publishedAt === 'string' && hitRecord.publishedAt.trim()
      ? hitRecord.publishedAt
      : new Date().toISOString(),
    tags: [],
  };
}
