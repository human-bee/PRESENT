'use client';

import { z } from 'zod';
import { useCallback, useEffect, useId, useState, useMemo } from 'react';
import { useComponentRegistration } from '@/lib/component-registry';
import { cn } from '@/lib/utils';
import { LoadingState } from '@/lib/with-progressive-loading';
import { LoadingWrapper, SkeletonPatterns, Skeleton } from '@/components/ui/shared/loading-states';
import { useComponentSubAgent, SubAgentPresets } from '@/lib/component-subagent';

/* --------------------------------------------------------------------------
 * Schema
 * --------------------------------------------------------------------------*/

export const linearKanbanSchema = z.object({
  title: z.string().default('Linear Kanban Board (v2)').describe('Board title'),
  teams: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
      }),
    )
    .optional()
    .describe('Linear teams available to switch between'),
  statuses: z
    .array(
      z.object({
        id: z.string(),
        type: z.string(),
        name: z.string(),
      }),
    )
    .optional()
    .describe('Status definitions for the workflow'),
  issues: z
    .array(
      z.object({
        id: z.string(),
        identifier: z.string(),
        title: z.string(),
        status: z.string(),
        updatedAt: z.string(),
        priority: z.object({ value: z.number(), name: z.string() }).optional(),
        labels: z.array(z.string()).optional(),
        project: z.string().optional(),
        assignee: z.string().optional(),
      }),
    )
    .optional()
    .describe('Initial issues to render on the board'),
});

export type LinearKanbanProps = z.infer<typeof linearKanbanSchema> & {
  __custom_message_id?: string;
  className?: string;
};

/* --------------------------------------------------------------------------
 * Component State (managed by custom)
 * --------------------------------------------------------------------------*/

type KanbanState = {
  selectedTeam: string;
  issues: NonNullable<LinearKanbanProps['issues']>;
  draggedIssue: string | null; // issue id
  pendingUpdates: Array<{
    id: number;
    issueId: string;
    issueIdentifier: string;
    fromStatus: string;
    toStatus: string;
    statusId: string;
    timestamp: string;
  }>;
  updateMessage: string;
};

/* --------------------------------------------------------------------------
 * Default Example Data (used if none provided)
 * --------------------------------------------------------------------------*/

const defaultTeams = [
  { id: '671e5484-202d-44f5-afdf-4bc02e8db8f3', name: 'Personal/Biz Ops.' },
  { id: '70fa4084-3cc0-40ad-a5b4-bf092959bfd2', name: 'Prototypes' },
  { id: '3f3b9363-ba24-428c-85f7-46dc1e365104', name: 'Content Marketing' },
];

const defaultStatuses = [
  { id: '1f3e5996-0edc-49bc-b76f-6f92e66e2a64', type: 'backlog', name: 'Backlog' },
  { id: '4ef935e6-73a5-48ac-a19f-69ebcabaee28', type: 'unstarted', name: 'Todo' },
  { id: '0faff75f-ce2d-49ff-b67b-ef15f036f8d1', type: 'started', name: 'In Progress' },
  { id: '760c96e6-a68f-453c-a6ce-7b8ab7ac050d', type: 'started', name: 'Delegate to Agent' },
  { id: '7be8e2c9-3504-4cb1-8e75-ae1c6981a2f2', type: 'started', name: 'Blocked' },
  { id: '42346112-11d6-4c24-b3bd-064bc6db0028', type: 'started', name: 'Review Required' },
  { id: 'e48d006e-4510-4a16-9204-403d0807154e', type: 'completed', name: 'Done' },
];

/* Fallback columns if no statuses provided */
const fallbackColumns = [
  'Backlog',
  'Todo',
  'In Progress',
  'Delegate to Agent',
  'Blocked',
  'Review Required',
  'Done',
].map((c, index) => ({ id: c, title: c, key: `fallback-${index}-${c}` }));

/* --------------------------------------------------------------------------
 * Helper functions
 * --------------------------------------------------------------------------*/

