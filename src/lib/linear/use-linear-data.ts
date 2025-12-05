'use client';

import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { useComponentSubAgent, SubAgentPresets } from '@/lib/component-subagent';
import type { 
  LoadPhase, 
  LoadEvent, 
  LoadStatus, 
  LinearTeam, 
  LinearProject, 
  LinearStatus, 
  LinearIssue,
  LinearBoardData,
} from './types';
import { 
  linearCache, 
  loadCacheFromStorage, 
  saveCacheToStorage, 
  hashApiKey, 
  clearLinearCache,
  inFlightLoadPromise,
  inFlightLoadKey,
  setInFlightLoad,
} from './cache';
import { fetchWorkflowStatesViaGraphQL, updateIssueViaGraphQL } from './graphql';
import { normalizeTeams, normalizeIssues, normalizeStatuses } from './normalizers';

export interface UseLinearDataOptions {
  apiKey: string;
  selectedTeamId?: string;
  onEvent?: (event: LoadEvent) => void;
}

export interface UseLinearDataReturn {
  loadStatus: LoadStatus;
  events: LoadEvent[];
  loadingState: any;
  enrichedData: any;
  forceReload: () => void;
  triggerAction: (context: any) => void;
}

export function useLinearData(options: UseLinearDataOptions): UseLinearDataReturn {
  const { apiKey, selectedTeamId, onEvent } = options;
  
  const [loadStatus, setLoadStatus] = useState<LoadStatus>({
    step: 'idle',
    message: 'Waiting to connect…',
    lastUpdated: Date.now(),
  });
  const [events, setEvents] = useState<LoadEvent[]>([]);

  const pushEvent = useCallback((update: Omit<LoadEvent, 'ts'>) => {
    const evt: LoadEvent = { ...update, ts: Date.now() };
    console.log('[LinearKanban][event]', evt);
    setEvents((prev) => [evt, ...prev].slice(0, 20));
    setLoadStatus({ step: update.phase, message: update.message, lastUpdated: Date.now() });
    onEvent?.(evt);
  }, [onEvent]);

  // Create the data enricher function
  const dataEnricher = useCallback((context: any, tools: any) => {
    console.log('[LinearKanban] dataEnricher called', { context, toolsAvailable: Object.keys(tools || {}) });

    const key = context.linearApiKey?.trim();
    if (!key) {
      pushEvent({ phase: 'error', message: 'Add a Linear API key to load issues.' });
      return [];
    }

    const apiKeyHash = hashApiKey(key);
    const linearTool = tools.linear;

    const runFullLoad = async () => {
      const log = (phase: LoadPhase, message: string, meta?: Record<string, unknown>) => {
        pushEvent({ phase, message, meta });
      };

      try {
        const cacheIsFresh = loadCacheFromStorage(apiKeyHash);
        
        log('starting', 'Starting full load (MCP-based)', {
          query: context.requestedTeam,
          teamId: context.selectedTeamId,
          cacheIsFresh,
        });

        if (!linearTool || typeof linearTool.execute !== 'function') {
          if (linearCache.teams.length > 0) {
            log('fetchingTeams', 'MCP unavailable, using cached data');
          } else {
            const err = new Error('Linear MCP tool unavailable and no cached data');
            log('error', err.message);
            throw err;
          }
        }

        linearCache.requestCount++;
        linearCache.lastRequestTime = Date.now();

        // 1) Teams
        let teamsData: LinearTeam[] = linearCache.teams;
        if (!teamsData.length && linearTool) {
          log('fetchingTeams', 'Calling MCP:list_teams');
          const respTeams = await linearTool.execute({ tool: 'list_teams', params: {} });
          teamsData = normalizeTeams(respTeams);
          if (teamsData.length) {
            linearCache.teams = teamsData;
            linearCache.lastUpdated = Date.now();
          }
        }

        const selectedTeam = teamsData.find((t) => t.id === context.selectedTeamId) || teamsData[0];
        const selectedTeamIdResolved = selectedTeam?.id;

        // 2) Workflow states
        let statuses: LinearStatus[] = (selectedTeamIdResolved && linearCache.statusesByTeam[selectedTeamIdResolved]) || [];

        if (linearTool && selectedTeamIdResolved && (!statuses.length || !linearCache.stateUuidMapping?.size)) {
          try {
            log('fetchingIssues', 'Calling MCP:list_workflow_states', { teamId: selectedTeamIdResolved });
            const statesResp = await linearTool.execute({
              tool: 'list_workflow_states',
              params: { teamId: selectedTeamIdResolved },
            });
            
            const rawStates = Array.isArray(statesResp) 
              ? statesResp 
              : statesResp?.states || statesResp?.workflowStates || statesResp?.nodes || [];
            
            if (Array.isArray(rawStates) && rawStates.length > 0) {
              const newMapping = new Map<string, string>();
              const normalizedStatuses: LinearStatus[] = [];
              
              for (const state of rawStates) {
                const name = state.name || state.status || 'Unknown';
                const id = state.id || state.stateId;
                const type = state.type || 'unknown';
                
                if (id && name) {
                  newMapping.set(name, id);
                  normalizedStatuses.push({ id, name, type });
                }
              }
              
              if (newMapping.size > 0) {
                linearCache.stateUuidMapping = newMapping;
                statuses = normalizedStatuses;
                if (selectedTeamIdResolved) {
                  linearCache.statusesByTeam[selectedTeamIdResolved] = statuses;
                }
                saveCacheToStorage(apiKeyHash);
              }
            }
          } catch (e: any) {
            console.warn('[LinearKanban] list_workflow_states failed:', e?.message);
          }
          
          // Fallback to GraphQL
          if (!linearCache.stateUuidMapping?.size && context.linearApiKey && selectedTeamIdResolved) {
            try {
              const graphqlMapping = await fetchWorkflowStatesViaGraphQL(context.linearApiKey, selectedTeamIdResolved);
              
              if (graphqlMapping.size > 0) {
                linearCache.stateUuidMapping = graphqlMapping;
                const normalizedStatuses: LinearStatus[] = [];
                graphqlMapping.forEach((id, name) => {
                  normalizedStatuses.push({ id, name, type: 'unknown' });
                });
                statuses = normalizedStatuses;
                if (selectedTeamIdResolved) {
                  linearCache.statusesByTeam[selectedTeamIdResolved] = statuses;
                }
                saveCacheToStorage(apiKeyHash);
              }
            } catch (graphqlErr) {
              console.warn('[LinearKanban] GraphQL fallback failed:', graphqlErr);
            }
          }
        }

        // 3) Issues
        log('fetchingIssues', 'Calling MCP:list_issues');
        const issueQueryTeam = selectedTeam?.key || selectedTeamIdResolved;

        const issuesResp = await linearTool.execute({
          tool: 'list_issues',
          params: {
            query: issueQueryTeam ? `team: ${issueQueryTeam}` : 'is:issue',
            includeCompleted: !!context.showCompleted,
          },
        });

        const rawIssues = Array.isArray((issuesResp as any)?.issues) || Array.isArray(issuesResp)
          ? (issuesResp as any)?.issues || issuesResp
          : issuesResp;

        const stateUuidMapping: Map<string, string> = linearCache.stateUuidMapping || new Map();
        const normalizeResult = normalizeIssues(rawIssues, statuses, stateUuidMapping);
        
        if (normalizeResult === 'RATE_LIMITED') {
          const cachedIssues = selectedTeamIdResolved 
            ? linearCache.issuesByTeam[selectedTeamIdResolved] || []
            : Object.values(linearCache.issuesByTeam).flat();
          
          return {
            linearBoard: {
              teams: teamsData,
              projects: [],
              statuses: selectedTeamIdResolved ? linearCache.statusesByTeam[selectedTeamIdResolved] || [] : [],
              issues: cachedIssues,
              selectedTeamId: selectedTeamIdResolved,
            } as LinearBoardData,
            loadStatus: {
              step: 'ready' as LoadPhase,
              message: `⚠️ Rate limited. Showing ${cachedIssues.length} cached issues.`,
              lastUpdated: Date.now(),
              isRateLimited: true,
            },
          };
        }
        
        const issues = normalizeResult;
        if (selectedTeamIdResolved && issues.length > 0) {
          linearCache.issuesByTeam[selectedTeamIdResolved] = issues;
        }

        // Infer statuses if needed
        if (!statuses.length && issues.length > 0) {
          const seen = new Map<string, LinearStatus>();
          issues.forEach((issue) => {
            const name = issue.status || 'Unknown';
            const id = stateUuidMapping?.get(name) || issue.statusId || name;
            if (!seen.has(name)) {
              seen.set(name, { id, name, type: 'unknown' });
            }
          });
          statuses = Array.from(seen.values());
        }

        const full: LinearBoardData = {
          teams: teamsData,
          projects: [],
          statuses,
          issues,
          selectedTeamId: selectedTeamIdResolved,
        };

        log('normalizing', 'runFullLoad completed', {
          teams: full.teams?.length,
          issues: full.issues?.length,
          statuses: full.statuses?.length,
        });

        if (full.issues?.length > 0) {
          saveCacheToStorage(apiKeyHash);
        }

        return {
          linearBoard: full,
          loadStatus: {
            step: 'ready' as LoadPhase,
            message: `Loaded ${issues.length} issues`,
            lastUpdated: Date.now(),
          },
        };
      } catch (error: any) {
        const message = error?.message || 'Failed to load Linear data';
        log('error', message);
        
        const cachedIssues = Object.values(linearCache.issuesByTeam).flat();
        if (cachedIssues.length > 0) {
          return {
            linearBoard: {
              teams: linearCache.teams || [],
              projects: [],
              statuses: Object.values(linearCache.statusesByTeam).flat(),
              issues: cachedIssues,
              selectedTeamId: context.selectedTeamId,
            } as LinearBoardData,
            loadStatus: {
              step: 'ready' as LoadPhase,
              message: `Showing ${cachedIssues.length} cached issues (MCP error)`,
              lastUpdated: linearCache.lastUpdated,
            },
          };
        }
        
        return {
          linearBoard: {
            teams: linearCache.teams || [],
            projects: [],
            statuses: [],
            issues: [],
            selectedTeamId: context.selectedTeamId,
          } as LinearBoardData,
          loadStatus: { step: 'error', message, lastUpdated: Date.now() },
        };
      }
    };

    // Deduplication
    const loadKey = `${apiKeyHash}-${context.selectedTeamId || 'default'}`;
    if (inFlightLoadPromise && inFlightLoadKey === loadKey) {
      return [inFlightLoadPromise];
    }
    
    const promise = runFullLoad().finally(() => {
      if (inFlightLoadKey === loadKey) {
        setInFlightLoad(null, null);
      }
    });
    setInFlightLoad(promise, loadKey);
    
    return [promise];
  }, [pushEvent]);

  const subAgentConfig = useMemo(() => ({
    ...SubAgentPresets.kanban,
    initialContext: {
      linearApiKey: apiKey?.trim(),
      selectedTeamId,
    },
    dataEnricher,
  }), [apiKey, selectedTeamId, dataEnricher]);

  const subAgent = useComponentSubAgent(subAgentConfig);

  // Track key changes to trigger reload
  const previousKeyRef = useRef<string | null>(null);
  useEffect(() => {
    const cleaned = apiKey?.trim();
    if (!cleaned) return;
    if (previousKeyRef.current === cleaned) return;
    previousKeyRef.current = cleaned;
    clearLinearCache();
    pushEvent({ phase: 'starting', message: 'Connecting to Linear…' });
    subAgent.forceReload();
  }, [apiKey, subAgent, pushEvent]);

  return {
    loadStatus,
    events,
    loadingState: subAgent.loadingState,
    enrichedData: subAgent.enrichedData,
    forceReload: subAgent.forceReload,
    triggerAction: subAgent.trigger,
  };
}


