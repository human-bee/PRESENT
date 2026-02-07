'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useComponentRegistration } from '@/lib/component-registry';
import { cn } from '@/lib/utils';
import { LoadingWrapper } from '@/components/ui/shared/loading-states';
import { Button } from '@/components/ui/shared/button';
import { useComponentSubAgent } from '@/lib/component-subagent';
import { useCanvasContext } from '@/lib/hooks/use-canvas-context';
import { LinearMcpClient } from '@/lib/linear-mcp-client';

import {
  linearKanbanSchema,
  type LinearKanbanProps,
  type LinearStatus,
  type LoadEvent,
  type LoadStatus,
  type ExtendedKanbanState,
  type KanbanColumn,
  humanizeLoadStep,
  useLinearApiKey,
  useLinearSync,
  useLinearDataEnricher,
} from '@/lib/linear';

import { useKanbanDragDrop } from './use-kanban-drag-drop';
import { KanbanColumnComponent } from './linear-kanban-column';
import { IssueDetailModal, type Comment } from './linear-kanban-modal';
import { KanbanSkeleton } from './linear-kanban-skeleton';
import { WidgetFrame } from './widget-frame';

export { linearKanbanSchema };
export type { LinearKanbanProps };

const defaultTeams: { id: string; name: string }[] = [];
const defaultStatuses: { id: string; type: string; name: string }[] = [];

