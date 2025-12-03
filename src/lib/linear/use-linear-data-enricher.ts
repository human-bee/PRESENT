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
import type { LinearBoardData, LoadEvent } from './types';

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

          const respTeams = await linearTool.execute({ tool: 'list_teams', params: {} });
          const teamsData = normalizeTeams(respTeams);
          if (teamsData.length) {
            linearCache.teams = teamsData;
            linearCache.lastUpdated = Date.now();
          }

          const selectedTeam = teamsData[0];
          const selectedTeamId = selectedTeam?.id;

          pushEvent({ phase: 'fetchingIssues', message: 'Fetching issues...' });
          const issuesResp = await linearTool.execute({
            tool: 'list_issues',
            params: { query: selectedTeamId ? `team: ${selectedTeam.key || selectedTeamId}` : 'is:issue' },
          });

          const rawIssues = issuesResp?.issues || issuesResp || [];
          const issues = normalizeIssues(rawIssues, [], linearCache.stateUuidMapping);

          if (issues === 'RATE_LIMITED') {
            return {
              linearBoard: { teams: teamsData, projects: [], statuses: [], issues: [], selectedTeamId },
              loadStatus: { step: 'error', message: 'Rate limited', lastUpdated: Date.now(), isRateLimited: true },
            };
          }

          saveCacheToStorage(apiKeyHash);
          return {
            linearBoard: { teams: teamsData, projects: [], statuses: [], issues, selectedTeamId } as LinearBoardData,
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
