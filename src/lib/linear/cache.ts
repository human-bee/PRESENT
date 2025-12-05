import type { LinearTeam, LinearProject, LinearStatus, LinearIssue } from './types';

const LINEAR_CACHE_PREFIX = 'linear_cache_';
const LINEAR_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes cache TTL
const LINEAR_CACHE_STALE_TTL_MS = 30 * 60 * 1000;

export const linearCache: {
  teams: LinearTeam[];
  projectsByTeam: Record<string, LinearProject[]>;
  statusesByTeam: Record<string, LinearStatus[]>;
  issuesByTeam: Record<string, LinearIssue[]>;
  stateUuidMapping: Map<string, string>;
  lastUpdated: number;
  requestCount: number;
  lastRequestTime: number;
} = {
  teams: [],
  projectsByTeam: {},
  statusesByTeam: {},
  issuesByTeam: {},
  stateUuidMapping: new Map(),
  lastUpdated: 0,
  requestCount: 0,
  lastRequestTime: 0,
};

export let inFlightLoadPromise: Promise<any> | null = null;
export let inFlightLoadKey: string | null = null;

export function setInFlightLoad(promise: Promise<any> | null, key: string | null) {
  inFlightLoadPromise = promise;
  inFlightLoadKey = key;
}

export function loadCacheFromStorage(apiKeyHash: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const cached = localStorage.getItem(`${LINEAR_CACHE_PREFIX}${apiKeyHash}`);
    if (!cached) return false;

    const parsed = JSON.parse(cached);
    const age = Date.now() - (parsed.lastUpdated || 0);

    // Don't use if completely stale
    if (age > LINEAR_CACHE_STALE_TTL_MS) {
      console.log('[LinearKanban] Cache too stale, ignoring', { ageMinutes: Math.round(age / 60000) });
      return false;
    }

    linearCache.teams = parsed.teams || [];
    linearCache.projectsByTeam = parsed.projectsByTeam || {};
    linearCache.statusesByTeam = parsed.statusesByTeam || {};
    linearCache.issuesByTeam = parsed.issuesByTeam || {};
    // Restore state UUID mapping from object to Map
    if (parsed.stateUuidMapping && typeof parsed.stateUuidMapping === 'object') {
      linearCache.stateUuidMapping = new Map(Object.entries(parsed.stateUuidMapping));
    }
    linearCache.lastUpdated = parsed.lastUpdated || 0;

    console.log('[LinearKanban] Loaded cache from localStorage', {
      teams: linearCache.teams.length,
      ageMinutes: Math.round(age / 60000),
      isFresh: age < LINEAR_CACHE_TTL_MS,
      stateUuidMappingSize: linearCache.stateUuidMapping?.size || 0,
    });

    return age < LINEAR_CACHE_TTL_MS;
  } catch (e) {
    console.warn('[LinearKanban] Failed to load cache from localStorage', e);
    return false;
  }
}

export function saveCacheToStorage(apiKeyHash: string): void {
  if (typeof window === 'undefined') return;
  try {
    const toSave = {
      teams: linearCache.teams,
      projectsByTeam: linearCache.projectsByTeam,
      statusesByTeam: linearCache.statusesByTeam,
      issuesByTeam: linearCache.issuesByTeam,
      stateUuidMapping: linearCache.stateUuidMapping?.size
        ? Object.fromEntries(linearCache.stateUuidMapping)
        : {},
      lastUpdated: linearCache.lastUpdated,
    };
    localStorage.setItem(`${LINEAR_CACHE_PREFIX}${apiKeyHash}`, JSON.stringify(toSave));
    console.log('[LinearKanban] Saved cache to localStorage', {
      stateUuidMappingSize: linearCache.stateUuidMapping?.size || 0,
    });
  } catch (e) {
    console.warn('[LinearKanban] Failed to save cache to localStorage', e);
  }
}

export function hashApiKey(key: string): string {
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    const char = key.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return hash.toString(36);
}

export function clearLinearCache(): void {
  linearCache.teams = [];
  linearCache.projectsByTeam = {};
  linearCache.statusesByTeam = {};
  linearCache.issuesByTeam = {};
  linearCache.stateUuidMapping = new Map();
  linearCache.lastUpdated = 0;
}

export function getCacheStats() {
  return {
    teamsCount: linearCache.teams.length,
    issuesByTeamCount: Object.keys(linearCache.issuesByTeam).length,
    lastUpdatedAgo: linearCache.lastUpdated
      ? `${Math.round((Date.now() - linearCache.lastUpdated) / 1000)}s`
      : 'never',
    requestCount: linearCache.requestCount,
    lastRequestAgo: linearCache.lastRequestTime
      ? `${Math.round((Date.now() - linearCache.lastRequestTime) / 1000)}s`
      : 'never',
  };
}


