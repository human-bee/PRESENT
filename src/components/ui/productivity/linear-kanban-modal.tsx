'use client';

import React from 'react';
import type { LinearIssue, LinearStatus } from '@/lib/linear/types';
import { Button } from '@/components/ui/shared/button';
import { getLabelColor } from './linear-kanban-issue-card';

export interface Comment {
  id: string;
  user: string;
  text: string;
  time: string;
}

export interface IssueDetailModalProps {
  issue: LinearIssue;
  comments: Comment[];
  statuses: LinearStatus[];
  onClose: (e?: React.MouseEvent) => void;
  onStatusChange: (issueId: string, newStatus: string) => void;
  onAssigneeChange: (issueId: string, newAssignee: string) => void;
  onAddComment: (issueId: string, text: string) => void;
}

export function IssueDetailModal({
  issue,
  comments,
  statuses,
  onClose,
  onStatusChange,
  onAssigneeChange,
  onAddComment,
}: IssueDetailModalProps) {
  return (
    <div
      className="absolute inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      onClick={onClose}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div
        className="bg-surface-elevated rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90%] overflow-hidden flex flex-col border border-default"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="p-6 border-b border-default flex justify-between items-start bg-surface-secondary">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <span className="text-sm font-mono text-tertiary bg-surface border border-default px-2 py-1 rounded">
                {issue.identifier}
              </span>
              <span
                className={`text-xs font-semibold px-2 py-1 rounded ${
                  issue.priority?.value === 1
                    ? 'bg-danger-surface text-danger border border-danger-outline'
                    : issue.priority?.value === 2
                      ? 'bg-warning-surface text-warning border border-warning-surface'
                      : 'bg-surface-secondary text-secondary border border-default'
                }`}
              >
                {issue.priority?.name || 'No Priority'}
              </span>
            </div>
            <h2 className="text-xl font-bold text-primary">{issue.title}</h2>
          </div>
          <Button onClick={onClose} variant="ghost" size="icon" aria-label="Close issue details">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </Button>
        </div>

        {/* Modal Content */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="grid grid-cols-3 gap-8">
            {/* Main Content */}
            <div className="col-span-2 space-y-6">
              <div>
                <h3 className="text-sm font-semibold text-primary mb-2">Description</h3>
                <div className="text-secondary text-sm leading-relaxed">
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
                <h3 className="text-sm font-semibold text-primary mb-3">Activity & Comments</h3>
                <div className="space-y-4">
                  {/* Existing Comments */}
                  {comments.map((comment) => (
                    <div key={comment.id} className="flex gap-3">
                      <div className="w-8 h-8 rounded-full bg-info-surface border border-info-surface flex items-center justify-center text-xs font-bold text-info">
                        {comment.user[0]}
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-sm font-medium text-primary">{comment.user}</span>
                          <span className="text-xs text-tertiary">{comment.time}</span>
                        </div>
                        <p className="text-sm text-secondary">{comment.text}</p>
                      </div>
                    </div>
                  ))}

                  {/* Add Comment Input */}
                  <div className="flex gap-3 mt-4">
                    <div className="w-8 h-8 rounded-full bg-surface-secondary border border-default flex items-center justify-center text-xs font-bold text-tertiary">
                      Y
                    </div>
                    <div className="flex-1">
                      <input
                        type="text"
                        placeholder="Leave a comment..."
                        className="w-full border border-default rounded-lg bg-surface px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--present-accent-ring)]"
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && e.currentTarget.value.trim()) {
                            onAddComment(issue.id, e.currentTarget.value);
                            e.currentTarget.value = '';
                          }
                        }}
                      />
                      <p className="text-xs text-tertiary mt-1">Press Enter to post</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Sidebar */}
            <div className="space-y-6">
              <div>
                <label className="block text-xs font-semibold text-tertiary uppercase tracking-wider mb-2">
                  Status
                </label>
                <select
                  value={issue.status}
                  onChange={(e) => onStatusChange(issue.id, e.target.value)}
                  className="w-full text-sm border border-default rounded-md bg-surface shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--present-accent-ring)]"
                >
                  {statuses.map((s: any) => {
                    const value = typeof s === 'string' ? s : s.name;
                    const label = typeof s === 'string' ? s : s.name || s.id;
                    const key = typeof s === 'string' ? s : s.id || s.name;
                    return (
                      <option key={key} value={value}>
                        {label}
                      </option>
                    );
                  })}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-tertiary uppercase tracking-wider mb-2">
                  Assignee
                </label>
                <div className="space-y-2">
                  <div className="flex items-center gap-2 p-2 border border-default rounded-md bg-surface">
                    {issue.assignee ? (
                      <>
                        <span className="w-6 h-6 rounded-full bg-surface-secondary border border-default flex items-center justify-center text-xs">
                          👤
                        </span>
                        <span className="text-sm text-primary">{issue.assignee}</span>
                      </>
                    ) : (
                      <span className="text-sm text-tertiary italic">Unassigned</span>
                    )}
                  </div>
                  <select
                    className="w-full text-sm border border-default rounded-md bg-surface shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--present-accent-ring)]"
                    onChange={(e) => onAssigneeChange(issue.id, e.target.value)}
                    value={issue.assignee || ''}
                  >
                    <option value="">Change Assignee...</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-tertiary uppercase tracking-wider mb-2">
                  Labels
                </label>
                <div className="flex flex-wrap gap-2">
                  {issue.labels?.map((label, i) => (
                    <span
                      key={i}
                      className={`px-2 py-1 rounded text-xs font-medium ${getLabelColor(label)}`}
                    >
                      {label}
                    </span>
                  ))}
                  <Button variant="outline" size="sm" type="button">
                    + Add
                  </Button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-tertiary uppercase tracking-wider mb-2">
                  Project
                </label>
                <div className="text-sm text-secondary hover:underline cursor-pointer flex items-center gap-1">
                  📁 {issue.project || 'No Project'}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}






