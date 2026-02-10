/**
 * Action Item Tracker - custom AI Generative UI Component
 *
 * Complex stateful component demonstrating custom AI's generative UI capabilities.
 * Uses usecustomComponentState hook for AI-driven state management and real-time updates.
 *
 * DEVELOPER NOTES:
 * - Zod schemas for type safety and AI model validation
 * - custom component state system integration for AI interactions
 * - shadcn/ui + Tailwind CSS for consistent styling
 * - CRUD operations with optimistic updates
 *
 * KEY INTEGRATIONS:
 * - useComponentState hook for AI state management
 * - Zod schemas: actionItemSchema/actionItemTrackerSchema for validation
 * - Lucide React icons, Next.js client-side component
 *
 * WHEN MODIFYING:
 * - Update schemas if changing data structure
 * - Maintain custom state hook for AI functionality
 * - Follow Tailwind utility patterns for styling consistency
 * - Consider AI model's ability to understand/manipulate data
 *
 * CONNECTIONS:
 * - Used in MCP (Model Context Protocol) configurations
 * - Designed for custom's generative UI system
 * - Extensible with AI features like smart prioritization
 */

'use client';

import { cn } from '@/lib/utils';
import { useState, useEffect, useId, useMemo } from 'react';
import { z } from 'zod';
import {
  Plus,
  CheckCircle2,
  Circle,
  Edit3,
  Trash2,
  User,
  Calendar,
  Flag,
  Filter,
  Clock,
  MoreHorizontal,
  Save,
  X,
} from 'lucide-react';
import { LoadingState } from '@/lib/with-progressive-loading';
import { LoadingWrapper, SkeletonPatterns } from '@/components/ui/shared/loading-states';
import { useComponentSubAgent, SubAgentPresets } from '@/lib/component-subagent';
import { Button } from '@/components/ui/shared/button';
import { WidgetFrame } from './widget-frame';

// Define priority levels
export const priorityLevels = ['low', 'medium', 'high', 'urgent'] as const;
export type Priority = (typeof priorityLevels)[number];

// Define status types
export const statusTypes = ['pending', 'in-progress', 'completed', 'blocked'] as const;
export type Status = (typeof statusTypes)[number];

// Action item schema
export const actionItemSchema = z.object({
  id: z.string().describe('Unique identifier for the action item'),
  title: z.string().describe('Title/description of the action item'),
  description: z.string().optional().describe('Detailed description of the action item'),
  assignee: z.string().optional().describe('Person assigned to this action item'),
  dueDate: z.string().optional().describe('Due date in ISO format'),
  priority: z.enum(priorityLevels).default('medium').describe('Priority level of the action item'),
  status: z.enum(statusTypes).default('pending').describe('Current status of the action item'),
  tags: z.array(z.string()).optional().describe('Tags associated with this action item'),
  createdAt: z.string().describe('When this action item was created'),
  completedAt: z.string().optional().describe('When this action item was completed'),
  estimatedHours: z.number().optional().describe('Estimated hours to complete'),
  actualHours: z.number().optional().describe('Actual hours spent'),
  notes: z.string().optional().describe('Additional notes or comments'),
});

// Main component schema
export const actionItemTrackerSchema = z.object({
  title: z.string().optional().default('Action Items').describe('Title for the tracker'),
  initialItems: z
    .array(actionItemSchema)
    .optional()
    .default([])
    .describe('Initial action items to display'),
  meetingContext: z
    .object({
      meetingTitle: z
        .string()
        .optional()
        .describe('Title of the meeting these action items are from'),
      meetingDate: z.string().optional().describe('Date of the meeting'),
      participants: z.array(z.string()).optional().describe('List of meeting participants'),
    })
    .optional()
    .describe('Context about the meeting or source of these action items'),
  allowEditing: z
    .boolean()
    .optional()
    .default(true)
    .describe('Whether users can add/edit action items'),
  showCompleted: z
    .boolean()
    .optional()
    .default(true)
    .describe('Whether to show completed items by default'),
  defaultAssignee: z.string().optional().describe('Default assignee for new action items'),
});

export type ActionItemTrackerProps = z.infer<typeof actionItemTrackerSchema>;
export type ActionItem = z.infer<typeof actionItemSchema>;

