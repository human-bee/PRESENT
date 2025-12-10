'use client';

import { useCallback, useState } from 'react';
import { fetchWorkflowStatesViaGraphQL, updateIssueViaGraphQL } from './graphql';
import type { PendingUpdate } from './types';

interface UseLinearSyncOptions {
  apiKey: string | undefined;
  teamId: string | undefined;
  pendingUpdates: PendingUpdate[];
  onSuccess: (count: number) => void;
  onPartialSuccess: (successCount: number, failCount: number) => void;
  onStart: (count: number) => void;
}

export function useLinearSync({
  apiKey,
  teamId,
  pendingUpdates,
  onSuccess,
  onPartialSuccess,
  onStart,
}: UseLinearSyncOptions) {
  const [isSyncing, setIsSyncing] = useState(false);

  const sync = useCallback(async () => {
    if (!apiKey || !teamId || pendingUpdates.length === 0) return;

    setIsSyncing(true);
    onStart(pendingUpdates.length);

    const statusNameToId = await fetchWorkflowStatesViaGraphQL(apiKey, teamId);
    let successCount = 0;
    let failCount = 0;

    for (const update of pendingUpdates) {
      const stateId = statusNameToId.get(update.toStatus);
      if (!stateId) {
        console.warn(`[LinearKanban] No state ID found for "${update.toStatus}"`);
        failCount++;
        continue;
      }

      const result = await updateIssueViaGraphQL(apiKey, update.issueId, stateId);
      if (result.success) {
        successCount++;
      } else {
        console.error(`[LinearKanban] Failed to update ${update.issueIdentifier}:`, result.error);
        failCount++;
      }
    }

    setIsSyncing(false);
    if (failCount === 0) {
      onSuccess(successCount);
    } else {
      onPartialSuccess(successCount, failCount);
    }
  }, [apiKey, teamId, pendingUpdates, onSuccess, onPartialSuccess, onStart]);

  return { isSyncing, sync };
}