export default function LinearKanbanBoard({
  title = 'Linear Kanban Board',
  teams = defaultTeams,
  statuses = defaultStatuses,
  issues: initialIssues,
  __custom_message_id,
  className,
}: LinearKanbanProps) {
  const fallbackMessageIdRef = useRef<string>();
  if (!fallbackMessageIdRef.current) {
    fallbackMessageIdRef.current = `linear-kanban-${crypto.randomUUID()}`;
  }
  const messageId = (__custom_message_id?.trim() || fallbackMessageIdRef.current)!;
  const { sessionId } = useCanvasContext(); // Get room/session for context documents

  const [state, setState] = useState<ExtendedKanbanState>({
    selectedTeam: teams[0]?.id ?? '',
    selectedProject: undefined,
    issues: initialIssues || [],
    draggedIssue: null,
    pendingUpdates: [],
    updateMessage: '',
    selectedIssue: null,
    comments: {},
    activeDropColumn: null,
    dropIndicator: null,
    linearApiKey: '',
    availableTeams: [],
    availableStatuses: [],
    availableProjects: [],
  });

  const [loadStatus, setLoadStatus] = useState<LoadStatus>({ step: 'idle', message: 'Waiting to connect…', lastUpdated: Date.now() });
  const [events, setEvents] = useState<LoadEvent[]>([]);

  const pushEvent = useCallback((update: Omit<LoadEvent, 'ts'>) => {
    const evt: LoadEvent = { ...update, ts: Date.now() };
    setEvents((prev) => [evt, ...prev].slice(0, 20));
    setLoadStatus({ step: update.phase, message: update.message, lastUpdated: Date.now() });
  }, []);

  const apiKeyHook = useLinearApiKey({
    onSave: () => pushEvent({ phase: 'starting', message: 'Saved API key. Reloading Linear…' }),
    onClear: () => pushEvent({ phase: 'idle', message: 'API key cleared' }),
  });

  useEffect(() => {
    setState(prev => ({ ...prev, linearApiKey: apiKeyHook.apiKey }));
  }, [apiKeyHook.apiKey]);

  const linearSync = useLinearSync({
    apiKey: state.linearApiKey,
    teamId: state.selectedTeam,
    pendingUpdates: state.pendingUpdates,
    onStart: (count) => setState(prev => ({ ...prev, updateMessage: `Syncing ${count} updates to Linear...` })),
    onSuccess: (count) => setState(prev => ({ ...prev, pendingUpdates: [], updateMessage: `✓ Synced ${count} update${count !== 1 ? 's' : ''} to Linear` })),
    onPartialSuccess: (success, fail) => setState(prev => ({ ...prev, pendingUpdates: prev.pendingUpdates.slice(success), updateMessage: `Synced ${success}, failed ${fail}. Check console.` })),
  });

  const subAgentConfig = useLinearDataEnricher({ apiKey: state.linearApiKey, teamId: state.selectedTeam, pushEvent });
  const subAgent = useComponentSubAgent(subAgentConfig);

  useEffect(() => {
    const linearResult = subAgent.enrichedData.linear as any;
    if (!linearResult?.linearBoard) return;
    const board = linearResult.linearBoard;
    setState(prev => ({
      ...prev,
      issues: board.issues?.length ? board.issues : prev.issues,
      availableTeams: board.teams || prev.availableTeams,
      availableStatuses: board.statuses || prev.availableStatuses,
      selectedTeam: board.selectedTeamId || prev.selectedTeam,
    }));
    if (linearResult.loadStatus) setLoadStatus(linearResult.loadStatus);
  }, [subAgent.enrichedData.linear]);

  const effectiveStatuses = useMemo(() => {
    if (state.availableStatuses?.length > 0) return state.availableStatuses;
    if (statuses?.length > 0) return statuses;
    const seen = new Map<string, LinearStatus>();
    state.issues.forEach((issue: any) => {
      const name = issue.status || issue.state?.name || 'Unknown';
      const id = (issue.statusId && issue.statusId.includes('-')) ? issue.statusId : issue.state?.id || name;
      if (!seen.has(id)) seen.set(id, { id, name, type: 'unknown' });
    });
    return Array.from(seen.values());
  }, [statuses, state.issues, state.availableStatuses]);

  const columns: KanbanColumn[] = effectiveStatuses.map((s: any, i: number) => {
    if (typeof s === 'string') return { id: s, title: s, key: `col-${i}-${s}` };
    return { id: s.id || s.name, title: s.name || s.id, key: `col-${i}-${s.id || s.name}` };
  });

  const canon = (str: string) => str.toLowerCase().replace(/\s+/g, '');
  const getIssuesForColumn = (columnId: string) =>
    state.issues.filter((i) => {
      const candidates = [i.statusId, i.status, (i as any).state?.id, (i as any).state?.name].filter(Boolean).map((v) => canon(String(v)));
      return candidates.includes(canon(columnId));
    });

  const handleStateChange = useCallback((updates: Partial<ExtendedKanbanState>) => {
    setState(prev => {
      const newState = { ...prev, ...updates };
      if (updates.pendingUpdates && prev.pendingUpdates) newState.pendingUpdates = [...prev.pendingUpdates, ...updates.pendingUpdates];
      return newState;
    });
  }, []);

  const dnd = useKanbanDragDrop({ issues: state.issues, effectiveStatuses, draggedIssue: state.draggedIssue, dropIndicator: state.dropIndicator, activeDropColumn: state.activeDropColumn, onStateChange: handleStateChange });

  const mcpClientRef = useRef<LinearMcpClient | null>(null);
  const mcpClientKeyRef = useRef<string>('');
  const getMcpClient = useCallback(() => {
    const key = state.linearApiKey?.trim() || '';
    if (!key) return null;
    if (!mcpClientRef.current || mcpClientKeyRef.current !== key) {
      mcpClientRef.current = new LinearMcpClient(key);
      mcpClientKeyRef.current = key;
    }
    return mcpClientRef.current;
  }, [state.linearApiKey]);

  const executeLinearMcpTool = useCallback(async (toolName: string, args: Record<string, unknown>) => {
    const client = getMcpClient();
    if (!client) {
      throw new Error('Linear API key missing');
    }
    const normalizedTool = String(toolName || '').trim().replace(/^mcp_/, '');
    return await client.executeAction(normalizedTool, args);
  }, [getMcpClient]);

  const processInstruction = useCallback(async (instruction: string) => {
    try {
      handleStateChange({ updateMessage: '🔄 Processing...' });

      const response = await fetch('/api/ai/linear-steward', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instruction,
          context: { issues: state.issues, hasPendingUpdates: state.pendingUpdates.length > 0 },
          room: sessionId, // Pass room for context document access
        }),
      });

      if (!response.ok) {
        handleStateChange({ updateMessage: '❌ Failed to process instruction' });
        return;
      }

      const data = await response.json();
      if (data?.status === 'error') {
        handleStateChange({ updateMessage: `❌ ${data.error || 'Error processing instruction'}` });
        return;
      }
      const action = (data?.action || data) as any;

      if (!action || action.kind === 'noOp') {
        handleStateChange({ updateMessage: action?.reason || 'No action taken' });
        return;
      }

      if (action.kind === 'syncPending') {
        if (state.pendingUpdates.length > 0) {
          linearSync.sync();
        } else {
          handleStateChange({ updateMessage: 'No pending updates to sync' });
        }
        return;
      }

      if (action.kind === 'moveIssue' && action.issueId && action.toStatus) {
        dnd.queueStatusChange(action.issueId, action.toStatus);
        handleStateChange({ updateMessage: `📝 Queued move: ${action.toStatus}` });
        return;
      }

      if (!state.linearApiKey) {
        handleStateChange({ updateMessage: '⚠️ Add a Linear API key first' });
        return;
      }

      const selectedTeamId = state.selectedTeam || state.availableTeams?.[0]?.id || undefined;

      if (action.kind === 'createMultipleIssues' && Array.isArray(action.issuesData) && action.issuesData.length > 0) {
        handleStateChange({ updateMessage: `🚀 Creating ${action.issuesData.length} issue${action.issuesData.length === 1 ? '' : 's'} in Linear...` });
        let createdCount = 0;
        for (const issue of action.issuesData) {
          const title = typeof issue?.title === 'string' ? issue.title.trim() : '';
          const description = typeof issue?.description === 'string' ? issue.description : undefined;
          if (!title) continue;
          await executeLinearMcpTool('create_issue', {
            title,
            description,
            ...(selectedTeamId ? { team: selectedTeamId } : {}),
          });
          createdCount += 1;
        }
        handleStateChange({ updateMessage: `✓ Created ${createdCount} issue${createdCount === 1 ? '' : 's'}` });
        setTimeout(() => subAgent.forceReload(), 750);
        return;
      }

      const mcpToolName = typeof action.mcpTool?.name === 'string'
        ? action.mcpTool.name.trim().replace(/^mcp_/, '')
        : '';
      const mcpArgs: Record<string, unknown> = action.mcpTool?.args && typeof action.mcpTool.args === 'object'
        ? action.mcpTool.args
        : {};

      if (mcpToolName) {
        const hydratedArgs = { ...mcpArgs };
        if (mcpToolName === 'create_issue') {
          if (hydratedArgs.teamId !== undefined && hydratedArgs.team === undefined) {
            hydratedArgs.team = hydratedArgs.teamId;
            delete hydratedArgs.teamId;
          }
          if (selectedTeamId && hydratedArgs.team === undefined) {
            hydratedArgs.team = selectedTeamId;
          }
        }
        if (mcpToolName === 'update_issue') {
          if (hydratedArgs.issueId !== undefined && hydratedArgs.id === undefined) {
            hydratedArgs.id = hydratedArgs.issueId;
            delete hydratedArgs.issueId;
          }
          if (hydratedArgs.stateId !== undefined && hydratedArgs.state === undefined) {
            hydratedArgs.state = hydratedArgs.stateId;
            delete hydratedArgs.stateId;
          }
        }
        await executeLinearMcpTool(mcpToolName, hydratedArgs);
        handleStateChange({ updateMessage: `✓ ${mcpToolName} completed` });
        setTimeout(() => subAgent.forceReload(), 750);
        return;
      }

      handleStateChange({ updateMessage: `✓ ${action.kind} completed` });
    } catch (error) {
      console.error('[LinearKanban] processInstruction error:', error);
      handleStateChange({ updateMessage: '❌ Error processing instruction' });
    }
  }, [state.issues, state.pendingUpdates.length, state.linearApiKey, state.selectedTeam, state.availableTeams, dnd, linearSync, handleStateChange, subAgent, sessionId, executeLinearMcpTool]);

  const handleRegistryUpdate = useCallback((patch: Record<string, unknown>) => {
    if ('instruction' in patch && typeof patch.instruction === 'string') {
      processInstruction(patch.instruction);
    }
  }, [processInstruction]);

  useComponentRegistration(messageId, 'LinearKanbanBoard', { title, teams, statuses, issues: initialIssues }, 'canvas', handleRegistryUpdate);

  const handleIssueClick = useCallback((e: React.MouseEvent, issueId: string) => { e.stopPropagation(); setState(prev => ({ ...prev, selectedIssue: issueId })); }, []);
  const handleCloseModal = useCallback((e?: React.MouseEvent) => { e?.stopPropagation(); setState(prev => ({ ...prev, selectedIssue: null })); }, []);
  const handleAssigneeChange = useCallback((issueId: string, newAssignee: string) => { setState(prev => ({ ...prev, issues: prev.issues.map(i => i.id === issueId ? { ...i, assignee: newAssignee } : i) })); }, []);
  const handleAddComment = useCallback((issueId: string, text: string) => {
    const newComment: Comment = { id: Date.now().toString(), user: 'You', text, time: 'Just now' };
    setState(prev => ({ ...prev, comments: { ...prev.comments, [issueId]: [...(prev.comments[issueId] || []), newComment] } }));
  }, []);

  const selectedIssueData = state.selectedIssue ? state.issues.find((i) => i.id === state.selectedIssue) : null;
  const [boardWidth, setBoardWidth] = useState<number>(1200);

  useEffect(() => {
    const el = dnd.boardRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const next = Math.max(320, Math.round(entry.contentRect.width));
      setBoardWidth(next);
    });
    ro.observe(el);
    // Initial read
    setBoardWidth(Math.max(320, el.offsetWidth || 1200));
    return () => ro.disconnect();
  }, [dnd.boardRef]);

  const columnWidth = useMemo(() => {
    const cols = Math.max(1, columns.length);
    const gap = 16; // tailwind gap-4
    const available = Math.max(320, boardWidth - gap * (cols - 1));
    return Math.max(200, Math.min(320, Math.floor(available / cols)));
  }, [boardWidth, columns.length]);

  return (
    <LoadingWrapper state={subAgent.loadingState} skeleton={<KanbanSkeleton />}>
      <WidgetFrame
        title={title}
        subtitle={`${state.issues.length} issues across ${columns.length} columns`}
        meta={loadStatus.step !== 'idle' ? humanizeLoadStep(loadStatus.step) : undefined}
        actions={
          <span
            className={cn(
              'px-2 py-1 text-xs rounded-full border',
              loadStatus.step === 'ready'
                ? 'bg-success-surface text-success border-success-surface'
                : 'bg-surface-secondary text-secondary border-default',
            )}
          >
            {humanizeLoadStep(loadStatus.step)}
          </span>
        }
        className={className}
        bodyClassName="space-y-4"
      >

        {!apiKeyHook.hasApiKey ? (
          <div className="p-4 bg-surface-secondary rounded-xl border border-default">
            <label className="block text-sm font-medium text-secondary mb-2">Linear API Key</label>
            <div className="flex gap-2">
              <input
                type={apiKeyHook.showApiKey ? 'text' : 'password'}
                value={apiKeyHook.keyDraft}
                onChange={(e) => apiKeyHook.setKeyDraft(e.target.value)}
                placeholder="lin_api_..."
                className="flex-1 px-3 py-2 border border-default rounded-lg bg-surface text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--present-accent-ring)]"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => apiKeyHook.setShowApiKey(!apiKeyHook.showApiKey)}
              >
                {apiKeyHook.showApiKey ? 'Hide' : 'Show'}
              </Button>
              <Button type="button" size="sm" onClick={apiKeyHook.saveApiKey}>
                Save
              </Button>
            </div>
            <p className="text-xs text-tertiary mt-2">
              Get your API key from{' '}
              <a
                href="https://linear.app/settings/api"
                target="_blank"
                rel="noopener noreferrer"
                className="text-secondary underline underline-offset-4"
              >
                Linear Settings → API
              </a>
            </p>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-sm">
            <span className="text-success">✓ API Key configured</span>
            <Button type="button" variant="link" size="sm" onClick={apiKeyHook.clearApiKey}>
              Change key
            </Button>
          </div>
        )}

        {state.updateMessage && (
          <div className="bg-info-surface border border-info-surface text-info px-4 py-2 rounded-lg text-sm">
            {state.updateMessage}
          </div>
        )}

        {state.pendingUpdates.length > 0 && (
          <div className="bg-warning-surface border border-warning-surface rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-primary">Pending Linear Updates ({state.pendingUpdates.length})</h3>
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  onClick={linearSync.sync}
                  disabled={linearSync.isSyncing || !apiKeyHook.hasApiKey}
                  loading={linearSync.isSyncing}
                >
                  Send to Linear
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="destructive"
                  onClick={() => setState(prev => ({ ...prev, pendingUpdates: [], updateMessage: 'Cleared pending updates' }))}
                  disabled={linearSync.isSyncing}
                >
                  Clear
                </Button>
              </div>
            </div>
            <div className="space-y-2">
              {state.pendingUpdates.slice(-3).map((update) => (
                <div
                  key={update.id}
                  className="text-sm text-secondary bg-surface-elevated px-3 py-2 rounded-lg border border-default"
                >
                  <strong className="text-primary">{update.issueIdentifier}:</strong> {update.fromStatus} → {update.toStatus}
                </div>
              ))}
              {state.pendingUpdates.length > 3 && (
                <div className="text-xs text-secondary">... and {state.pendingUpdates.length - 3} more updates</div>
              )}
            </div>
          </div>
        )}

        {loadStatus.isRateLimited && (
          <div className="p-3 bg-warning-surface border border-warning-surface rounded-lg text-warning text-sm">
            Rate limited by Linear. Wait ~1 hour before refreshing.
          </div>
        )}

        <div
          ref={dnd.boardRef as any}
          className="flex gap-4 overflow-x-auto pb-4"
          style={{ minHeight: '400px' }}
          onDragOverCapture={dnd.handleBoardDragOver}
          onDropCapture={dnd.handleBoardDrop}
        >
          {columns.map((column) => (
            <KanbanColumnComponent key={column.key} column={column} issues={getIssuesForColumn(column.id)} draggedIssue={state.draggedIssue} dropIndicator={state.dropIndicator} isActiveDropColumn={state.activeDropColumn === column.id} columnWidth={columnWidth} onDragOver={dnd.handleDragOver} onDrop={dnd.handleDrop} onDragStart={dnd.handleDragStart} onDragOverCard={dnd.handleDragOverCard} onDragEnd={dnd.handleDragEnd} onIssueClick={handleIssueClick} />
          ))}
        </div>

        {state.draggedIssue && (
          <div className="fixed bottom-4 right-4 bg-surface-elevated text-primary px-4 py-2 rounded-xl shadow-lg border border-default z-50">
            Dragging: {state.issues.find((i) => i.id === state.draggedIssue)?.identifier}
          </div>
        )}

        {selectedIssueData && <IssueDetailModal issue={selectedIssueData} comments={state.comments[selectedIssueData.id] || []} statuses={effectiveStatuses} onClose={handleCloseModal} onStatusChange={dnd.queueStatusChange} onAssigneeChange={handleAssigneeChange} onAddComment={handleAddComment} />}

        <div className="pt-2 text-center text-sm text-tertiary">
          <strong className="text-secondary">Linear Integration:</strong> Drag to queue updates.
        </div>
      </WidgetFrame>
    </LoadingWrapper>
  );
}