// Component state type
type ActionItemTrackerState = {
  items: ActionItem[];
  filter: {
    status: Status | 'all';
    priority: Priority | 'all';
    assignee: string | 'all';
  };
  sortBy: 'dueDate' | 'priority' | 'status' | 'createdAt';
  editingId: string | null;
  showAddForm: boolean;
};

// Priority badge component
function PriorityBadge({ priority, className }: { priority: Priority; className?: string }) {
  const styles = {
    low: 'bg-surface-secondary text-secondary border-default',
    medium: 'bg-info-surface text-info border-info-surface',
    high: 'bg-warning-surface text-warning border-warning-surface',
    urgent: 'bg-danger-surface text-danger border-danger-outline',
  };

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium border',
        styles[priority],
        className,
      )}
    >
      <Flag className="w-3 h-3" />
      {priority.charAt(0).toUpperCase() + priority.slice(1)}
    </span>
  );
}

// Status badge component
function StatusBadge({ status, className }: { status: Status; className?: string }) {
  const styles = {
    pending: 'bg-surface-secondary text-secondary border-default',
    'in-progress': 'bg-info-surface text-info border-info-surface',
    completed: 'bg-success-surface text-success border-success-surface',
    blocked: 'bg-danger-surface text-danger border-danger-outline',
  };

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium border',
        styles[status],
        className,
      )}
    >
      {status === 'completed' ? (
        <CheckCircle2 className="w-3 h-3" />
      ) : (
        <Clock className="w-3 h-3" />
      )}
      {status.charAt(0).toUpperCase() + status.slice(1).replace('-', ' ')}
    </span>
  );
}

