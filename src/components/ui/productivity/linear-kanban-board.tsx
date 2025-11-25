'use client';

import { z } from 'zod';
import { useCallback, useEffect, useId, useState, useMemo, useRef } from 'react';
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

/* --------------------------------------------------------------------------
 * Mock Data for Interactive Features
 * --------------------------------------------------------------------------*/
const mockUsers = [
  { id: 'u1', name: 'Alice', avatar: '👩‍💻' },
  { id: 'u2', name: 'Bob', avatar: '👨‍💻' },
  { id: 'u3', name: 'Charlie', avatar: '🦸‍♂️' },
  { id: 'u4', name: 'Dave', avatar: '🧙‍♂️' },
];

/* --------------------------------------------------------------------------
 * Component Implementation
 * --------------------------------------------------------------------------*/

const DEBUG_DND = process.env.NODE_ENV !== 'production';
const dndLog = (...args: any[]) => {
  if (DEBUG_DND) console.log(...args);
};

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
  const [state, setState] = useState<KanbanState & {
    selectedIssue: string | null; // ID of the issue open in modal
    comments: Record<string, Array<{ id: string, user: string, text: string, time: string }>>; // Mock comments
    activeDropColumn: string | null; // ID of the column being dragged over
    dropIndicator: { targetId: string; position: 'before' | 'after' } | null; // Visual indicator for reordering
  }>({
    selectedTeam: teams[0]?.id ?? '',
    issues: enrichedIssues,
    draggedIssue: null,
    pendingUpdates: [],
    updateMessage: '',
    selectedIssue: null,
    comments: {},
    activeDropColumn: null,
    dropIndicator: null,
  });

  const [showPendingDropdown, setShowPendingDropdown] = useState(false);

  // Ref to track drop indicator synchronously to avoid state update delays in onDrop
  const dropIndicatorRef = useRef<{ targetId: string; position: 'before' | 'after' } | null>(null);
  const setDropIndicator = useCallback(
    (indicator: { targetId: string; position: 'before' | 'after' } | null) => {
      dropIndicatorRef.current = indicator;
      setState((prev) => ({ ...prev, dropIndicator: indicator }));
    },
    [],
  );

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
    (patch: any) => {
      console.log('[LinearKanbanBoard] Received AI update:', patch);

      // Handle direct prop updates
      if (patch.issues) {
        // Merge logic could go here, but for now we rely on the sub-agent
      }

      // Handle specific actions
      if (patch.action === 'move_issue') {
        const { issueId, status, columnId } = patch;
        const issue = state.issues.find(
          (i) =>
            i.id === issueId ||
            i.identifier === issueId ||
            i.title.toLowerCase().includes(issueId.toLowerCase()),
        );

        if (issue) {
          // Find the target column based on columnId or status name
          const targetColumn = (statuses?.length ? statuses : fallbackColumns).find(
            (c: any) => (c.id === columnId) || (c.name?.toLowerCase() === status?.toLowerCase()) || (c.title?.toLowerCase() === status?.toLowerCase()),
          );

          if (targetColumn) {
            const newStatusName = (targetColumn as any).name || (targetColumn as any).title || targetColumn.id;

            // Update the issue's status in the local state
            setState(prev => {
              const updatedIssues = prev.issues.map(i =>
                i.id === issue.id ? { ...i, status: newStatusName } : i
              );
              return { ...prev, issues: updatedIssues };
            });

            // Queue for sync (using the existing pendingUpdates in state)
            setState(prev => {
              const existing = prev.pendingUpdates.find((u) => u.issueId === issue.id);
              const newPendingUpdate = {
                id: Date.now(), // Unique ID for the update
                issueId: issue.id,
                issueIdentifier: issue.identifier,
                fromStatus: issue.status,
                toStatus: newStatusName,
                statusId: targetColumn.id, // Assuming targetColumn.id is the statusId
                timestamp: new Date().toISOString(),
              };

              if (existing) {
                return {
                  ...prev,
                  pendingUpdates: prev.pendingUpdates.map((u) =>
                    u.issueId === issue.id ? { ...u, toStatus: newStatusName, statusId: targetColumn.id } : u,
                  ),
                };
              }
              return {
                ...prev,
                pendingUpdates: [...prev.pendingUpdates, newPendingUpdate],
              };
            });
          }
        }
      }

      if (patch.action === 'assign_issue') {
        const { issueId, assignee } = patch;
        const issue = state.issues.find(
          (i) =>
            i.id === issueId ||
            i.identifier === issueId ||
            i.title.toLowerCase().includes(issueId.toLowerCase()),
        );

        if (issue) {
          // Find the assignee object from mockUsers
          const assigneeUser = mockUsers.find(u => u.name.toLowerCase() === assignee.toLowerCase());

          if (assigneeUser) {
            // Update the issue's assignee in the local state
            setState(prev => {
              const updatedIssues = prev.issues.map(i =>
                i.id === issue.id ? { ...i, assignee: assigneeUser.name } : i
              );
              return { ...prev, issues: updatedIssues };
            });

            // Queue for sync (using the existing pendingUpdates in state)
            setState(prev => {
              // For assignee changes, we might need a different structure or just update the issue directly
              // For simplicity, we'll just update the issue in state and not add to pendingUpdates for now,
              // as the pendingUpdates type is specifically for status changes.
              // If assignee changes need to be tracked, the KanbanState.pendingUpdates type would need to be extended.
              return prev; // No change to pendingUpdates for assignee for now
            });
          } else {
            console.warn(`[LinearKanbanBoard] Assignee "${assignee}" not found in mock users.`);
          }
        }
      }
    },
    [state, statuses], // Depend on state and statuses to access issues and column definitions
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
  // Native DnD inside tldraw can get blocked by parent listeners; use capture-phase, stop bubbling,
  // and ensure dataTransfer has something set.
  const handleDragStart = (e: React.DragEvent<HTMLDivElement>, issueId: string) => {
    dndLog('[Kanban] Drag Start:', issueId);
    e.stopPropagation();
    e.dataTransfer.effectAllowed = 'move';
    // Set a payload so the browser treats this as a valid drag
    e.dataTransfer.setData('application/x-kanban-issue', issueId);
    dropIndicatorRef.current = null;
    setState({ ...state, draggedIssue: issueId, activeDropColumn: null, dropIndicator: null });
  };

  const boardRef = useMemo(() => ({ current: null as HTMLDivElement | null }), []);

  const handleBoardDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    if (boardRef.current && e.target !== boardRef.current) {
      return; // Let columns/cards handle it
    }
    // Only intercept when dragging a Kanban issue; otherwise let canvas/global handlers run
    if (!state.draggedIssue) return;

    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    if (state.activeDropColumn || state.dropIndicator) {
      dndLog('[Kanban] Board Drag Over (Clearing State)');
      setDropIndicator(null);
      setState(prev => ({ ...prev, activeDropColumn: null, dropIndicator: null }));
    }
  };

  const handleBoardDrop = (e: React.DragEvent<HTMLDivElement>) => {
    if (boardRef.current && e.target !== boardRef.current) {
      return; // Column/card will handle
    }
    if (!state.draggedIssue) return; // let non-kanban drops bubble to tldraw

    e.preventDefault();
    e.stopPropagation();
    dndLog('[Kanban] Board Drop (Cancelled)');
    setDropIndicator(null);
    setState(prev => ({ ...prev, draggedIssue: null, activeDropColumn: null, dropIndicator: null }));
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>, columnId: string) => {
    if (!state.draggedIssue) return; // not our payload, let it bubble

    e.preventDefault();
    e.stopPropagation(); // Stop bubbling to Board
    e.dataTransfer.dropEffect = 'move';

    // Highlight column
    if (state.activeDropColumn !== columnId) {
      dndLog('[Kanban] Column Drag Over:', columnId);
      setState(prev => ({ ...prev, activeDropColumn: columnId }));
    }

    // Nearest Neighbor Logic for Drop Indicator
    // This handles dragging over cards AND gaps between cards
    const cards = Array.from(e.currentTarget.querySelectorAll('[data-issue-id]'));

    if (cards.length === 0) {
      // Empty column, clear indicator (will show append)
      if (state.dropIndicator) {
        setDropIndicator(null);
      }
      return;
    }

    // Find the card immediately *after* the cursor (closest one where mouse is above center)
    const elementAfter = cards.reduce((closest, child) => {
      const box = child.getBoundingClientRect();
      const offset = e.clientY - box.top - box.height / 2;
      // offset < 0 means mouse is above the center of this child
      // We want the closest one that is still "below" the mouse (offset is negative but closest to 0)
      if (offset < 0 && offset > closest.offset) {
        return { offset: offset, element: child };
      } else {
        return closest;
      }
    }, { offset: Number.NEGATIVE_INFINITY, element: null as Element | null });

    if (elementAfter.element) {
      // We are "before" this element
      const targetId = elementAfter.element.getAttribute('data-issue-id');
      if (targetId && targetId !== state.draggedIssue) {
        if (state.dropIndicator?.targetId !== targetId || state.dropIndicator?.position !== 'before') {
          const newIndicator = { targetId, position: 'before' as const };
          setDropIndicator(newIndicator);
        }
      }
    } else {
      // We are after the last element (or all elements)
      const lastCard = cards[cards.length - 1];
      const targetId = lastCard.getAttribute('data-issue-id');
      // Only show "after" if we are not dragging the last card itself
      if (targetId && targetId !== state.draggedIssue) {
        if (state.dropIndicator?.targetId !== targetId || state.dropIndicator?.position !== 'after') {
          const newIndicator = { targetId, position: 'after' as const };
          setDropIndicator(newIndicator);
        }
      }
    }
  };

  const handleDragOverCard = (e: React.DragEvent<HTMLDivElement>, issueId: string) => {
    if (!state.draggedIssue) return; // not our payload

    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    // Ignore if hovering over itself
    if (issueId === state.draggedIssue) return;

    // Allow bubbling to column so it stays highlighted!
    // e.stopPropagation(); 

    const rect = e.currentTarget.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    const position = e.clientY < midY ? 'before' : 'after';

    if (state.dropIndicator?.targetId !== issueId || state.dropIndicator?.position !== position) {
      dndLog('[Kanban] Card Drag Over:', { targetId: issueId, position });
      setDropIndicator({ targetId: issueId, position });
    }
  };

  const queueStatusChange = (issueId: string, newStatus: string) => {
    const dragged = state.issues.find((i) => i.id === issueId);
    if (!dragged) {
      console.warn('[Kanban] Status change failed: Issue not found', issueId);
      return;
    }

    const statusObj = statuses.find((s) => s.name === newStatus);
    if (!statusObj) {
      console.error('[Kanban] Status not found:', newStatus);
      setState({
        ...state,
        updateMessage: `❌ Error: Status "${newStatus}" not found`,
      });
      return;
    }

    // Remove from current list and append to end of target column for modal changes
    const updatedIssues = state.issues.filter((i) => i.id !== issueId);
    updatedIssues.push({ ...dragged, status: newStatus });

    const updateRequest = {
      id: Date.now(),
      issueId: dragged.id,
      issueIdentifier: dragged.identifier,
      fromStatus: dragged.status,
      toStatus: newStatus,
      statusId: statusObj.id,
      timestamp: new Date().toISOString(),
    };

    setState((prev) => ({
      ...prev,
      issues: updatedIssues,
      pendingUpdates: [...prev.pendingUpdates, updateRequest],
      updateMessage: `📝 Queued update: ${dragged.identifier} → ${newStatus} (${prev.pendingUpdates.length + 1} pending)`,
    }));
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>, newStatus: string) => {
    dndLog('[Kanban] Drop on Column/Card:', { newStatus, draggedIssue: state.draggedIssue });
    if (!state.draggedIssue) return; // allow non-kanban drops to propagate

    e.preventDefault();
    e.stopPropagation();

    const dragged = state.issues.find((i) => i.id === state.draggedIssue);
    if (!dragged) {
      console.warn('[Kanban] Drop failed: No dragged issue found');
      setDropIndicator(null);
      setState({ ...state, draggedIssue: null, activeDropColumn: null, dropIndicator: null });
      return;
    }

    // Calculate new index
    let updatedIssues = [...state.issues];
    const currentIndex = updatedIssues.findIndex(i => i.id === dragged.id);

    // We need to calculate the insertion index BEFORE removing the item,
    // but we must account for the shift that removal will cause.
    let newIndex = updatedIssues.length; // Default to end of list

    // Use the REF for the most up-to-date indicator
    const currentIndicator = dropIndicatorRef.current;

    if (currentIndicator) {
      const targetIndex = updatedIssues.findIndex(i => i.id === currentIndicator.targetId);
      if (targetIndex !== -1) {
        // Initial position based on drop indicator
        newIndex = currentIndicator.position === 'before' ? targetIndex : targetIndex + 1;

        // If we are moving the item down the list (current < target),
        // removing the item at current will shift everything above it down by 1.
        // So we need to decrement the destination index.
        if (currentIndex < newIndex) {
          newIndex -= 1;
        }
      }
    } else {
      // Append to end of specific column
      const columnIssues = updatedIssues.filter(i => canon(i.status) === canon(newStatus));
      if (columnIssues.length > 0) {
        const lastIssue = columnIssues[columnIssues.length - 1];
        const lastIndex = updatedIssues.findIndex(i => i.id === lastIssue.id);
        newIndex = lastIndex + 1;

        // Same adjustment if we are moving down
        if (currentIndex < newIndex) {
          newIndex -= 1;
        }
      }
    }

    updatedIssues.splice(currentIndex, 1); // Remove from old position

    // Update status
    const updatedIssue = { ...dragged, status: newStatus };

    // Insert at new position
    updatedIssues.splice(newIndex, 0, updatedIssue);

    const statusObj = statuses.find((s) => s.name === newStatus);
    if (!statusObj) {
      console.error('[Kanban] Status not found:', newStatus);
      setState({
        ...state,
        updateMessage: `❌ Error: Status "${newStatus}" not found`,
        draggedIssue: null,
        activeDropColumn: null,
        dropIndicator: null
      });
      return;
    }

    const updateRequest = {
      id: Date.now(),
      issueId: dragged.id,
      issueIdentifier: dragged.identifier,
      fromStatus: dragged.status,
      toStatus: newStatus,
      statusId: statusObj.id,
      timestamp: new Date().toISOString(),
    };

    if (updateMessageTimeoutRef.current) {
      clearTimeout(updateMessageTimeoutRef.current);
      updateMessageTimeoutRef.current = null;
    }

    setState({
      ...state,
      issues: updatedIssues,
      draggedIssue: null,
      activeDropColumn: null,
      dropIndicator: null,
      pendingUpdates: [...state.pendingUpdates, updateRequest],
      updateMessage: `📝 Queued update: ${dragged.identifier} → ${newStatus} (${state.pendingUpdates.length + 1} pending)`,
    });

    // Clear message after delay
    updateMessageTimeoutRef.current = setTimeout(() => {
      setState((s) => (s ? { ...s, updateMessage: '' } : s));
      updateMessageTimeoutRef.current = null;
    }, 3000);
  };

  const handleDragEnd = (e: React.DragEvent<HTMLDivElement>) => {
    dndLog('[Kanban] Drag End');
    e.stopPropagation();
    setState(prev => ({ ...prev, draggedIssue: null, activeDropColumn: null, dropIndicator: null }));
  };

  const updateMessageTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearPendingUpdates = () => setState({ ...state, pendingUpdates: [] });

  const copyPendingUpdates = () => {
    const text = state.pendingUpdates
      .map((u) => `${u.issueIdentifier}: ${u.fromStatus} → ${u.toStatus} (stateId: ${u.statusId})`)
      .join('\n');
    navigator.clipboard.writeText(text);
    if (updateMessageTimeoutRef.current) {
      clearTimeout(updateMessageTimeoutRef.current);
      updateMessageTimeoutRef.current = null;
    }
    setState({ ...state, updateMessage: '📋 Copied pending updates to clipboard' });
    updateMessageTimeoutRef.current = setTimeout(
      () => setState((s) => (s ? { ...s, updateMessage: '' } : s)),
      2000,
    );
  };

  const handleSendToLinear = () => {
    // In the hybrid model, we simulate sending by copying to clipboard and showing instructions
    const text = state.pendingUpdates
      .map((u) => `${u.issueIdentifier}: ${u.fromStatus} → ${u.toStatus} (stateId: ${u.statusId})`)
      .join('\n');
    navigator.clipboard.writeText(text);
    if (updateMessageTimeoutRef.current) {
      clearTimeout(updateMessageTimeoutRef.current);
      updateMessageTimeoutRef.current = null;
    }
    setState(prev => ({
      ...prev,
      updateMessage: '🚀 Ready to sync! Ask Claude to "process these updates".'
    }));
    // Leave the instruction visible; do not auto-clear here.
  };

  /* Interactive Features Handlers */
  const handleIssueClick = (e: React.MouseEvent, issueId: string) => {
    e.stopPropagation(); // Prevent Tldraw selection
    setState({ ...state, selectedIssue: issueId });
  };

  const handleCloseModal = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    setState({ ...state, selectedIssue: null });
  };

  const handleAssigneeChange = (issueId: string, newAssignee: string) => {
    const updatedIssues = state.issues.map(i =>
      i.id === issueId ? { ...i, assignee: newAssignee } : i
    );
    setState({ ...state, issues: updatedIssues });
  };

  const handleAddComment = (issueId: string, text: string) => {
    const newComment = {
      id: Date.now().toString(),
      user: 'You',
      text,
      time: 'Just now'
    };
    setState(prev => ({
      ...prev,
      comments: {
        ...prev.comments,
        [issueId]: [...(prev.comments[issueId] || []), newComment]
      }
    }));
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

  const selectedIssueData = state.selectedIssue ? state.issues.find(i => i.id === state.selectedIssue) : null;

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
      <div
        className={cn('p-6 bg-gray-50 h-full overflow-auto relative', className)}
        onDragOver={handleBoardDragOver}
        onDrop={handleBoardDrop}
      >
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-gray-900 mb-4">{title}</h1>

          <div className="flex items-center gap-4 mb-4 relative z-50">
            <label className="text-sm font-medium text-gray-700">Team:</label>
            <select
              value={state.selectedTeam}
              onChange={(e) => setState({ ...state, selectedTeam: e.target.value })}
              className="border border-gray-300 rounded px-3 py-1 text-sm bg-white nodrag"
            >
              {teams.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name}
                </option>
              ))}
            </select>

            {/* Pending Changes Dropdown Trigger */}
            <div className="relative">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setShowPendingDropdown(!showPendingDropdown);
                }}
                className={`flex items-center gap-2 px-3 py-1 rounded text-sm transition-colors nodrag border ${state.pendingUpdates.length > 0
                  ? 'bg-orange-100 text-orange-800 border-orange-300 hover:bg-orange-200'
                  : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
                  }`}
              >
                <span>Pending Changes</span>
                {state.pendingUpdates.length > 0 && (
                  <span className="bg-orange-500 text-white text-xs font-bold px-1.5 rounded-full">
                    {state.pendingUpdates.length}
                  </span>
                )}
              </button>

              {/* Dropdown Menu */}
              {showPendingDropdown && (
                <div
                  className="absolute top-full left-0 mt-2 w-80 bg-white rounded-lg shadow-xl border border-gray-200 overflow-hidden z-[100] nodrag"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="p-3 border-b border-gray-100 bg-gray-50 flex justify-between items-center">
                    <h3 className="font-semibold text-gray-900 text-sm">Update Queue</h3>
                    <div className="flex gap-2">
                      {state.pendingUpdates.length > 0 && (
                        <>
                          <button
                            onClick={handleSendToLinear}
                            className="px-2 py-1 bg-blue-600 text-white text-xs rounded hover:bg-blue-700 font-medium transition-colors"
                          >
                            Send to Linear
                          </button>
                          <button
                            onClick={clearPendingUpdates}
                            className="text-xs text-red-600 hover:text-red-800 underline ml-2"
                          >
                            Clear
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="max-h-64 overflow-y-scroll p-2 space-y-2">
                    {state.updateMessage && (
                      <div className="text-xs bg-blue-50 text-blue-700 p-2 rounded border border-blue-100 mb-2">
                        {state.updateMessage}
                      </div>
                    )}

                    {state.pendingUpdates.length === 0 ? (
                      <div className="text-center py-4 text-gray-400 text-sm">
                        No pending updates
                      </div>
                    ) : (
                      state.pendingUpdates.map((update) => (
                        <div
                          key={update.id}
                          className="text-xs bg-orange-50 text-orange-800 p-2 rounded border border-orange-100"
                        >
                          <div className="font-medium">{update.issueIdentifier}</div>
                          <div className="opacity-75">
                            {update.fromStatus} → {update.toStatus}
                          </div>
                        </div>
                      ))
                    )}
                  </div>

                  {state.pendingUpdates.length > 0 && (
                    <div className="p-2 bg-orange-50 border-t border-orange-100 text-xs text-orange-700 text-center">
                      Ask Claude to "process updates" to sync.
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

        </div>

        {/* Board */}
        <div
          ref={boardRef as any}
          className="flex gap-4 overflow-x-auto pb-4"
          style={{ minHeight: '400px' }}
          onDragOverCapture={handleBoardDragOver}
          onDropCapture={handleBoardDrop}
        >
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
                <div
                  className={`bg-white rounded-lg shadow-sm border h-fit transition-colors nodrag ${state.activeDropColumn === column.id ? 'bg-blue-50 border-blue-300 ring-2 ring-blue-100' : 'border-gray-200'
                    }`}
                  onDragEnterCapture={(e) => handleDragOver(e as any, column.id)}
                  onDragOverCapture={(e) => handleDragOver(e as any, column.id)}
                  onDropCapture={(e) => handleDrop(e as any, column.id)}
                >
                  <div className="p-4 border-b border-gray-200 bg-gray-50/50 rounded-t-lg">
                    <h2 className="font-semibold text-gray-900 text-sm flex items-center justify-between">
                      <span>{column.title}</span>
                      <span className="bg-gray-200 text-gray-700 px-2 py-1 rounded-full text-xs font-medium">
                        {columnIssues.length}
                      </span>
                    </h2>
                  </div>
                  <div className="p-4 min-h-[200px] space-y-3">
                    {columnIssues.map((issue) => (
                      <div
                        key={issue.id}
                        draggable
                        data-tldrag-ok
                        data-issue-id={issue.id}
                        onDragStartCapture={(e) => handleDragStart(e, issue.id)}
                        onDragOverCapture={(e) => handleDragOverCard(e, issue.id)}
                        onDropCapture={(e) => handleDrop(e, column.id)}
                        onDragEndCapture={handleDragEnd}
                        onClick={(e) => handleIssueClick(e, issue.id)}
                        className={`
                          relative p-3 bg-white border-2 rounded-lg shadow-sm hover:shadow-md transition-all cursor-move nodrag
                          ${state.draggedIssue === issue.id ? 'opacity-50 rotate-2 scale-105' : ''} 
                          ${getPriorityColor(issue.priority)}
                        `}
                      >
                        {/* Drop Indicator - Before */}
                        {state.dropIndicator?.targetId === issue.id && state.dropIndicator.position === 'before' && (
                          <div className="absolute -top-2 left-0 right-0 h-1.5 bg-blue-600 rounded-full pointer-events-none z-50 shadow-sm ring-2 ring-white" />
                        )}

                        {/* Drop Indicator - After */}
                        {state.dropIndicator?.targetId === issue.id && state.dropIndicator.position === 'after' && (
                          <div className="absolute -bottom-2 left-0 right-0 h-1.5 bg-blue-600 rounded-full pointer-events-none z-50 shadow-sm ring-2 ring-white" />
                        )}
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
                    {/* Empty Column / Append Indicator */}
                    {state.activeDropColumn === column.id && !state.dropIndicator && (
                      <div className="h-1.5 bg-blue-600 rounded-full mx-1 shadow-sm ring-2 ring-white animate-pulse" />
                    )}

                    {columnIssues.length === 0 && state.activeDropColumn !== column.id && (
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
          <div className="fixed bottom-4 right-4 bg-blue-600 text-white px-4 py-2 rounded-lg shadow-lg flex items-center z-50">
            <span className="mr-2">🚀</span>
            Dragging: {state.issues.find((i) => i.id === state.draggedIssue)?.identifier}
          </div>
        )}

        {/* Issue Detail Modal */}
        {selectedIssueData && (
          <div
            className="absolute inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
            onClick={handleCloseModal}
            onPointerDown={(e) => e.stopPropagation()} // Stop Tldraw interaction
          >
            <div
              className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90%] overflow-hidden flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Modal Header */}
              <div className="p-6 border-b border-gray-200 flex justify-between items-start bg-gray-50">
                <div>
                  <div className="flex items-center gap-3 mb-2">
                    <span className="text-sm font-mono text-gray-500 bg-white border border-gray-200 px-2 py-1 rounded">
                      {selectedIssueData.identifier}
                    </span>
                    <span className={`text-xs font-semibold px-2 py-1 rounded ${selectedIssueData.priority?.value === 1 ? 'bg-red-100 text-red-700' :
                      selectedIssueData.priority?.value === 2 ? 'bg-orange-100 text-orange-700' :
                        'bg-gray-100 text-gray-700'
                      }`}>
                      {selectedIssueData.priority?.name || 'No Priority'}
                    </span>
                  </div>
                  <h2 className="text-xl font-bold text-gray-900">{selectedIssueData.title}</h2>
                </div>
                <button
                  onClick={handleCloseModal}
                  className="text-gray-400 hover:text-gray-600 p-1 rounded-full hover:bg-gray-200"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>

              {/* Modal Content */}
              <div className="flex-1 overflow-y-auto p-6">
                <div className="grid grid-cols-3 gap-8">
                  {/* Main Content */}
                  <div className="col-span-2 space-y-6">
                    <div>
                      <h3 className="text-sm font-semibold text-gray-900 mb-2">Description</h3>
                      <div className="text-gray-600 text-sm leading-relaxed">
                        <p>
                          This is a placeholder description for the issue. In a real integration,
                          this would be fetched from the Linear API. It supports <strong>markdown</strong>
                          and other rich text features.
                        </p>
                        <ul className="list-disc ml-4 mt-2 space-y-1">
                          <li>Check acceptance criteria</li>
                          <li>Verify with design</li>
                          <li>Update documentation</li>
                        </ul>
                      </div>
                    </div>

                    <div>
                      <h3 className="text-sm font-semibold text-gray-900 mb-3">Activity & Comments</h3>
                      <div className="space-y-4">
                        {/* Existing Comments */}
                        {(state.comments[selectedIssueData.id] || []).map((comment) => (
                          <div key={comment.id} className="flex gap-3">
                            <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-xs font-bold text-blue-600">
                              {comment.user[0]}
                            </div>
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-1">
                                <span className="text-sm font-medium text-gray-900">{comment.user}</span>
                                <span className="text-xs text-gray-500">{comment.time}</span>
                              </div>
                              <p className="text-sm text-gray-600">{comment.text}</p>
                            </div>
                          </div>
                        ))}

                        {/* Add Comment Input */}
                        <div className="flex gap-3 mt-4">
                          <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-xs font-bold text-gray-500">
                            Y
                          </div>
                          <div className="flex-1">
                            <input
                              type="text"
                              placeholder="Leave a comment..."
                              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' && e.currentTarget.value.trim()) {
                                  handleAddComment(selectedIssueData.id, e.currentTarget.value);
                                  e.currentTarget.value = '';
                                }
                              }}
                            />
                            <p className="text-xs text-gray-400 mt-1">Press Enter to post</p>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Sidebar */}
                  <div className="space-y-6">
                    <div>
                      <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                        Status
                      </label>
                      <select
                        value={selectedIssueData.status}
                        onChange={(e) => queueStatusChange(selectedIssueData.id, e.target.value)}
                        className="w-full text-sm border-gray-300 rounded-md shadow-sm focus:border-blue-500 focus:ring-blue-500"
                      >
                        {statuses.map(s => (
                          <option key={s.id} value={s.name}>{s.name}</option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                        Assignee
                      </label>
                      <div className="space-y-2">
                        <div className="flex items-center gap-2 p-2 border rounded-md bg-white">
                          {selectedIssueData.assignee ? (
                            <>
                              <span className="w-6 h-6 rounded-full bg-gray-100 flex items-center justify-center text-xs">
                                👤
                              </span>
                              <span className="text-sm text-gray-900">{selectedIssueData.assignee}</span>
                            </>
                          ) : (
                            <span className="text-sm text-gray-400 italic">Unassigned</span>
                          )}
                        </div>
                        <select
                          className="w-full text-sm border-gray-300 rounded-md shadow-sm focus:border-blue-500 focus:ring-blue-500"
                          onChange={(e) => handleAssigneeChange(selectedIssueData.id, e.target.value)}
                          value={selectedIssueData.assignee || ''}
                        >
                          <option value="">Change Assignee...</option>
                          {mockUsers.map(u => (
                            <option key={u.id} value={u.name}>{u.avatar} {u.name}</option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                        Labels
                      </label>
                      <div className="flex flex-wrap gap-2">
                        {selectedIssueData.labels?.map((label, i) => (
                          <span key={i} className={`px-2 py-1 rounded text-xs font-medium ${getLabelColor(label)}`}>
                            {label}
                          </span>
                        ))}
                        <button className="px-2 py-1 rounded text-xs font-medium bg-gray-100 text-gray-500 hover:bg-gray-200 border border-gray-200 border-dashed">
                          + Add
                        </button>
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                        Project
                      </label>
                      <div className="text-sm text-blue-600 hover:underline cursor-pointer flex items-center gap-1">
                        📁 {selectedIssueData.project || 'No Project'}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
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
