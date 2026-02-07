'use client';

import React from 'react';
import type { LinearIssue, KanbanColumn, DropIndicator } from '@/lib/linear/types';
import { IssueCard } from './linear-kanban-issue-card';

export interface KanbanColumnProps {
  column: KanbanColumn;
  issues: LinearIssue[];
  draggedIssue: string | null;
  dropIndicator: DropIndicator | null;
  isActiveDropColumn: boolean;
  columnWidth: number;
  onDragOver: (e: React.DragEvent<HTMLDivElement>, columnId: string) => void;
  onDrop: (e: React.DragEvent<HTMLDivElement>, columnId: string) => void;
  onDragStart: (e: React.DragEvent<HTMLDivElement>, issueId: string) => void;
  onDragOverCard: (e: React.DragEvent<HTMLDivElement>, issueId: string) => void;
  onDragEnd: (e: React.DragEvent<HTMLDivElement>) => void;
  onIssueClick: (e: React.MouseEvent, issueId: string) => void;
}

export function KanbanColumnComponent({
  column,
  issues,
  draggedIssue,
  dropIndicator,
  isActiveDropColumn,
  columnWidth,
  onDragOver,
  onDrop,
  onDragStart,
  onDragOverCard,
  onDragEnd,
  onIssueClick,
}: KanbanColumnProps) {
  return (
    <div className="flex-shrink-0" style={{ width: columnWidth + 'px' }}>
      <div
        className={`bg-surface-elevated rounded-2xl shadow-sm border h-fit transition-colors nodrag overflow-hidden ${
          isActiveDropColumn
            ? 'bg-info-surface border-default ring-2 ring-[var(--present-accent-ring)]'
            : 'border-default'
        }`}
        onDragEnterCapture={(e) => onDragOver(e as any, column.id)}
        onDragOverCapture={(e) => onDragOver(e as any, column.id)}
        onDropCapture={(e) => onDrop(e as any, column.id)}
      >
        <div className="p-4 border-b border-default bg-surface-secondary">
          <h2 className="font-semibold text-primary text-sm flex items-center justify-between">
            <span>{column.title}</span>
            <span className="bg-surface-secondary text-secondary px-2 py-1 rounded-full text-xs font-medium border border-default">
              {issues.length}
            </span>
          </h2>
        </div>

        <div className="p-4 min-h-[200px] space-y-3">
          {issues.map((issue) => (
            <IssueCard
              key={issue.id}
              issue={issue}
              isDragging={draggedIssue === issue.id}
              showDropIndicatorBefore={
                dropIndicator?.targetId === issue.id &&
                dropIndicator?.position === 'before'
              }
              showDropIndicatorAfter={
                dropIndicator?.targetId === issue.id &&
                dropIndicator?.position === 'after'
              }
              onDragStart={onDragStart}
              onDragOver={onDragOverCard}
              onDrop={(e) => onDrop(e, column.id)}
              onDragEnd={onDragEnd}
              onClick={onIssueClick}
            />
          ))}

          {/* Empty Column / Append Indicator */}
          {isActiveDropColumn && !dropIndicator && (
            <div className="h-1.5 bg-[var(--present-accent)] rounded-full mx-1 shadow-sm ring-2 ring-[var(--present-accent-ring)] animate-pulse" />
          )}

          {issues.length === 0 && !isActiveDropColumn && (
            <div className="text-tertiary text-center py-8 text-sm">
              No issues in {column.title}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}