const getPriorityColor = (priority?: { value: number; name: string }) => {
  if (!priority) return 'bg-gray-100 border-gray-300';
  switch (priority.value) {
    case 1:
      return 'bg-red-100 border-red-300 border-l-4 border-l-red-500'; // Urgent
    case 2:
      return 'bg-orange-100 border-orange-300 border-l-4 border-l-orange-500'; // High
    case 3:
      return 'bg-yellow-100 border-yellow-300 border-l-4 border-l-yellow-500'; // Medium
    case 4:
      return 'bg-green-100 border-green-300 border-l-4 border-l-green-500'; // Low
    default:
      return 'bg-gray-100 border-gray-300';
  }
};

const labelColors: Record<string, string> = {
  Work: 'bg-blue-100 text-blue-800',
  Personal: 'bg-purple-100 text-purple-800',
  Social: 'bg-green-100 text-green-800',
};

const getLabelColor = (label: string) => labelColors[label] || 'bg-gray-100 text-gray-800';

/* --------------------------------------------------------------------------
 * Component Implementation
 * --------------------------------------------------------------------------*/

export default function LinearKanbanBoard({
  title = 'Linear Kanban Board',
  teams = defaultTeams,
  statuses = defaultStatuses,
  issues: initialIssues,
  __custom_message_id,
  className,
}: LinearKanbanProps) {
  /* 1. Stable unique id for custom state */
  const instanceId = useId();

  // Derive a STABLE messageId that remains identical for this component tree
  const messageId = __custom_message_id || instanceId;

  /* Progressive Loading with Sub-Agent */
  const [subAgentError, setSubAgentError] = useState<Error | null>(null);

  // Memoize sub-agent config to prevent re-creation
  const subAgentConfig = useMemo(
    () => ({
      ...SubAgentPresets.kanban,
      dataEnricher: (context: any, tools: any) => {
        console.log('[LinearKanban] dataEnricher called', { context, toolsAvailable: Object.keys(tools || {}) });

        // If we already have initial issues, skip MCP calls
        if (initialIssues && initialIssues.length > 0) {
          console.log('[LinearKanban] Skipping MCP call, using initial issues');
          return [];
        }

        if (!tools.linear) {
          console.warn('[LinearKanban] Linear tool not available in tools object');
          return [];
        }

        console.log('[LinearKanban] Executing linear.list_issues');
        // Otherwise, fetch data via MCP
        return [
          tools.linear?.execute({
            action: 'list_issues',
            teamName: context.requestedTeam,
            includeCompleted: context.showCompleted,
          }),
        ];
      },
    }),
    [initialIssues],
  );

  const subAgent = useComponentSubAgent(subAgentConfig);

  const loadingState = subAgent.loadingState;

  /* 2. Use enriched data from sub-agent if available */
  const linearData = subAgent.enrichedData.linear || {};
  const enrichedIssues = linearData.issues || initialIssues || [];

  /* 3. Local component state */
  const [state, setState] = useState<KanbanState>({
    selectedTeam: teams[0]?.id ?? '',
    issues: enrichedIssues,
    draggedIssue: null,
    pendingUpdates: [],
    updateMessage: '',
  });

  // Sync enriched data to local state when it arrives
  useEffect(() => {
    if (linearData.issues && linearData.issues.length > 0) {
      setState((prev) => ({
        ...prev,
        issues: linearData.issues,
      }));
    }
  }, [linearData.issues]);

  /* 3. AI patch handler */
  const handleAIUpdate = useCallback(
    (patch: Partial<KanbanState>) => {
      if (!state) return;
      setState({ ...state, ...patch });
    },
    [state, setState],
  );

  /* 4. Component registration for update_component */
  useComponentRegistration(
    messageId,
    'LinearKanbanBoard',
    { title, teamId: state?.selectedTeam },
    'default',
    handleAIUpdate,
  );

  // Only dispatch showComponent if we are the ORIGINAL instance (i.e., not already rendered by CanvasSpace)
  useEffect(() => {
    // Avoid dispatching if __custom_message_id was provided (already under CanvasSpace)
    if (__custom_message_id) return;

    window.dispatchEvent(
      new CustomEvent('custom:showComponent', {
        detail: {
          messageId,
          component: (
            <LinearKanbanBoard
              __custom_message_id={messageId}
              title={title}
              teams={teams}
              statuses={statuses}
              issues={state?.issues}
            />
          ),
        },
      }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* -------------------------------------------- */
  if (!state) return null; // state not initialised yet

  /* Derived helpers */
  // Build columns dynamically from statuses if provided; otherwise use fallback
  const columns = (statuses?.length ? statuses : fallbackColumns).map((s: any, index: number) => {
    if (typeof s === 'string') return { id: s, title: s, key: `col-${index}-${s}` };
    return { id: s.name || s.id, title: s.name || s.id, key: `col-${index}-${s.id || s.name}` };
  });

  // Normalise status comparison to handle slight variations (spaces, case)
  const canon = (str: string) => str.toLowerCase().replace(/\s+/g, '');

  const getIssuesForColumn = (columnId: string) =>
    state.issues.filter((i) => canon(i.status) === canon(columnId));

  /* Event handlers (local only, no Linear API yet) */
  const handleDragStart = (e: React.DragEvent<HTMLDivElement>, issueId: string) => {
    setState({ ...state, draggedIssue: issueId });
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>, newStatus: string) => {
    e.preventDefault();

    const dragged = state.issues.find((i) => i.id === state.draggedIssue);
    if (!dragged || dragged.status === newStatus) {
      setState({ ...state, draggedIssue: null });
      return;
    }

    const statusObj = statuses.find((s) => s.name === newStatus);
    if (!statusObj) {
      setState({
        ...state,
        updateMessage: `❌ Error: Status "${newStatus}" not found`,
        draggedIssue: null,
      });
      return;
    }

    // Optimistic UI update
    const updatedIssues = state.issues.map((i) =>
      i.id === dragged.id ? { ...i, status: newStatus } : i,
    );

    const updateRequest = {
      id: Date.now(),
      issueId: dragged.id,
      issueIdentifier: dragged.identifier,
      fromStatus: dragged.status,
      toStatus: newStatus,
      statusId: statusObj.id,
      timestamp: new Date().toISOString(),
    };

    setState({
      ...state,
      issues: updatedIssues,
      draggedIssue: null,
      pendingUpdates: [...state.pendingUpdates, updateRequest],
      updateMessage: `📝 Queued update: ${dragged.identifier} → ${newStatus} (${state.pendingUpdates.length + 1} pending)`,
    });

    // Clear message after delay
    setTimeout(() => {
      setState((s) => (s ? { ...s, updateMessage: '' } : s));
    }, 3000);
  };

  const clearPendingUpdates = () => setState({ ...state, pendingUpdates: [] });

  const copyPendingUpdates = () => {
    const text = state.pendingUpdates
      .map((u) => `${u.issueIdentifier}: ${u.fromStatus} → ${u.toStatus} (stateId: ${u.statusId})`)
      .join('\n');
    navigator.clipboard.writeText(text);
    setState({ ...state, updateMessage: '📋 Copied pending updates to clipboard' });
    setTimeout(() => setState((s) => (s ? { ...s, updateMessage: '' } : s)), 2000);
  };

  /* Custom Kanban Skeleton */
  const kanbanSkeleton = (
    <div className="p-6 bg-gray-50">
      <div className="mb-6">
        <Skeleton className="h-10 w-64 mb-4" />
        <Skeleton className="h-8 w-32" />
      </div>
      <div className="flex gap-6 overflow-x-auto pb-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="flex-shrink-0 w-80">
            <div className="bg-white rounded-lg shadow-sm border border-gray-200">
              <div className="p-4 border-b border-gray-200 bg-gray-50 rounded-t-lg">
                <Skeleton className="h-5 w-24" />
              </div>
              <div className="p-4 space-y-3">
                <Skeleton className="h-24" />
                <Skeleton className="h-24" />
                <Skeleton className="h-24" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  /* UI */
  return (
    <LoadingWrapper
      state={loadingState}
      skeleton={kanbanSkeleton}
      showLoadingIndicator={true}
      loadingProgress={{
        state: loadingState,
        progress:
          loadingState === LoadingState.SKELETON
            ? 33
            : loadingState === LoadingState.PARTIAL
              ? 66
              : 100,
        message: subAgentError
          ? 'Using offline data...'
          : loadingState === LoadingState.SKELETON
            ? 'Connecting to Linear...'
            : loadingState === LoadingState.PARTIAL
              ? subAgent.mcpActivity?.linear
                ? 'Fetching issues...'
                : 'Processing data...'
              : 'Ready!',
        eta:
          loadingState === LoadingState.SKELETON
            ? 400
            : loadingState === LoadingState.PARTIAL
              ? 200
              : 0,
      }}
    >
      <div className={cn('p-6 bg-gray-50 h-full overflow-auto', className)}>
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-gray-900 mb-4">{title}</h1>

          <div className="flex items-center gap-4 mb-4">
            <label className="text-sm font-medium text-gray-700">Team:</label>
            <select
              value={state.selectedTeam}
              onChange={(e) => setState({ ...state, selectedTeam: e.target.value })}
              className="border border-gray-300 rounded px-3 py-1 text-sm bg-white"
            >
              {teams.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name}
                </option>
              ))}
            </select>
            {state.pendingUpdates.length > 0 && (
              <button
                onClick={clearPendingUpdates}
                className="bg-red-600 text-white px-3 py-1 rounded text-sm hover:bg-red-700 transition-colors"
              >
                Clear Queue ({state.pendingUpdates.length})
              </button>
            )}
          </div>

          {state.updateMessage && (
            <div className="mt-3 bg-blue-100 border border-blue-300 text-blue-800 px-4 py-2 rounded">
              {state.updateMessage}
            </div>
          )}

          {state.pendingUpdates.length > 0 && (
            <div className="mt-4 bg-orange-50 border border-orange-200 rounded-lg p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-orange-800">
                  🚀 Pending Linear Updates ({state.pendingUpdates.length})
                </h3>
                <button
                  onClick={copyPendingUpdates}
                  className="text-xs bg-orange-600 text-white px-2 py-1 rounded hover:bg-orange-700"
                >
                  Copy Details
                </button>
              </div>
              <div className="space-y-2 mb-3">
                {state.pendingUpdates.slice(-3).map((update) => (
                  <div
                    key={update.id}
                    className="text-sm text-orange-700 bg-orange-100 px-3 py-2 rounded"
                  >
                    <strong>{update.issueIdentifier}:</strong> {update.fromStatus} →{' '}
                    {update.toStatus}
                  </div>
                ))}
                {state.pendingUpdates.length > 3 && (
                  <div className="text-xs text-orange-600">
                    ... and {state.pendingUpdates.length - 3} more updates
                  </div>
                )}
              </div>
              <div className="text-sm text-orange-700">
                💡 <strong>To sync with Linear:</strong> Ask Claude to "process my pending Kanban
                updates"
              </div>
            </div>
          )}
        </div>

        {/* Board */}
        <div className="flex gap-4 overflow-x-auto pb-4" style={{ minHeight: '400px' }}>
          {columns.map((column) => {
            const columnIssues = getIssuesForColumn(column.id);
            const columnWidth = Math.max(
              200,
              Math.min(
                320,
                (typeof window !== 'undefined' ? window.innerWidth : 1200) / columns.length - 32,
              ),
            );
            return (
              <div key={column.key} className="flex-shrink-0" style={{ width: columnWidth + 'px' }}>
                <div className="bg-white rounded-lg shadow-sm border border-gray-200 h-fit">
                  <div className="p-4 border-b border-gray-200 bg-gray-50 rounded-t-lg">
                    <h2 className="font-semibold text-gray-900 text-sm flex items-center justify-between">
                      <span>{column.title}</span>
                      <span className="bg-gray-200 text-gray-700 px-2 py-1 rounded-full text-xs font-medium">
                        {columnIssues.length}
                      </span>
                    </h2>
                  </div>
                  <div
                    className="p-4 min-h-[200px] space-y-3"
                    onDragOver={handleDragOver}
                    onDrop={(e) => handleDrop(e, column.id)}
                  >
                    {columnIssues.map((issue) => (
                      <div
                        key={issue.id}
                        draggable
                        onDragStart={(e) => handleDragStart(e, issue.id)}
                        className={`p-3 bg-white border-2 rounded-lg shadow-sm hover:shadow-md transition-all cursor-move transform hover:scale-[1.02] ${state.draggedIssue === issue.id ? 'opacity-50 rotate-2 scale-105' : ''
                          } ${getPriorityColor(issue.priority)}`}
                      >
                        <div className="flex items-start justify-between mb-2">
                          <span className="text-xs font-mono text-gray-500 bg-gray-100 px-2 py-1 rounded">
                            {issue.identifier}
                          </span>
                          {issue.priority && (
                            <span
                              className={`text-xs font-semibold px-2 py-1 rounded ${issue.priority.value === 1
                                ? 'bg-red-200 text-red-800'
                                : issue.priority.value === 2
                                  ? 'bg-orange-200 text-orange-800'
                                  : 'bg-gray-200 text-gray-800'
                                }`}
                            >
                              {issue.priority.name}
                            </span>
                          )}
                        </div>
                        <h3 className="font-medium text-gray-900 text-sm mb-3 leading-tight">
                          {issue.title}
                        </h3>
                        {issue.labels && issue.labels.length > 0 && (
                          <div className="flex flex-wrap gap-1 mb-2">
                            {issue.labels.map((label, labelIndex) => (
                              <span
                                key={`${issue.id}-label-${labelIndex}-${label}`}
                                className={`px-2 py-1 rounded text-xs font-medium ${getLabelColor(label)}`}
                              >
                                {label}
                              </span>
                            ))}
                          </div>
                        )}
                        {issue.project && (
                          <div className="text-xs text-gray-600 mt-2 truncate flex items-center">
                            <span className="mr-1">📁</span>
                            {issue.project}
                          </div>
                        )}
                        {issue.assignee && (
                          <div className="text-xs text-gray-600 mt-1 flex items-center">
                            <span className="mr-1">👤</span>
                            {issue.assignee}
                          </div>
                        )}
                        <div className="text-xs text-gray-500 mt-2 border-t border-gray-100 pt-2">
                          Updated:{' '}
                          {new Date(issue.updatedAt).toLocaleDateString('en-US', {
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </div>
                      </div>
                    ))}
                    {columnIssues.length === 0 && (
                      <div className="text-gray-400 text-center py-8 text-sm">
                        No issues in {column.title}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Drag Overlay */}
        {state.draggedIssue && (
          <div className="fixed bottom-4 right-4 bg-blue-600 text-white px-4 py-2 rounded-lg shadow-lg flex items-center">
            <span className="mr-2">🚀</span>
            Dragging: {state.issues.find((i) => i.id === state.draggedIssue)?.identifier}
          </div>
        )}

        <div className="mt-8 text-center text-sm text-gray-500">
          <p>
            🚀 <strong>Hybrid Linear Integration:</strong> Drag to queue updates, then ask Claude to
            sync with Linear
          </p>
          <p className="mt-1">This approach provides smooth UI with reliable backend sync</p>
        </div>
      </div>
    </LoadingWrapper>
  );
}
