/**
 * Action Item Tracker - Tambo AI Generative UI Component
 * 
 * Complex stateful component demonstrating Tambo AI's generative UI capabilities.
 * Uses useTamboComponentState hook for AI-driven state management and real-time updates.
 * 
 * DEVELOPER NOTES:
 * - Zod schemas for type safety and AI model validation
 * - Tambo component state system integration for AI interactions
 * - shadcn/ui + Tailwind CSS for consistent styling
 * - CRUD operations with optimistic updates
 * 
 * KEY INTEGRATIONS:
 * - @tambo-ai/react: useTamboComponentState hook for AI state management
 * - Zod schemas: actionItemSchema/actionItemTrackerSchema for validation
 * - Lucide React icons, Next.js client-side component
 * 
 * WHEN MODIFYING:
 * - Update schemas if changing data structure
 * - Maintain Tambo state hook for AI functionality
 * - Follow Tailwind utility patterns for styling consistency
 * - Consider AI model's ability to understand/manipulate data
 * 
 * CONNECTIONS:
 * - Used in MCP (Model Context Protocol) configurations
 * - Designed for Tambo's generative UI system
 * - Extensible with AI features like smart prioritization
 */

"use client";

import { cn } from "@/lib/utils";
import { useTamboComponentState } from "@tambo-ai/react";
import { useState, useEffect, useId } from "react";
import { z } from "zod";
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
  X
} from "lucide-react";

// Define priority levels
export const priorityLevels = ["low", "medium", "high", "urgent"] as const;
export type Priority = typeof priorityLevels[number];

// Define status types
export const statusTypes = ["pending", "in-progress", "completed", "blocked"] as const;
export type Status = typeof statusTypes[number];

// Action item schema
export const actionItemSchema = z.object({
  id: z.string().describe("Unique identifier for the action item"),
  title: z.string().describe("Title/description of the action item"),
  description: z.string().optional().describe("Detailed description of the action item"),
  assignee: z.string().optional().describe("Person assigned to this action item"),
  dueDate: z.string().optional().describe("Due date in ISO format"),
  priority: z.enum(priorityLevels).default("medium").describe("Priority level of the action item"),
  status: z.enum(statusTypes).default("pending").describe("Current status of the action item"),
  tags: z.array(z.string()).optional().describe("Tags associated with this action item"),
  createdAt: z.string().describe("When this action item was created"),
  completedAt: z.string().optional().describe("When this action item was completed"),
  estimatedHours: z.number().optional().describe("Estimated hours to complete"),
  actualHours: z.number().optional().describe("Actual hours spent"),
  notes: z.string().optional().describe("Additional notes or comments"),
});

// Main component schema
export const actionItemTrackerSchema = z.object({
  title: z.string().optional().default("Action Items").describe("Title for the tracker"),
  initialItems: z.array(actionItemSchema).optional().default([]).describe("Initial action items to display"),
  meetingContext: z.object({
    meetingTitle: z.string().optional().describe("Title of the meeting these action items are from"),
    meetingDate: z.string().optional().describe("Date of the meeting"),
    participants: z.array(z.string()).optional().describe("List of meeting participants"),
  }).optional().describe("Context about the meeting or source of these action items"),
  allowEditing: z.boolean().optional().default(true).describe("Whether users can add/edit action items"),
  showCompleted: z.boolean().optional().default(true).describe("Whether to show completed items by default"),
  defaultAssignee: z.string().optional().describe("Default assignee for new action items"),
});

export type ActionItemTrackerProps = z.infer<typeof actionItemTrackerSchema>;
export type ActionItem = z.infer<typeof actionItemSchema>;

// Component state type
type ActionItemTrackerState = {
  items: ActionItem[];
  filter: {
    status: Status | "all";
    priority: Priority | "all";
    assignee: string | "all";
  };
  sortBy: "dueDate" | "priority" | "status" | "createdAt";
  editingId: string | null;
  showAddForm: boolean;
};

// Priority badge component
function PriorityBadge({ priority, className }: { priority: Priority; className?: string }) {
  const styles = {
    low: "bg-gray-100 text-gray-700 border-gray-300",
    medium: "bg-blue-100 text-blue-700 border-blue-300",
    high: "bg-orange-100 text-orange-700 border-orange-300",
    urgent: "bg-red-100 text-red-700 border-red-300",
  };

  return (
    <span className={cn(
      "inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium border",
      styles[priority],
      className
    )}>
      <Flag className="w-3 h-3" />
      {priority.charAt(0).toUpperCase() + priority.slice(1)}
    </span>
  );
}

