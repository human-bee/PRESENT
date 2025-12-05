'use client';

import React from 'react';
import type { LinearIssue } from '@/lib/linear/types';

export function getPriorityColor(priority?: { value: number; name: string }): string {
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
}

const labelColors: Record<string, string> = {
  Work: 'bg-blue-100 text-blue-800',
  Personal: 'bg-purple-100 text-purple-800',
  Social: 'bg-green-100 text-green-800',
};

export function getLabelColor(label: string): string {
  return labelColors[label] || 'bg-gray-100 text-gray-800';
}

/* --------------------------------------------------------------------------
 * IssueCard Component
 * --------------------------------------------------------------------------*/

export interface IssueCardProps {
  issue: LinearIssue;
  isDragging: boolean;
  showDropIndicatorBefore: boolean;
  showDropIndicatorAfter: boolean;
  onDragStart: (e: React.DragEvent<HTMLDivElement>, issueId: string) => void;
  onDragOver: (e: React.DragEvent<HTMLDivElement>, issueId: string) => void;
  onDrop: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragEnd: (e: React.DragEvent<HTMLDivElement>) => void;
  onClick: (e: React.MouseEvent, issueId: string) => void;
}

function areIssueCardPropsEqual(prevProps: IssueCardProps, nextProps: IssueCardProps): boolean {
  if (prevProps.issue !== nextProps.issue) {
    const prev = prevProps.issue;
    const next = nextProps.issue;
    if (
      prev.id !== next.id ||
      prev.identifier !== next.identifier ||
      prev.title !== next.title ||
      prev.status !== next.status ||
      prev.updatedAt !== next.updatedAt ||
      prev.project !== next.project ||
      prev.assignee !== next.assignee ||
      prev.priority?.value !== next.priority?.value ||
      prev.priority?.name !== next.priority?.name ||
      (prev.labels?.length ?? 0) !== (next.labels?.length ?? 0) ||
      prev.labels?.some((l, i) => l !== next.labels?.[i])
    ) {
      return false;
    }
  }

  // Compare boolean display props
  if (
    prevProps.isDragging !== nextProps.isDragging ||
    prevProps.showDropIndicatorBefore !== nextProps.showDropIndicatorBefore ||
    prevProps.showDropIndicatorAfter !== nextProps.showDropIndicatorAfter
  ) {
    return false;
  }

  return true;
}

export const IssueCard = React.memo(function IssueCard({
  issue,
  isDragging,
  showDropIndicatorBefore,
  showDropIndicatorAfter,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  onClick,
}: IssueCardProps) {
  return (
    <div
      draggable
      data-tldrag-ok
      data-issue-id={issue.id}
      onDragStartCapture={(e) => onDragStart(e, issue.id)}
      onDragOverCapture={(e) => onDragOver(e, issue.id)}
      onDropCapture={onDrop}
      onDragEndCapture={onDragEnd}
      onClick={(e) => onClick(e, issue.id)}
      className={`
        relative p-3 bg-white border-2 rounded-lg shadow-sm hover:shadow-md transition-all cursor-move nodrag
        ${isDragging ? 'opacity-50 rotate-2 scale-105' : ''} 
        ${getPriorityColor(issue.priority)}
      `}
    >
      {showDropIndicatorBefore && (
        <div className="absolute -top-2 left-0 right-0 h-1.5 bg-blue-600 rounded-full pointer-events-none z-50 shadow-sm ring-2 ring-white" />
      )}

      {showDropIndicatorAfter && (
        <div className="absolute -bottom-2 left-0 right-0 h-1.5 bg-blue-600 rounded-full pointer-events-none z-50 shadow-sm ring-2 ring-white" />
      )}

      <div className="flex items-start justify-between mb-2">
        <span className="text-xs font-mono text-gray-500 bg-gray-100 px-2 py-1 rounded">
          {issue.identifier}
        </span>
        {issue.priority && (
          <span
            className={`text-xs font-semibold px-2 py-1 rounded ${
              issue.priority.value === 1
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
  );
}, areIssueCardPropsEqual);