// Action item form component (for adding/editing)
function ActionItemForm({
  item,
  defaultAssignee,
  onSave,
  onCancel,
}: {
  item?: Partial<ActionItem>;
  defaultAssignee?: string;
  onSave: (item: Omit<ActionItem, 'id' | 'createdAt' | 'completedAt'>) => void;
  onCancel: () => void;
}) {
  const [formData, setFormData] = useState({
    title: item?.title || '',
    description: item?.description || '',
    assignee: item?.assignee || defaultAssignee || '',
    dueDate: item?.dueDate || '',
    priority: item?.priority || ('medium' as Priority),
    status: item?.status || ('pending' as Status),
    estimatedHours: item?.estimatedHours || undefined,
    notes: item?.notes || '',
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.title.trim()) return;

    onSave({
      ...formData,
      title: formData.title.trim(),
      dueDate: formData.dueDate || undefined,
      description: formData.description || undefined,
      assignee: formData.assignee || undefined,
      notes: formData.notes || undefined,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="bg-surface-secondary p-4 rounded-xl border border-default space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Title */}
        <div className="md:col-span-2">
          <label className="block text-sm font-medium text-secondary mb-1">Title *</label>
          <input
            type="text"
            value={formData.title}
            onChange={(e) => setFormData({ ...formData, title: e.target.value })}
            className="w-full px-3 py-2 border border-default rounded-lg bg-surface outline-none focus-visible:ring-2 focus-visible:ring-[var(--present-accent-ring)]"
            placeholder="What needs to be done?"
            required
          />
        </div>

        {/* Description */}
        <div className="md:col-span-2">
          <label className="block text-sm font-medium text-secondary mb-1">Description</label>
          <textarea
            value={formData.description}
            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            className="w-full px-3 py-2 border border-default rounded-lg bg-surface outline-none focus-visible:ring-2 focus-visible:ring-[var(--present-accent-ring)]"
            rows={3}
            placeholder="Additional details..."
          />
        </div>

        {/* Assignee */}
        <div>
          <label className="block text-sm font-medium text-secondary mb-1">Assignee</label>
          <input
            type="text"
            value={formData.assignee}
            onChange={(e) => setFormData({ ...formData, assignee: e.target.value })}
            className="w-full px-3 py-2 border border-default rounded-lg bg-surface outline-none focus-visible:ring-2 focus-visible:ring-[var(--present-accent-ring)]"
            placeholder="Who's responsible?"
          />
        </div>

        {/* Due Date */}
        <div>
          <label className="block text-sm font-medium text-secondary mb-1">Due Date</label>
          <input
            type="date"
            value={formData.dueDate ? formData.dueDate.split('T')[0] : ''}
            onChange={(e) =>
              setFormData({
                ...formData,
                dueDate: e.target.value ? new Date(e.target.value).toISOString() : '',
              })
            }
            className="w-full px-3 py-2 border border-default rounded-lg bg-surface outline-none focus-visible:ring-2 focus-visible:ring-[var(--present-accent-ring)]"
          />
        </div>

        {/* Priority */}
        <div>
          <label className="block text-sm font-medium text-secondary mb-1">Priority</label>
          <select
            value={formData.priority}
            onChange={(e) => setFormData({ ...formData, priority: e.target.value as Priority })}
            className="w-full px-3 py-2 border border-default rounded-lg bg-surface outline-none focus-visible:ring-2 focus-visible:ring-[var(--present-accent-ring)]"
          >
            {priorityLevels.map((priority) => (
              <option key={priority} value={priority}>
                {priority.charAt(0).toUpperCase() + priority.slice(1)}
              </option>
            ))}
          </select>
        </div>

        {/* Status */}
        <div>
          <label className="block text-sm font-medium text-secondary mb-1">Status</label>
          <select
            value={formData.status}
            onChange={(e) => setFormData({ ...formData, status: e.target.value as Status })}
            className="w-full px-3 py-2 border border-default rounded-lg bg-surface outline-none focus-visible:ring-2 focus-visible:ring-[var(--present-accent-ring)]"
          >
            {statusTypes.map((status) => (
              <option key={status} value={status}>
                {status.charAt(0).toUpperCase() + status.slice(1).replace('-', ' ')}
              </option>
            ))}
          </select>
        </div>

        {/* Estimated Hours */}
        <div>
          <label className="block text-sm font-medium text-secondary mb-1">Estimated Hours</label>
          <input
            type="number"
            min="0"
            step="0.5"
            value={formData.estimatedHours || ''}
            onChange={(e) =>
              setFormData({
                ...formData,
                estimatedHours: e.target.value ? parseFloat(e.target.value) : undefined,
              })
            }
            className="w-full px-3 py-2 border border-default rounded-lg bg-surface outline-none focus-visible:ring-2 focus-visible:ring-[var(--present-accent-ring)]"
            placeholder="Hours"
          />
        </div>

        {/* Notes */}
        <div className="md:col-span-2">
          <label className="block text-sm font-medium text-secondary mb-1">Notes</label>
          <textarea
            value={formData.notes}
            onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
            className="w-full px-3 py-2 border border-default rounded-lg bg-surface outline-none focus-visible:ring-2 focus-visible:ring-[var(--present-accent-ring)]"
            rows={2}
            placeholder="Additional notes..."
          />
        </div>
      </div>

      {/* Form Actions */}
      <div className="flex justify-end gap-2">
        <Button
          type="button"
          onClick={onCancel}
          variant="outline"
          size="sm"
        >
          <X className="w-4 h-4 inline mr-1" />
          Cancel
        </Button>
        <Button
          type="submit"
          size="sm"
        >
          <Save className="w-4 h-4 inline mr-1" />
          Save
        </Button>
      </div>
    </form>
  );
}

// Individual action item card
function ActionItemCard({
  item,
  isEditing,
  defaultAssignee,
  onToggleComplete,
  onEdit,
  onSave,
  onCancelEdit,
  onDelete,
}: {
  item: ActionItem;
  isEditing: boolean;
  defaultAssignee?: string;
  onToggleComplete: () => void;
  onEdit: () => void;
  onSave: (updatedItem: Omit<ActionItem, 'id' | 'createdAt' | 'completedAt'>) => void;
  onCancelEdit: () => void;
  onDelete: () => void;
}) {
  const isCompleted = item.status === 'completed';
  const isOverdue = item.dueDate && new Date(item.dueDate) < new Date() && !isCompleted;

  if (isEditing) {
    return (
      <ActionItemForm
        item={item}
        defaultAssignee={defaultAssignee}
        onSave={onSave}
        onCancel={onCancelEdit}
      />
    );
  }

  return (
    <div
      className={cn(
        'bg-surface-elevated rounded-xl border border-default shadow-sm hover:shadow-md transition-all duration-200 p-4',
        isCompleted && 'opacity-75 bg-surface-secondary',
        isOverdue && 'border-danger-outline bg-danger-surface',
      )}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-start gap-3 flex-1 min-w-0">
          {/* Complete Toggle */}
          <button
            onClick={onToggleComplete}
            className="mt-0.5 text-tertiary hover:text-[var(--present-accent)] transition-colors"
          >
            {isCompleted ? (
              <CheckCircle2 className="w-5 h-5 text-success" />
            ) : (
              <Circle className="w-5 h-5" />
            )}
          </button>

          {/* Content */}
          <div className="flex-1 min-w-0">
            <h3
              className={cn(
                'font-medium text-primary text-sm leading-5',
                isCompleted && 'line-through text-tertiary',
              )}
            >
              {item.title}
            </h3>

            {item.description && (
              <p className="text-sm text-secondary mt-1 line-clamp-2">{item.description}</p>
            )}

            {/* Meta Info */}
            <div className="flex flex-wrap items-center gap-2 mt-2">
              <StatusBadge status={item.status} />
              <PriorityBadge priority={item.priority} />

              {item.assignee && (
                <span className="inline-flex items-center gap-1 text-xs text-secondary">
                  <User className="w-3 h-3" />
                  {item.assignee}
                </span>
              )}

              {item.dueDate && (
                <span
                  className={cn(
                    'inline-flex items-center gap-1 text-xs',
                    isOverdue ? 'text-danger' : 'text-secondary',
                  )}
                >
                  <Calendar className="w-3 h-3" />
                  {new Date(item.dueDate).toLocaleDateString()}
                </span>
              )}

              {item.estimatedHours && (
                <span className="inline-flex items-center gap-1 text-xs text-secondary">
                  <Clock className="w-3 h-3" />
                  {item.estimatedHours}h
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            onClick={onEdit}
            className="p-1 rounded hover:bg-surface-secondary transition-colors"
            title="Edit"
          >
            <Edit3 className="w-4 h-4 text-tertiary" />
          </button>

          <button
            onClick={onDelete}
            className="p-1 rounded hover:bg-surface-secondary transition-colors"
            title="Delete"
          >
            <Trash2 className="w-4 h-4 text-tertiary" />
          </button>
        </div>
      </div>

      {/* Notes */}
      {item.notes && (
        <div className="text-sm text-secondary bg-surface-secondary p-2 rounded-lg border-l-2 border-default">
          {item.notes}
        </div>
      )}
    </div>
  );
}

// Main ActionItemTracker component
export function ActionItemTracker({
  title = 'Action Items',
  initialItems = [],
  meetingContext,
  allowEditing = true,
  showCompleted = true,
  defaultAssignee,
  className,
  ...props
}: ActionItemTrackerProps & React.HTMLAttributes<HTMLDivElement>) {
  // Generate a stable unique ID that is consistent between server and client renders
  const instanceId = useId();

  // Use sub-agent for progressive data loading with error boundary
  const [subAgentError, setSubAgentError] = useState<Error | null>(null);

  // Memoize sub-agent config to prevent re-creation
  const subAgentConfig = useMemo(
    () => ({
      ...SubAgentPresets.actionItems,
      dataEnricher: (context: any, tools: any) => {
        // If we already have initial items, skip MCP calls
        if (initialItems && initialItems.length > 0) {
          return [];
        }

        // Otherwise, fetch data via MCP
        return [
          tools.linear?.execute({ action: 'list_issues' }),
          tools.github?.execute({ action: 'list_issues' }),
        ];
      },
    }),
    [initialItems],
  );

  let subAgent;
  try {
    subAgent = useComponentSubAgent(subAgentConfig);
  } catch (error) {
    console.error('SubAgent initialization failed:', error);
    setSubAgentError(error as Error);
    subAgent = {
      loadingState: LoadingState.COMPLETE,
      context: null,
      enrichedData: {},
      errors: {},
      mcpActivity: {},
    };
  }

  const loadingState = subAgent.loadingState;

  // Local component state
  const [state, setState] = useState<ActionItemTrackerState>({
    items: initialItems,
    filter: {
      status: 'all',
      priority: 'all',
      assignee: 'all',
    },
    sortBy: 'dueDate',
    editingId: null,
    showAddForm: false,
  });

  // Generate new ID
  const generateId = () => `ai-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  // Add new action item
  const addActionItem = (itemData: Omit<ActionItem, 'id' | 'createdAt' | 'completedAt'>) => {
    if (!state) return;

    const newItem: ActionItem = {
      ...itemData,
      id: generateId(),
      createdAt: new Date().toISOString(),
      completedAt: itemData.status === 'completed' ? new Date().toISOString() : undefined,
    };

    setState({
      ...state,
      items: [...state.items, newItem],
      showAddForm: false,
    });
  };

  // Update action item
  const updateActionItem = (
    id: string,
    itemData: Omit<ActionItem, 'id' | 'createdAt' | 'completedAt'>,
  ) => {
    if (!state) return;

    const updatedItems = state.items.map((item) => {
      if (item.id === id) {
        return {
          ...item,
          ...itemData,
          completedAt:
            itemData.status === 'completed' && item.status !== 'completed'
              ? new Date().toISOString()
              : item.completedAt,
        };
      }
      return item;
    });

    setState({
      ...state,
      items: updatedItems,
      editingId: null,
    });
  };

  // Toggle completion status
  const toggleComplete = (id: string) => {
    if (!state) return;

    const item = state.items.find((i) => i.id === id);
    if (!item) return;

    const newStatus = item.status === 'completed' ? 'pending' : 'completed';
    updateActionItem(id, { ...item, status: newStatus });
  };

  // Delete action item
  const deleteActionItem = (id: string) => {
    if (!state) return;

    setState({
      ...state,
      items: state.items.filter((item) => item.id !== id),
    });
  };

  // Filter and sort items
  const filteredItems =
    state?.items
      .filter((item) => {
        if (!state) return true;

        // Status filter
        if (state.filter.status !== 'all' && item.status !== state.filter.status) return false;

        // Priority filter
        if (state.filter.priority !== 'all' && item.priority !== state.filter.priority)
          return false;

        // Assignee filter
        if (state.filter.assignee !== 'all' && item.assignee !== state.filter.assignee)
          return false;

        // Show completed filter
        if (!showCompleted && item.status === 'completed') return false;

        return true;
      })
      .sort((a, b) => {
        if (!state) return 0;

        switch (state.sortBy) {
          case 'dueDate':
            if (!a.dueDate && !b.dueDate) return 0;
            if (!a.dueDate) return 1;
            if (!b.dueDate) return -1;
            return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
          case 'priority':
            const priorityOrder = { urgent: 4, high: 3, medium: 2, low: 1 };
            return priorityOrder[b.priority] - priorityOrder[a.priority];
          case 'status':
            return a.status.localeCompare(b.status);
          case 'createdAt':
            return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
          default:
            return 0;
        }
      }) || [];

  // Get unique assignees for filter
  const uniqueAssignees =
    [...new Set(state?.items.map((item) => item.assignee).filter(Boolean))] || [];

  const completedCount = state?.items.filter((item) => item.status === 'completed').length || 0;
  const totalCount = state?.items.length || 0;

  return (
    <LoadingWrapper
      state={loadingState}
      skeleton={SkeletonPatterns.list(5)}
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
            ? 'Loading items...'
            : loadingState === LoadingState.PARTIAL
              ? subAgent.mcpActivity?.linear
                ? 'Fetching Linear issues...'
                : subAgent.mcpActivity?.github
                  ? 'Loading GitHub issues...'
                  : 'Organizing tasks...'
              : 'Ready!',
        eta:
          loadingState === LoadingState.SKELETON
            ? 300
            : loadingState === LoadingState.PARTIAL
              ? 150
              : 0,
      }}
    >
      <WidgetFrame
        title={title}
        subtitle={
          meetingContext?.meetingTitle ? `From: ${meetingContext.meetingTitle}` : undefined
        }
        meta={
          meetingContext?.meetingDate
            ? `${new Date(meetingContext.meetingDate).toLocaleDateString()} · ${completedCount}/${totalCount} completed`
            : `${completedCount}/${totalCount} completed`
        }
        actions={
          allowEditing ? (
            <Button
              onClick={() => state && setState({ ...state, showAddForm: !state.showAddForm })}
              size="sm"
              className="flex items-center gap-2"
            >
              <Plus className="w-4 h-4" />
              Add item
            </Button>
          ) : null
        }
        className={cn('w-full max-w-4xl mx-auto', className)}
        bodyClassName="space-y-6"
      >
        {/* Filters */}
        <div className="flex flex-wrap gap-4 p-4 bg-surface-secondary border border-default rounded-xl">
            {/* Status Filter */}
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium text-secondary">Status:</label>
              <select
                value={state?.filter.status || 'all'}
                onChange={(e) =>
                  state &&
                  setState({
                    ...state,
                    filter: {
                      ...state.filter,
                      status: e.target.value as typeof state.filter.status,
                    },
                  })
                }
                className="text-sm border border-default rounded-lg px-2 py-1 bg-surface outline-none focus-visible:ring-2 focus-visible:ring-[var(--present-accent-ring)]"
              >
                <option value="all">All</option>
                {statusTypes.map((status) => (
                  <option key={status} value={status}>
                    {status.charAt(0).toUpperCase() + status.slice(1).replace('-', ' ')}
                  </option>
                ))}
              </select>
            </div>

            {/* Priority Filter */}
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium text-secondary">Priority:</label>
              <select
                value={state?.filter.priority || 'all'}
                onChange={(e) =>
                  state &&
                  setState({
                    ...state,
                    filter: {
                      ...state.filter,
                      priority: e.target.value as typeof state.filter.priority,
                    },
                  })
                }
                className="text-sm border border-default rounded-lg px-2 py-1 bg-surface outline-none focus-visible:ring-2 focus-visible:ring-[var(--present-accent-ring)]"
              >
                <option value="all">All</option>
                {priorityLevels.map((priority) => (
                  <option key={priority} value={priority}>
                    {priority.charAt(0).toUpperCase() + priority.slice(1)}
                  </option>
                ))}
              </select>
            </div>

            {/* Assignee Filter */}
            {uniqueAssignees.length > 0 && (
              <div className="flex items-center gap-2">
                <label className="text-sm font-medium text-secondary">Assignee:</label>
                <select
                  value={state?.filter.assignee || 'all'}
                  onChange={(e) =>
                    state &&
                    setState({
                      ...state,
                      filter: { ...state.filter, assignee: e.target.value },
                    })
                  }
                  className="text-sm border border-default rounded-lg px-2 py-1 bg-surface outline-none focus-visible:ring-2 focus-visible:ring-[var(--present-accent-ring)]"
                >
                  <option value="all">All</option>
                  {uniqueAssignees.map((assignee) => (
                    <option key={assignee} value={assignee}>
                      {assignee}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Sort By */}
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium text-secondary">Sort by:</label>
              <select
                value={state?.sortBy || 'dueDate'}
                onChange={(e) =>
                  state &&
                  setState({
                    ...state,
                    sortBy: e.target.value as typeof state.sortBy,
                  })
                }
                className="text-sm border border-default rounded-lg px-2 py-1 bg-surface outline-none focus-visible:ring-2 focus-visible:ring-[var(--present-accent-ring)]"
              >
                <option value="dueDate">Due Date</option>
                <option value="priority">Priority</option>
                <option value="status">Status</option>
                <option value="createdAt">Created</option>
              </select>
            </div>
        </div>

        {/* Add Form */}
        {state?.showAddForm && allowEditing && (
          <ActionItemForm
            defaultAssignee={defaultAssignee}
            onSave={addActionItem}
            onCancel={() => state && setState({ ...state, showAddForm: false })}
          />
        )}

        {/* Items */}
        <div className="space-y-4">
          {filteredItems.length === 0 ? (
            <div className="text-center py-12">
              <div className="text-tertiary mb-2">
                <CheckCircle2 className="w-12 h-12 mx-auto" />
              </div>
              <h3 className="text-lg font-medium text-primary mb-2">No action items</h3>
              <p className="text-secondary">
                {totalCount === 0
                  ? 'Add your first action item to get started.'
                  : 'Try adjusting your filters to see more items.'}
              </p>
            </div>
          ) : (
            filteredItems.map((item) => (
              <ActionItemCard
                key={item.id}
                item={item}
                isEditing={state?.editingId === item.id}
                defaultAssignee={defaultAssignee}
                onToggleComplete={() => toggleComplete(item.id)}
                onEdit={() => state && setState({ ...state, editingId: item.id })}
                onSave={(updatedItem) => updateActionItem(item.id, updatedItem)}
                onCancelEdit={() => state && setState({ ...state, editingId: null })}
                onDelete={() => deleteActionItem(item.id)}
              />
            ))
          )}
        </div>
      </WidgetFrame>
    </LoadingWrapper>
  );
}

export default ActionItemTracker;
