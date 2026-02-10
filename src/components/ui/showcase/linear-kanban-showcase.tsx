'use client';

import * as React from 'react';
import type { LinearIssue, LinearStatus, KanbanColumn } from '@/lib/linear/types';
import { KanbanColumnComponent } from '@/components/ui/productivity/linear-kanban-column';
import { IssueDetailModal, type Comment } from '@/components/ui/productivity/linear-kanban-modal';
import { WidgetFrame } from '@/components/ui/productivity/widget-frame';

const statuses: LinearStatus[] = [
  { id: 'triage', name: 'Triage', type: 'backlog' },
  { id: 'in-progress', name: 'In Progress', type: 'started' },
  { id: 'review', name: 'Review', type: 'review' },
  { id: 'done', name: 'Done', type: 'completed' },
];

// Keep fixture times stable to avoid SSR/CSR hydration mismatches in /showcase/ui.
const FIXTURE_NOW = Date.parse('2026-02-08T00:00:00.000Z');

const issues: LinearIssue[] = [
  {
    id: 'ISSUE-1',
    identifier: 'PRE-128',
    title: 'Tokenize widget chrome (headers, borders, focus)',
    status: 'In Progress',
    updatedAt: new Date(FIXTURE_NOW - 1000 * 60 * 35).toISOString(),
    priority: { value: 2, name: 'High' },
    labels: ['Work'],
    project: 'Present',
    assignee: 'Bea',
  },
  {
    id: 'ISSUE-2',
    identifier: 'PRE-131',
    title: 'Add UI showcase route + screenshot capture script',
    status: 'Review',
    updatedAt: new Date(FIXTURE_NOW - 1000 * 60 * 90).toISOString(),
    priority: { value: 3, name: 'Medium' },
    labels: ['Work', 'Social'],
    project: 'Showcase',
    assignee: 'You',
  },
  {
    id: 'ISSUE-3',
    identifier: 'PRE-140',
    title: 'Remotion video: stitch before/after and highlight copper accents',
    status: 'Triage',
    updatedAt: new Date(FIXTURE_NOW - 1000 * 60 * 180).toISOString(),
    priority: { value: 4, name: 'Low' },
    labels: ['Personal'],
    project: 'Marketing',
  },
  {
    id: 'ISSUE-4',
    identifier: 'PRE-145',
    title: 'Fix a11y: consistent focus rings across modals and menus',
    status: 'Done',
    updatedAt: new Date(FIXTURE_NOW - 1000 * 60 * 12).toISOString(),
    priority: { value: 1, name: 'Urgent' },
    labels: ['Work'],
    project: 'Present',
    assignee: 'Bea',
  },
];

const columns: KanbanColumn[] = statuses.map((s, i) => ({
  id: s.id,
  title: s.name,
  key: `showcase-col-${i}-${s.id}`,
}));

const comments: Comment[] = [
  { id: 'c1', user: 'Bea', text: 'Chrome looks cohesive now. Great pass.', time: '2h ago' },
  { id: 'c2', user: 'You', text: 'Next: wire screenshots into Remotion.', time: '1h ago' },
];

export function LinearKanbanShowcase({ className }: { className?: string }) {
  const [selectedIssueId, setSelectedIssueId] = React.useState<string | null>(null);

  const getIssuesForColumn = React.useCallback((columnTitle: string) => {
    return issues.filter((i) => (i.status || '').toLowerCase() === columnTitle.toLowerCase());
  }, []);

  const selectedIssue = selectedIssueId ? issues.find((i) => i.id === selectedIssueId) ?? null : null;

  return (
    <WidgetFrame
      title="Linear Kanban (Showcase)"
      subtitle="Static fixture for screenshots"
      className={className}
      bodyClassName="space-y-4"
    >
      <div className="flex gap-4 overflow-x-auto pb-2">
        {columns.map((col) => (
          <KanbanColumnComponent
            key={col.key}
            column={col}
            issues={getIssuesForColumn(col.title)}
            draggedIssue={null}
            dropIndicator={null}
            isActiveDropColumn={false}
            columnWidth={280}
            onDragOver={() => {}}
            onDrop={() => {}}
            onDragStart={() => {}}
            onDragOverCard={() => {}}
            onDragEnd={() => {}}
            onIssueClick={(e, issueId) => {
              e.stopPropagation();
              setSelectedIssueId(issueId);
            }}
          />
        ))}
      </div>

      {selectedIssue ? (
        <IssueDetailModal
          issue={selectedIssue}
          comments={comments}
          statuses={statuses}
          onClose={() => setSelectedIssueId(null)}
          onStatusChange={() => {}}
          onAssigneeChange={() => {}}
          onAddComment={() => {}}
        />
      ) : null}
    </WidgetFrame>
  );
}