// Status badge component
function StatusBadge({ status, className }: { status: Status; className?: string }) {
  const styles = {
    pending: "bg-gray-100 text-gray-700 border-gray-300",
    "in-progress": "bg-blue-100 text-blue-700 border-blue-300",
    completed: "bg-green-100 text-green-700 border-green-300",
    blocked: "bg-red-100 text-red-700 border-red-300",
  };

  return (
    <span className={cn(
      "inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium border",
      styles[status],
      className
    )}>
      {status === "completed" ? <CheckCircle2 className="w-3 h-3" /> : <Clock className="w-3 h-3" />}
      {status.charAt(0).toUpperCase() + status.slice(1).replace("-", " ")}
    </span>
  );
}

// Action item form component (for adding/editing)
function ActionItemForm({ 
  item, 
  defaultAssignee,
  onSave, 
  onCancel 
}: {
  item?: Partial<ActionItem>;
  defaultAssignee?: string;
  onSave: (item: Omit<ActionItem, "id" | "createdAt" | "completedAt">) => void;
  onCancel: () => void;
}) {
  const [formData, setFormData] = useState({
    title: item?.title || "",
    description: item?.description || "",
    assignee: item?.assignee || defaultAssignee || "",
    dueDate: item?.dueDate || "",
    priority: item?.priority || "medium" as Priority,
    status: item?.status || "pending" as Status,
    estimatedHours: item?.estimatedHours || undefined,
    notes: item?.notes || "",
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
    <form onSubmit={handleSubmit} className="bg-gray-50 p-4 rounded-lg border space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Title */}
        <div className="md:col-span-2">
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Title *
          </label>
          <input
            type="text"
            value={formData.title}
            onChange={(e) => setFormData({ ...formData, title: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="What needs to be done?"
            required
          />
        </div>

        {/* Description */}
        <div className="md:col-span-2">
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Description
          </label>
          <textarea
            value={formData.description}
            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            rows={3}
            placeholder="Additional details..."
          />
        </div>

        {/* Assignee */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Assignee
          </label>
          <input
            type="text"
            value={formData.assignee}
            onChange={(e) => setFormData({ ...formData, assignee: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Who's responsible?"
          />
        </div>

        {/* Due Date */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Due Date
          </label>
          <input
            type="date"
            value={formData.dueDate ? formData.dueDate.split('T')[0] : ""}
            onChange={(e) => setFormData({ ...formData, dueDate: e.target.value ? new Date(e.target.value).toISOString() : "" })}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* Priority */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Priority
          </label>
          <select
            value={formData.priority}
            onChange={(e) => setFormData({ ...formData, priority: e.target.value as Priority })}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {priorityLevels.map(priority => (
              <option key={priority} value={priority}>
                {priority.charAt(0).toUpperCase() + priority.slice(1)}
              </option>
            ))}
          </select>
        </div>

        {/* Status */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Status
          </label>
          <select
            value={formData.status}
            onChange={(e) => setFormData({ ...formData, status: e.target.value as Status })}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {statusTypes.map(status => (
              <option key={status} value={status}>
                {status.charAt(0).toUpperCase() + status.slice(1).replace("-", " ")}
              </option>
            ))}
          </select>
        </div>

        {/* Estimated Hours */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Estimated Hours
          </label>
          <input
            type="number"
            min="0"
            step="0.5"
            value={formData.estimatedHours || ""}
            onChange={(e) => setFormData({ ...formData, estimatedHours: e.target.value ? parseFloat(e.target.value) : undefined })}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Hours"
          />
        </div>

        {/* Notes */}
        <div className="md:col-span-2">
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Notes
          </label>
          <textarea
            value={formData.notes}
            onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            rows={2}
            placeholder="Additional notes..."
          />
        </div>
      </div>

      {/* Form Actions */}
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
        >
          <X className="w-4 h-4 inline mr-1" />
          Cancel
        </button>
        <button
          type="submit"
          className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
        >
          <Save className="w-4 h-4 inline mr-1" />
          Save
        </button>
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
  onDelete 
}: {
  item: ActionItem;
  isEditing: boolean;
  defaultAssignee?: string;
  onToggleComplete: () => void;
  onEdit: () => void;
  onSave: (updatedItem: Omit<ActionItem, "id" | "createdAt" | "completedAt">) => void;
  onCancelEdit: () => void;
  onDelete: () => void;
}) {
  const isCompleted = item.status === "completed";
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
    <div className={cn(
      "bg-white rounded-lg border shadow-sm hover:shadow-md transition-all duration-200 p-4",
      isCompleted && "opacity-75 bg-gray-50",
      isOverdue && "border-red-200 bg-red-50"
    )}>
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-start gap-3 flex-1 min-w-0">
          {/* Complete Toggle */}
          <button
            onClick={onToggleComplete}
            className="mt-0.5 text-gray-400 hover:text-blue-600 transition-colors"
          >
            {isCompleted ? (
              <CheckCircle2 className="w-5 h-5 text-green-600" />
            ) : (
              <Circle className="w-5 h-5" />
            )}
          </button>

          {/* Content */}
          <div className="flex-1 min-w-0">
            <h3 className={cn(
              "font-medium text-gray-900 text-sm leading-5",
              isCompleted && "line-through text-gray-500"
            )}>
              {item.title}
            </h3>
            
            {item.description && (
              <p className="text-sm text-gray-600 mt-1 line-clamp-2">
                {item.description}
              </p>
            )}

            {/* Meta Info */}
            <div className="flex flex-wrap items-center gap-2 mt-2">
              <StatusBadge status={item.status} />
              <PriorityBadge priority={item.priority} />
              
              {item.assignee && (
                <span className="inline-flex items-center gap-1 text-xs text-gray-600">
                  <User className="w-3 h-3" />
                  {item.assignee}
                </span>
              )}
              
              {item.dueDate && (
                <span className={cn(
                  "inline-flex items-center gap-1 text-xs",
                  isOverdue ? "text-red-600" : "text-gray-600"
                )}>
                  <Calendar className="w-3 h-3" />
                  {new Date(item.dueDate).toLocaleDateString()}
                </span>
              )}

              {item.estimatedHours && (
                <span className="inline-flex items-center gap-1 text-xs text-gray-600">
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
            className="p-1 rounded hover:bg-gray-100 transition-colors"
            title="Edit"
          >
            <Edit3 className="w-4 h-4 text-gray-400" />
          </button>
          
          <button
            onClick={onDelete}
            className="p-1 rounded hover:bg-gray-100 transition-colors"
            title="Delete"
          >
            <Trash2 className="w-4 h-4 text-gray-400" />
          </button>
        </div>
      </div>

      {/* Notes */}
      {item.notes && (
        <div className="text-sm text-gray-600 bg-gray-50 p-2 rounded border-l-2 border-gray-300">
          {item.notes}
        </div>
      )}
    </div>
  );
}

// Main ActionItemTracker component
export function ActionItemTracker({
  title = "Action Items",
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

  // Initialize Tambo component state
  const [state, setState] = useTamboComponentState<ActionItemTrackerState>(
    instanceId,
    {
      items: initialItems,
      filter: {
        status: "all",
        priority: "all",
        assignee: "all",
      },
      sortBy: "dueDate",
      editingId: null,
      showAddForm: false,
    }
  );

  // Generate new ID
  const generateId = () => `ai-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  // Add new action item
  const addActionItem = (itemData: Omit<ActionItem, "id" | "createdAt" | "completedAt">) => {
    if (!state) return;

    const newItem: ActionItem = {
      ...itemData,
      id: generateId(),
      createdAt: new Date().toISOString(),
      completedAt: itemData.status === "completed" ? new Date().toISOString() : undefined,
    };

    setState({
      ...state,
      items: [...state.items, newItem],
      showAddForm: false,
    });
  };

  // Update action item
  const updateActionItem = (id: string, itemData: Omit<ActionItem, "id" | "createdAt" | "completedAt">) => {
    if (!state) return;

    const updatedItems = state.items.map(item => {
      if (item.id === id) {
        return {
          ...item,
          ...itemData,
          completedAt: itemData.status === "completed" && item.status !== "completed" 
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

    const item = state.items.find(i => i.id === id);
    if (!item) return;

    const newStatus = item.status === "completed" ? "pending" : "completed";
    updateActionItem(id, { ...item, status: newStatus });
  };

  // Delete action item
  const deleteActionItem = (id: string) => {
    if (!state) return;
    
    setState({
      ...state,
      items: state.items.filter(item => item.id !== id),
    });
  };

  // Filter and sort items
  const filteredItems = state?.items
    .filter(item => {
      if (!state) return true;
      
      // Status filter
      if (state.filter.status !== "all" && item.status !== state.filter.status) return false;
      
      // Priority filter
      if (state.filter.priority !== "all" && item.priority !== state.filter.priority) return false;
      
      // Assignee filter
      if (state.filter.assignee !== "all" && item.assignee !== state.filter.assignee) return false;
      
      // Show completed filter
      if (!showCompleted && item.status === "completed") return false;
      
      return true;
    })
    .sort((a, b) => {
      if (!state) return 0;
      
      switch (state.sortBy) {
        case "dueDate":
          if (!a.dueDate && !b.dueDate) return 0;
          if (!a.dueDate) return 1;
          if (!b.dueDate) return -1;
          return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
        case "priority":
          const priorityOrder = { urgent: 4, high: 3, medium: 2, low: 1 };
          return priorityOrder[b.priority] - priorityOrder[a.priority];
        case "status":
          return a.status.localeCompare(b.status);
        case "createdAt":
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        default:
          return 0;
      }
    }) || [];

  // Get unique assignees for filter
  const uniqueAssignees = [...new Set(state?.items.map(item => item.assignee).filter(Boolean))] || [];

  const completedCount = state?.items.filter(item => item.status === "completed").length || 0;
  const totalCount = state?.items.length || 0;

  return (
    <div className={cn("w-full max-w-4xl mx-auto", className)} {...props}>
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-xl font-semibold text-gray-900 flex items-center gap-2">
              {title}
              <span className="text-sm font-normal text-gray-500">
                ({completedCount}/{totalCount} completed)
              </span>
            </h2>
            
            {meetingContext && (
              <div className="text-sm text-gray-600 mt-1">
                {meetingContext.meetingTitle && (
                  <span className="font-medium">From: {meetingContext.meetingTitle}</span>
                )}
                {meetingContext.meetingDate && (
                  <span className="ml-2">
                    {new Date(meetingContext.meetingDate).toLocaleDateString()}
                  </span>
                )}
              </div>
            )}
          </div>
          
          {allowEditing && (
            <button
              onClick={() => state && setState({ ...state, showAddForm: !state.showAddForm })}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-2"
            >
              <Plus className="w-4 h-4" />
              Add Item
            </button>
          )}
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-4 p-4 bg-gray-50 rounded-lg">
          {/* Status Filter */}
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-gray-700">Status:</label>
            <select
              value={state?.filter.status || "all"}
              onChange={(e) => state && setState({ 
                ...state, 
                filter: { ...state.filter, status: e.target.value as typeof state.filter.status }
              })}
              className="text-sm border border-gray-300 rounded px-2 py-1 bg-white"
            >
              <option value="all">All</option>
              {statusTypes.map(status => (
                <option key={status} value={status}>
                  {status.charAt(0).toUpperCase() + status.slice(1).replace("-", " ")}
                </option>
              ))}
            </select>
          </div>

          {/* Priority Filter */}
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-gray-700">Priority:</label>
            <select
              value={state?.filter.priority || "all"}
              onChange={(e) => state && setState({ 
                ...state, 
                filter: { ...state.filter, priority: e.target.value as typeof state.filter.priority }
              })}
              className="text-sm border border-gray-300 rounded px-2 py-1 bg-white"
            >
              <option value="all">All</option>
              {priorityLevels.map(priority => (
                <option key={priority} value={priority}>
                  {priority.charAt(0).toUpperCase() + priority.slice(1)}
                </option>
              ))}
            </select>
          </div>

          {/* Assignee Filter */}
          {uniqueAssignees.length > 0 && (
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium text-gray-700">Assignee:</label>
              <select
                value={state?.filter.assignee || "all"}
                onChange={(e) => state && setState({ 
                  ...state, 
                  filter: { ...state.filter, assignee: e.target.value }
                })}
                className="text-sm border border-gray-300 rounded px-2 py-1 bg-white"
              >
                <option value="all">All</option>
                {uniqueAssignees.map(assignee => (
                  <option key={assignee} value={assignee}>
                    {assignee}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Sort By */}
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-gray-700">Sort by:</label>
            <select
              value={state?.sortBy || "dueDate"}
              onChange={(e) => state && setState({ 
                ...state, 
                sortBy: e.target.value as typeof state.sortBy 
              })}
              className="text-sm border border-gray-300 rounded px-2 py-1 bg-white"
            >
              <option value="dueDate">Due Date</option>
              <option value="priority">Priority</option>
              <option value="status">Status</option>
              <option value="createdAt">Created</option>
            </select>
          </div>
        </div>
      </div>

      {/* Add Form */}
      {state?.showAddForm && allowEditing && (
        <div className="mb-6">
          <ActionItemForm
            defaultAssignee={defaultAssignee}
            onSave={addActionItem}
            onCancel={() => state && setState({ ...state, showAddForm: false })}
          />
        </div>
      )}

      {/* Items */}
      <div className="space-y-4">
        {filteredItems.length === 0 ? (
          <div className="text-center py-12">
            <div className="text-gray-400 mb-2">
              <CheckCircle2 className="w-12 h-12 mx-auto" />
            </div>
            <h3 className="text-lg font-medium text-gray-900 mb-2">No action items</h3>
            <p className="text-gray-600">
              {totalCount === 0 
                ? "Add your first action item to get started."
                : "Try adjusting your filters to see more items."
              }
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
    </div>
  );
}

export default ActionItemTracker; 