"use client";

import type { ToolJob } from '../utils/toolTypes';

export interface JobCardProps {
  job: ToolJob;
  onCancel?: (id: string) => void;
  onRetry?: (id: string) => void;
}

export function JobCard({ job, onCancel, onRetry }: JobCardProps) {
  return (
    <div className="border border-border rounded-md p-3 space-y-2 bg-background/60">
      <div className="flex items-center justify-between text-sm font-medium text-foreground">
        <span>{job.tool}</span>
        <span className="text-xs font-normal text-muted-foreground">{job.status.toUpperCase()}</span>
      </div>
      <div className="text-xs text-muted-foreground">
        <div>Queued: {new Date(job.createdAt).toLocaleTimeString()}</div>
        {job.startedAt ? <div>Started: {new Date(job.startedAt).toLocaleTimeString()}</div> : null}
        {job.finishedAt ? <div>Finished: {new Date(job.finishedAt).toLocaleTimeString()}</div> : null}
        {job.message ? <div className="mt-1 text-foreground/80">{job.message}</div> : null}
      </div>
      <div className="flex items-center gap-2">
        {onCancel && job.status === 'running' ? (
          <button className="text-xs text-primary" onClick={() => onCancel(job.id)}>
            Cancel
          </button>
        ) : null}
        {onRetry && job.status === 'error' ? (
          <button className="text-xs text-primary" onClick={() => onRetry(job.id)}>
            Retry
          </button>
        ) : null}
      </div>
    </div>
  );
}
