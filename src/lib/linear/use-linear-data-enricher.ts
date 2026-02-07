'use client';

import { useMemo } from 'react';
import { SubAgentPresets } from '@/lib/component-subagent';
import {
  linearCache,
  loadCacheFromStorage,
  saveCacheToStorage,
  hashApiKey,
  normalizeTeams,
  normalizeIssues,
} from './index';
import type { LinearBoardData, LoadEvent, LinearStatus } from './types';

interface UseLinearDataEnricherOptions {
  apiKey: string | undefined;
  teamId: string | undefined;
  pushEvent: (event: Omit<LoadEvent, 'ts'>) => void;
}

export function useLinearDataEnricher({ apiKey, teamId, pushEvent }: UseLinearDataEnricherOptions) {
  return useMemo(() => ({
    ...SubAgentPresets.kanban,
    initialContext: {
      linearApiKey: apiKey?.trim(),
      selectedTeamId: teamId,
    },
    dataEnricher: (context: any, tools: any) => {
      const key = context.linearApiKey?.trim();
      if (!key) {
        pushEvent({ phase: 'error', message: 'Add a Linear API key to load issues.' });
        return [];
      }

      const apiKeyHash = hashApiKey(key);
      const linearTool = tools.linear;

      const runFullLoad = async () => {
        try {
          loadCacheFromStorage(apiKeyHash);
          pushEvent({ phase: 'starting', message: 'Loading Linear data...' });

          if (!linearTool) throw new Error('Linear MCP tool unavailable');

          pushEvent({ phase: 'fetchingTeams', message: 'Fetching teams...' });
          const respTeams = await linearTool.execute({ tool: 'list_teams', params: {} });
          const teamsData = normalizeTeams(respTeams);
          if (teamsData.length) {
            linearCache.teams = teamsData;
            linearCache.lastUpdated = Date.now();
          }

          const selectedTeam =
            teamsData.find((t) => t.id === context.selectedTeamId) || teamsData[0];
          const selectedTeamId = selectedTeam?.id;

          // Fetch statuses to power fast local queueing + GraphQL sync mapping.
          let statuses: LinearStatus[] = [];
          if (selectedTeamId) {
            try {
              pushEvent({ phase: 'fetchingIssues', message: 'Fetching issue statuses...' });
              const statesResp = await linearTool.execute({
                tool: 'list_issue_statuses',
                params: { team: selectedTeamId },
              });

              const rawStates = Array.isArray(statesResp)
                ? statesResp
                : statesResp?.issueStatuses || statesResp?.nodes || [];

              if (Array.isArray(rawStates) && rawStates.length > 0) {
                const mapping = new Map<string, string>();
                statuses = rawStates
                  .map((s: any) => {
                    const name = s?.name || s?.status || 'Unknown';
                    const id = s?.id || s?.stateId;
                    const type = s?.type || 'unknown';
                    if (id && name) mapping.set(name, id);
                    return id && name ? { id, name, type } : null;
                  })
                  .filter(Boolean) as LinearStatus[];

                if (mapping.size > 0) {
                  linearCache.stateUuidMapping = mapping;
                  linearCache.statusesByTeam[selectedTeamId] = statuses;
                }
              }
            } catch (error) {
              console.warn('[LinearKanban] list_issue_statuses failed:', error);
            }
          }

          pushEvent({ phase: 'fetchingIssues', message: 'Fetching issues...' });
          const issuesResp = await linearTool.execute({
            tool: 'list_issues',
            params: {
              ...(selectedTeamId ? { team: selectedTeamId } : {}),
              // Keep this small for demo speed and to avoid MCP "Too many subrequests."
              limit: 100,
              orderBy: 'updatedAt',
            },
          });

          const rawIssues = Array.isArray(issuesResp)
            ? issuesResp
            : Array.isArray((issuesResp as any)?.issues)
              ? (issuesResp as any).issues
              : Array.isArray((issuesResp as any)?.nodes)
                ? (issuesResp as any).nodes
                : issuesResp;

          const issues = normalizeIssues(rawIssues, statuses, linearCache.stateUuidMapping);

          if (issues === 'RATE_LIMITED') {
            const cachedIssues = selectedTeamId
              ? linearCache.issuesByTeam[selectedTeamId] || []
              : Object.values(linearCache.issuesByTeam).flat();
            return {
              linearBoard: { teams: teamsData, projects: [], statuses, issues: cachedIssues, selectedTeamId },
              loadStatus: {
                step: 'ready',
                message: `⚠️ Rate limited. Showing ${cachedIssues.length} cached issues.`,
                lastUpdated: Date.now(),
                isRateLimited: true,
              },
            };
          }

          if (selectedTeamId && Array.isArray(issues) && issues.length > 0) {
            linearCache.issuesByTeam[selectedTeamId] = issues;
          }

          saveCacheToStorage(apiKeyHash);
          return {
            linearBoard: { teams: teamsData, projects: [], statuses, issues, selectedTeamId } as LinearBoardData,
            loadStatus: { step: 'ready', message: `Loaded ${issues.length} issues`, lastUpdated: Date.now() },
          };
        } catch (error: any) {
          pushEvent({ phase: 'error', message: error?.message || 'Failed to load' });
          return { linearBoard: null, loadStatus: { step: 'error', message: error?.message, lastUpdated: Date.now() } };
        }
      };

      return [runFullLoad()];
    },
  }), [apiKey, teamId, pushEvent]);
}






